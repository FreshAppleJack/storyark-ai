use super::records::record;
use super::validation::{invalid, valid_id};
use super::{Database, Result, StorageError};
use crate::rag::contracts::{
    RetrievalAuthoringStatus, RetrievalIndexStatus, RetrievalScope, RetrievalSource,
    RetrievalSourceKind, RetrievalSourceOrigin, RetrievalSourceStatus, RetrievalVisibilityScope,
};
use crate::rag::sources::{normalize_index_text, source_id, source_is_visible, tiptap_text};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const MAX_SOURCE_TEXT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRetrievalSources {
    pub book_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRetrievalSources {
    pub scope: RetrievalScope,
}

struct SourceDraft {
    source_id: String,
    book_id: String,
    entity_id: String,
    source_kind: RetrievalSourceKind,
    source_status: RetrievalSourceStatus,
    source_version: i64,
    origin: RetrievalSourceOrigin,
    authoring_status: RetrievalAuthoringStatus,
    visibility_scope: RetrievalVisibilityScope,
    source_text: String,
    index_text: String,
    updated_at: i64,
    entity_metadata: Value,
}

struct ChapterContext {
    id: String,
    title: String,
    source_version: i64,
    content_format: String,
    content: String,
    updated_at: i64,
    chapter_order: i64,
}

struct ExistingIndexState {
    source_version: i64,
    source_text: String,
    index_text: String,
    index_status: String,
    index_version: Option<i64>,
    embedding_fingerprint: Option<String>,
}

impl SourceDraft {
    fn new(
        book_id: &str,
        entity_id: String,
        source_kind: RetrievalSourceKind,
        source_status: RetrievalSourceStatus,
        source_version: i64,
        origin: RetrievalSourceOrigin,
        authoring_status: RetrievalAuthoringStatus,
        visibility_scope: RetrievalVisibilityScope,
        source_text: String,
        updated_at: i64,
        entity_metadata: Value,
    ) -> Self {
        let source_text = if source_text.len() <= MAX_SOURCE_TEXT_BYTES {
            source_text
        } else {
            String::new()
        };
        let source_status =
            if source_text.is_empty() && source_status == RetrievalSourceStatus::Active {
                RetrievalSourceStatus::Pending
            } else {
                source_status
            };
        let index_text = normalize_index_text(&source_text);
        Self {
            source_id: source_id(book_id, &source_kind, &entity_id),
            book_id: book_id.to_owned(),
            entity_id,
            source_kind,
            source_status,
            source_version: source_version.max(1),
            origin,
            authoring_status,
            visibility_scope,
            source_text,
            index_text,
            updated_at: updated_at.max(0),
            entity_metadata,
        }
    }
}

fn registry_error(message: &str) -> StorageError {
    StorageError::new("STORAGE_FAILURE", message)
}

fn parse_json(raw: &str, message: &str) -> Result<Value> {
    serde_json::from_str(raw).map_err(|_| registry_error(message))
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn metadata(
    value: Option<&Value>,
    default_origin: RetrievalSourceOrigin,
) -> (
    RetrievalSourceOrigin,
    RetrievalAuthoringStatus,
    RetrievalSourceStatus,
) {
    let object = value.and_then(Value::as_object);
    let generated = object
        .and_then(|object| object.get("isGenerated"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let origin = object
        .and_then(|object| object.get("origin"))
        .and_then(Value::as_str)
        .and_then(RetrievalSourceOrigin::parse)
        .unwrap_or_else(|| {
            if generated {
                RetrievalSourceOrigin::Generated
            } else {
                default_origin
            }
        });
    let authoring_status = object
        .and_then(|object| object.get("authoringStatus"))
        .and_then(Value::as_str)
        .and_then(RetrievalAuthoringStatus::parse)
        .unwrap_or_else(|| {
            if origin == RetrievalSourceOrigin::Generated {
                RetrievalAuthoringStatus::AiSuggestion
            } else {
                RetrievalAuthoringStatus::AuthorConfirmed
            }
        });
    let source_status = object
        .and_then(|object| object.get("sourceStatus").or_else(|| object.get("status")))
        .and_then(Value::as_str)
        .and_then(RetrievalSourceStatus::parse)
        .unwrap_or(RetrievalSourceStatus::Active);
    let source_status = if authoring_status == RetrievalAuthoringStatus::Discarded {
        RetrievalSourceStatus::Discarded
    } else {
        source_status
    };
    (origin, authoring_status, source_status)
}

fn add_planning_text_source(
    drafts: &mut Vec<SourceDraft>,
    book_id: &str,
    entity_id: &str,
    text: &str,
    source_version: i64,
    updated_at: i64,
) {
    if text.trim().is_empty() {
        return;
    }
    drafts.push(SourceDraft::new(
        book_id,
        entity_id.to_owned(),
        RetrievalSourceKind::Planning,
        RetrievalSourceStatus::Active,
        source_version,
        RetrievalSourceOrigin::Author,
        RetrievalAuthoringStatus::AuthorConfirmed,
        RetrievalVisibilityScope::Book,
        text.to_owned(),
        updated_at,
        json!({"field": entity_id}),
    ));
}

fn chapter_sources(
    db: &Connection,
    book_id: &str,
    drafts: &mut Vec<SourceDraft>,
) -> Result<Vec<ChapterContext>> {
    let mut statement = db.prepare(
        "SELECT c.id,c.title,c.database_version,c.content_format,c.content,c.updated_at
         FROM chapters c JOIN volumes v ON v.book_id=c.book_id AND v.id=c.volume_id
         WHERE c.book_id=? ORDER BY v.position,v.id,c.position,c.id",
    )?;
    let rows = statement.query_map([book_id], |row| {
        Ok(ChapterContext {
            id: row.get(0)?,
            title: row.get(1)?,
            source_version: row.get(2)?,
            content_format: row.get(3)?,
            content: row.get(4)?,
            updated_at: row.get(5)?,
            chapter_order: 0,
        })
    })?;
    let mut chapters = Vec::new();
    for (index, row) in rows.enumerate() {
        let mut chapter = row?;
        chapter.chapter_order = index as i64;
        let body_text = if chapter.content_format == "tiptap-json" {
            parse_json(&chapter.content, "Stored manuscript content is invalid")
                .ok()
                .and_then(|value| tiptap_text(&value))
        } else {
            None
        };
        let body_supported = body_text.is_some();
        let source_text = match body_text.as_deref() {
            Some(body) if body.is_empty() => chapter.title.clone(),
            Some(body) => format!("{}\n{}", chapter.title, body),
            None => chapter.title.clone(),
        };
        let source_status = if chapter.content_format == "tiptap-json" && body_supported {
            RetrievalSourceStatus::Active
        } else {
            RetrievalSourceStatus::Pending
        };
        drafts.push(SourceDraft::new(
            book_id,
            chapter.id.clone(),
            RetrievalSourceKind::Manuscript,
            source_status,
            chapter.source_version,
            RetrievalSourceOrigin::Author,
            RetrievalAuthoringStatus::AuthorConfirmed,
            RetrievalVisibilityScope::Chapter {
                chapter_id: chapter.id.clone(),
                chapter_order: chapter.chapter_order,
            },
            source_text,
            chapter.updated_at,
            json!({"chapterId": chapter.id, "contentFormat": chapter.content_format}),
        ));
        chapters.push(chapter);
    }
    Ok(chapters)
}

fn planning_sources(
    db: &Connection,
    book_id: &str,
    chapters: &[ChapterContext],
    drafts: &mut Vec<SourceDraft>,
) -> Result<()> {
    let planning = db
        .query_row(
            "SELECT story_summary,story_background,chapter_summaries_json,plot_settings_json,database_version,updated_at FROM planning WHERE book_id=?",
            [book_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((story_summary, story_background, summaries_raw, plots_raw, version, updated_at)) =
        planning
    else {
        return Ok(());
    };
    add_planning_text_source(
        drafts,
        book_id,
        "story-summary",
        &story_summary,
        version,
        updated_at,
    );
    add_planning_text_source(
        drafts,
        book_id,
        "story-background",
        &story_background,
        version,
        updated_at,
    );
    let chapter_map: HashMap<&str, &ChapterContext> = chapters
        .iter()
        .map(|chapter| (chapter.id.as_str(), chapter))
        .collect();
    let summaries = parse_json(&summaries_raw, "Stored chapter summaries are invalid")?;
    for summary in summaries
        .as_array()
        .ok_or_else(|| registry_error("Stored chapter summaries are not an array"))?
    {
        let Some(chapter_id) = summary.get("chapterId").and_then(Value::as_str) else {
            continue;
        };
        let Some(chapter) = chapter_map.get(chapter_id) else {
            continue;
        };
        let Some(text) = summary.get("summary").and_then(Value::as_str) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        let recorded_version = summary.get("sourceChapterVersion").and_then(Value::as_i64);
        let source_status = match recorded_version {
            Some(value) if value == chapter.source_version => RetrievalSourceStatus::Active,
            Some(value) if value > 0 => RetrievalSourceStatus::Stale,
            _ => RetrievalSourceStatus::Pending,
        };
        let source_version = recorded_version.unwrap_or(1);
        let updated = summary
            .get("updatedAt")
            .and_then(Value::as_i64)
            .unwrap_or(updated_at);
        let (origin, authoring_status, metadata_status) =
            metadata(Some(summary), RetrievalSourceOrigin::Author);
        let status = if metadata_status == RetrievalSourceStatus::Discarded {
            metadata_status
        } else {
            source_status
        };
        drafts.push(SourceDraft::new(
            book_id,
            chapter_id.to_owned(),
            RetrievalSourceKind::ChapterSummary,
            status,
            source_version,
            origin,
            authoring_status,
            RetrievalVisibilityScope::Chapter {
                chapter_id: chapter_id.to_owned(),
                chapter_order: chapter.chapter_order,
            },
            format!("{}\n{}", chapter.title, text),
            updated.max(0),
            json!({"chapterId": chapter_id, "sourceChapterVersion": recorded_version}),
        ));
    }
    let plots = parse_json(&plots_raw, "Stored plot settings are invalid")?;
    for plot in plots
        .as_array()
        .ok_or_else(|| registry_error("Stored plot settings are not an array"))?
    {
        let Some(plot_id) = plot.get("id").and_then(Value::as_str) else {
            continue;
        };
        let title = plot
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let details = plot
            .get("details")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let text = [title, details]
            .into_iter()
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if text.trim().is_empty() {
            continue;
        }
        let chapter_ids = string_array(plot.get("chapterIds"));
        let (origin, authoring_status, source_status) =
            metadata(Some(plot), RetrievalSourceOrigin::Author);
        drafts.push(SourceDraft::new(
            book_id,
            plot_id.to_owned(),
            RetrievalSourceKind::FuturePlan,
            source_status,
            version,
            origin,
            authoring_status,
            RetrievalVisibilityScope::Planning {
                chapter_ids: chapter_ids.clone(),
            },
            text,
            plot.get("updatedAt")
                .and_then(Value::as_i64)
                .unwrap_or(updated_at)
                .max(0),
            json!({
                "chapterIds": chapter_ids,
                "missingChapterIds": string_array(plot.get("missingChapterIds")),
            }),
        ));
    }
    Ok(())
}

fn character_sources(db: &Connection, book_id: &str, drafts: &mut Vec<SourceDraft>) -> Result<()> {
    let mut statement = db.prepare(
        "SELECT id,name,aliases_json,role,description,color,tags_json,is_archived,database_version,updated_at
         FROM characters WHERE book_id=? ORDER BY position,id",
    )?;
    let rows = statement.query_map([book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, bool>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, i64>(9)?,
        ))
    })?;
    for row in rows {
        let (
            id,
            name,
            aliases_raw,
            role,
            description,
            color,
            tags_raw,
            archived,
            version,
            updated_at,
        ) = row?;
        let aliases = string_array(Some(&parse_json(
            &aliases_raw,
            "Stored character aliases are invalid",
        )?));
        let tags = string_array(Some(&parse_json(
            &tags_raw,
            "Stored character tags are invalid",
        )?));
        let text = [
            name.as_str(),
            aliases.join(" ").as_str(),
            role.as_str(),
            description.as_str(),
            color.as_str(),
            tags.join(" ").as_str(),
        ]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
        drafts.push(SourceDraft::new(
            book_id,
            id,
            RetrievalSourceKind::Character,
            RetrievalSourceStatus::Active,
            version,
            RetrievalSourceOrigin::Author,
            RetrievalAuthoringStatus::AuthorConfirmed,
            RetrievalVisibilityScope::Book,
            text,
            updated_at,
            json!({"isArchived": archived}),
        ));
    }
    Ok(())
}

fn relationship_sources(
    db: &Connection,
    book_id: &str,
    drafts: &mut Vec<SourceDraft>,
) -> Result<()> {
    let graph_version = db
        .query_row(
            "SELECT database_version FROM graphs WHERE book_id=?",
            [book_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    let Some(graph_version) = graph_version else {
        return Ok(());
    };
    let mut statement = db.prepare(
        "SELECT e.id,e.source_node_key,e.target_node_key,e.label,e.updated_at,
                sn.character_id,sc.name,tn.character_id,tc.name
         FROM graph_edges e
         JOIN graph_nodes sn ON sn.book_id=e.book_id AND sn.node_key=e.source_node_key
         JOIN graph_nodes tn ON tn.book_id=e.book_id AND tn.node_key=e.target_node_key
         LEFT JOIN characters sc ON sc.book_id=e.book_id AND sc.id=sn.character_id
         LEFT JOIN characters tc ON tc.book_id=e.book_id AND tc.id=tn.character_id
         WHERE e.book_id=? ORDER BY e.id",
    )?;
    let rows = statement.query_map([book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, Option<String>>(8)?,
        ))
    })?;
    for row in rows {
        let (
            id,
            source_node_key,
            target_node_key,
            label,
            updated_at,
            source_character_id,
            source_name,
            target_character_id,
            target_name,
        ) = row?;
        let source_name = source_name.unwrap_or(source_character_id.clone());
        let target_name = target_name.unwrap_or(target_character_id.clone());
        let source_text = format!("{} -> {}\n{}", source_name, target_name, label);
        drafts.push(SourceDraft::new(
            book_id,
            id,
            RetrievalSourceKind::Relationship,
            RetrievalSourceStatus::Active,
            graph_version,
            RetrievalSourceOrigin::Author,
            RetrievalAuthoringStatus::AuthorConfirmed,
            RetrievalVisibilityScope::Book,
            source_text,
            updated_at,
            json!({
                "sourceNodeKey": source_node_key,
                "targetNodeKey": target_node_key,
                "sourceCharacterId": source_character_id,
                "targetCharacterId": target_character_id,
                "label": label,
            }),
        ));
    }
    Ok(())
}

fn note_sources_from_db(
    db: &Connection,
    book_id: &str,
    chapters: &[ChapterContext],
    drafts: &mut Vec<SourceDraft>,
) -> Result<()> {
    let mut statement = db.prepare("SELECT id,foreshadowings_json,database_version,updated_at FROM chapters WHERE book_id=? ORDER BY id")?;
    let rows = statement.query_map([book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let chapter_map: HashSet<&str> = chapters.iter().map(|chapter| chapter.id.as_str()).collect();
    for row in rows {
        let (chapter_id, notes_raw, version, chapter_updated_at) = row?;
        if !chapter_map.contains(chapter_id.as_str()) {
            continue;
        }
        let notes = parse_json(&notes_raw, "Stored foreshadowing notes are invalid")?;
        for note in notes
            .as_array()
            .ok_or_else(|| registry_error("Stored foreshadowing notes are not an array"))?
        {
            let Some(note_id) = note.get("id").and_then(Value::as_str) else {
                continue;
            };
            let excerpt = note
                .get("excerpt")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let body = note.get("note").and_then(Value::as_str).unwrap_or_default();
            let source_text = [excerpt, body]
                .into_iter()
                .filter(|part| !part.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if source_text.trim().is_empty() {
                continue;
            }
            let chapter_order = chapters
                .iter()
                .find(|chapter| chapter.id == chapter_id)
                .map(|chapter| chapter.chapter_order)
                .unwrap_or(0);
            let updated_at = note
                .get("updatedAt")
                .and_then(Value::as_i64)
                .unwrap_or(chapter_updated_at);
            let (origin, authoring_status, source_status) =
                metadata(Some(note), RetrievalSourceOrigin::Author);
            drafts.push(SourceDraft::new(
                book_id,
                format!("{}:{}", chapter_id, note_id),
                RetrievalSourceKind::ForeshadowingNote,
                source_status,
                version,
                origin,
                authoring_status,
                RetrievalVisibilityScope::Chapter {
                    chapter_id: chapter_id.clone(),
                    chapter_order,
                },
                source_text,
                updated_at.max(0),
                json!({"chapterId": chapter_id, "noteId": note_id, "isRecovered": note.get("isRecovered").and_then(Value::as_bool)}),
            ));
        }
    }
    Ok(())
}

fn sync_book_sources(db: &Connection, book_id: &str) -> Result<()> {
    let mut drafts = Vec::new();
    let chapters = chapter_sources(db, book_id, &mut drafts)?;
    planning_sources(db, book_id, &chapters, &mut drafts)?;
    character_sources(db, book_id, &mut drafts)?;
    relationship_sources(db, book_id, &mut drafts)?;
    note_sources_from_db(db, book_id, &chapters, &mut drafts)?;

    let mut current_ids = HashSet::new();
    for draft in drafts {
        current_ids.insert(draft.source_id.clone());
        let existing = db
            .query_row(
                "SELECT source_version,source_text,index_text,index_status,index_version,embedding_fingerprint FROM retrieval_sources WHERE source_id=? AND book_id=?",
                params![draft.source_id, book_id],
                |row| {
                    Ok(ExistingIndexState {
                        source_version: row.get(0)?,
                        source_text: row.get(1)?,
                        index_text: row.get(2)?,
                        index_status: row.get(3)?,
                        index_version: row.get(4)?,
                        embedding_fingerprint: row.get(5)?,
                    })
                },
            )
            .optional()?;
        let unchanged = existing.as_ref().is_some_and(|state| {
            state.source_version == draft.source_version
                && state.source_text == draft.source_text
                && state.index_text == draft.index_text
        });
        let preserve_index = unchanged && draft.source_status == RetrievalSourceStatus::Active;
        let (index_status, index_version, embedding_fingerprint) = match existing {
            Some(state) if preserve_index => (
                state.index_status,
                state.index_version,
                state.embedding_fingerprint,
            ),
            Some(_) => (RetrievalIndexStatus::Stale.as_str().to_owned(), None, None),
            None => (
                RetrievalIndexStatus::NotConfigured.as_str().to_owned(),
                None,
                None,
            ),
        };
        let visibility = serde_json::to_string(&draft.visibility_scope).map_err(|_| invalid())?;
        let metadata = serde_json::to_string(&draft.entity_metadata).map_err(|_| invalid())?;
        db.execute(
            "INSERT INTO retrieval_sources(source_id,book_id,entity_id,source_kind,source_status,source_version,origin,authoring_status,visibility_scope_json,source_text,index_text,updated_at,index_status,index_version,embedding_fingerprint,entity_metadata_json)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(source_id) DO UPDATE SET
                book_id=excluded.book_id,
                entity_id=excluded.entity_id,
                source_kind=excluded.source_kind,
                source_status=excluded.source_status,
                source_version=excluded.source_version,
                origin=excluded.origin,
                authoring_status=excluded.authoring_status,
                visibility_scope_json=excluded.visibility_scope_json,
                source_text=excluded.source_text,
                index_text=excluded.index_text,
                updated_at=excluded.updated_at,
                index_status=excluded.index_status,
                index_version=excluded.index_version,
                embedding_fingerprint=excluded.embedding_fingerprint,
                entity_metadata_json=excluded.entity_metadata_json",
            params![
                draft.source_id,
                draft.book_id,
                draft.entity_id,
                draft.source_kind.as_str(),
                draft.source_status.as_str(),
                draft.source_version,
                draft.origin.as_str(),
                draft.authoring_status.as_str(),
                visibility,
                draft.source_text,
                draft.index_text,
                draft.updated_at,
                index_status,
                index_version,
                embedding_fingerprint,
                metadata,
            ],
        )?;
    }
    let existing_ids = db
        .prepare("SELECT source_id FROM retrieval_sources WHERE book_id=?")?
        .query_map([book_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for existing_id in existing_ids {
        if !current_ids.contains(&existing_id) {
            db.execute(
                "DELETE FROM retrieval_sources WHERE book_id=? AND source_id=?",
                params![book_id, existing_id],
            )?;
        }
    }
    Ok(())
}

fn read_sources(db: &Connection, book_id: &str) -> Result<Vec<RetrievalSource>> {
    let mut statement = db.prepare(
        "SELECT source_id,book_id,entity_id,source_kind,source_status,source_version,origin,authoring_status,visibility_scope_json,source_text,index_text,updated_at,index_status,index_version,embedding_fingerprint,entity_metadata_json
         FROM retrieval_sources WHERE book_id=? ORDER BY source_kind,entity_id,source_id",
    )?;
    let rows = statement.query_map([book_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, String>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, String>(12)?,
            row.get::<_, Option<i64>>(13)?,
            row.get::<_, Option<String>>(14)?,
            row.get::<_, String>(15)?,
        ))
    })?;
    let mut sources = Vec::new();
    for row in rows {
        let (
            source_id,
            book_id,
            entity_id,
            kind,
            status,
            source_version,
            origin,
            authoring_status,
            visibility,
            source_text,
            index_text,
            updated_at,
            index_status,
            index_version,
            fingerprint,
            metadata,
        ) = row?;
        sources.push(RetrievalSource {
            source_id,
            book_id,
            entity_id,
            source_kind: RetrievalSourceKind::parse(&kind)
                .ok_or_else(|| registry_error("Unknown retrieval source kind"))?,
            source_status: RetrievalSourceStatus::parse(&status)
                .ok_or_else(|| registry_error("Unknown retrieval source status"))?,
            source_version,
            origin: RetrievalSourceOrigin::parse(&origin)
                .ok_or_else(|| registry_error("Unknown retrieval source origin"))?,
            authoring_status: RetrievalAuthoringStatus::parse(&authoring_status)
                .ok_or_else(|| registry_error("Unknown retrieval authoring status"))?,
            visibility_scope: serde_json::from_str(&visibility)
                .map_err(|_| registry_error("Invalid retrieval visibility scope"))?,
            source_text,
            index_text,
            updated_at,
            index_status: RetrievalIndexStatus::parse(&index_status)
                .ok_or_else(|| registry_error("Unknown retrieval index status"))?,
            index_version,
            embedding_fingerprint: fingerprint,
            entity_metadata: parse_json(&metadata, "Invalid retrieval entity metadata")?,
        });
    }
    Ok(sources)
}

fn resolve_scope(db: &Connection, mut scope: RetrievalScope) -> Result<RetrievalScope> {
    valid_id(&scope.book_id)?;
    record(db, "books", &scope.book_id)?;
    for chapter_id in &scope.allowed_chapter_ids {
        valid_id(chapter_id)?;
        let chapter = record(db, "chapters", chapter_id)?;
        if chapter["bookId"] != scope.book_id {
            return Err(StorageError::new(
                "OWNERSHIP_MISMATCH",
                "Retrieval scope contains a chapter from another book",
            ));
        }
    }
    if let Some(order) = scope.before_chapter_order {
        if order < 0 {
            return Err(invalid());
        }
    }
    if let Some(anchor) = &scope.before_anchor {
        valid_id(&anchor.chapter_id)?;
        if anchor.paragraph_ordinal.is_some_and(|value| value < 0)
            || anchor.text_offset.is_some_and(|value| value < 0)
        {
            return Err(invalid());
        }
        let chapter = record(db, "chapters", &anchor.chapter_id)?;
        if chapter["bookId"] != scope.book_id {
            return Err(StorageError::new(
                "OWNERSHIP_MISMATCH",
                "Retrieval anchor belongs to another book",
            ));
        }
        let mut statement = db.prepare(
            "SELECT c.id FROM chapters c JOIN volumes v ON v.book_id=c.book_id AND v.id=c.volume_id
             WHERE c.book_id=? ORDER BY v.position,v.id,c.position,c.id",
        )?;
        let chapter_ids = statement
            .query_map([scope.book_id.as_str()], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let order = chapter_ids
            .iter()
            .position(|id| id == &anchor.chapter_id)
            .ok_or_else(|| registry_error("Retrieval anchor chapter is not in this book"))?
            as i64;
        if scope
            .before_chapter_order
            .is_some_and(|value| value != order)
        {
            return Err(invalid());
        }
        scope.before_chapter_order = Some(order);
    }
    Ok(scope)
}

impl Database {
    pub fn sync_retrieval_sources(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        record(&tx, "books", book_id)?;
        sync_book_sources(&tx, book_id)?;
        let sources = read_sources(&tx, book_id)?;
        tx.commit()?;
        Ok(json!(sources))
    }

    pub fn list_retrieval_sources(&mut self, input: ListRetrievalSources) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let scope = resolve_scope(&tx, input.scope)?;
        sync_book_sources(&tx, &scope.book_id)?;
        let sources = read_sources(&tx, &scope.book_id)?
            .into_iter()
            .filter(|source| source_is_visible(source, &scope))
            .collect::<Vec<_>>();
        tx.commit()?;
        Ok(json!(sources))
    }
}

pub(crate) fn sync_sources_in_transaction(db: &Connection, book_id: &str) -> Result<()> {
    sync_book_sources(db, book_id)
}
