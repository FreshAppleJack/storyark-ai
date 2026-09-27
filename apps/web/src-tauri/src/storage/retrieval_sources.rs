use super::records::record;
use super::validation::{invalid, valid_id};
use super::{Database, Result, StorageError};
use crate::rag::chunking::{
    chunk_blocks, chunk_id, locator as chunk_locator, stable_text_hash, text_blocks, tiptap_blocks,
    ChunkBlock, ChunkDraft, CHUNK_INDEX_VERSION,
};
use crate::rag::contracts::{
    RetrievalAuthoringStatus, RetrievalChunk, RetrievalChunkLocator, RetrievalIndexStatus,
    RetrievalScope, RetrievalSource, RetrievalSourceKind, RetrievalSourceOrigin,
    RetrievalSourceStatus, RetrievalVisibilityScope,
};
use crate::rag::lexical::fts_document_text;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRetrievalChunks {
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
    volume_id: String,
    volume_title: String,
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
        "SELECT c.id,c.volume_id,v.title,c.title,c.database_version,c.content_format,c.content,c.updated_at
         FROM chapters c JOIN volumes v ON v.book_id=c.book_id AND v.id=c.volume_id
         WHERE c.book_id=? ORDER BY v.position,v.id,c.position,c.id",
    )?;
    let rows = statement.query_map([book_id], |row| {
        Ok(ChapterContext {
            id: row.get(0)?,
            volume_id: row.get(1)?,
            volume_title: row.get(2)?,
            title: row.get(3)?,
            source_version: row.get(4)?,
            content_format: row.get(5)?,
            content: row.get(6)?,
            updated_at: row.get(7)?,
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
        let source_text = body_text.unwrap_or_default();
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
        let snapshot_version = summary
            .get("sourceSnapshot")
            .filter(|snapshot| snapshot["chapterId"].as_str() == Some(chapter_id))
            .and_then(|snapshot| snapshot["chapterDatabaseVersion"].as_i64());
        let source_status = match recorded_version {
            Some(value) if value == chapter.source_version && snapshot_version == Some(value) => {
                RetrievalSourceStatus::Active
            }
            Some(value) if value == chapter.source_version => RetrievalSourceStatus::Pending,
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
            json!({"isArchived": archived, "aliases": aliases}),
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

fn chapter_for_source<'a>(
    draft: &SourceDraft,
    chapters: &'a [ChapterContext],
) -> Option<&'a ChapterContext> {
    let chapter_id = match &draft.visibility_scope {
        RetrievalVisibilityScope::Chapter { chapter_id, .. } => chapter_id,
        _ => return None,
    };
    chapters.iter().find(|chapter| &chapter.id == chapter_id)
}

fn blocks_for_source(draft: &SourceDraft, chapters: &[ChapterContext]) -> Vec<ChunkBlock> {
    if draft.source_kind != RetrievalSourceKind::Manuscript {
        return text_blocks(&draft.source_text);
    }
    let Some(chapter) = chapter_for_source(draft, chapters) else {
        return Vec::new();
    };
    if chapter.content_format != "tiptap-json" {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(&chapter.content) else {
        return Vec::new();
    };
    let Some(body_blocks) = tiptap_blocks(&value) else {
        return Vec::new();
    };
    body_blocks
}

fn locator_for_source(
    draft: &SourceDraft,
    chapters: &[ChapterContext],
    chunk: &ChunkDraft,
) -> RetrievalChunkLocator {
    let chapter = chapter_for_source(draft, chapters);
    chunk_locator(
        chunk,
        chapter.map(|value| value.id.clone()),
        chapter.map(|value| value.volume_id.clone()),
        chapter.map(|value| value.title.clone()),
        chapter.map(|value| value.volume_title.clone()),
        chapter.map(|value| value.source_version),
    )
}

fn sync_book_chunks(
    db: &Connection,
    book_id: &str,
    drafts: &[SourceDraft],
    chapters: &[ChapterContext],
) -> Result<()> {
    for draft in drafts {
        let chunks = chunk_blocks(&blocks_for_source(draft, chapters));
        db.execute(
            "DELETE FROM retrieval_chunks_fts WHERE source_id=? AND source_version=? AND index_version=?",
            params![draft.source_id, draft.source_version, CHUNK_INDEX_VERSION],
        )?;
        for chunk in chunks {
            let locator = locator_for_source(draft, chapters, &chunk);
            let locator_json = serde_json::to_string(&locator).map_err(|_| invalid())?;
            db.execute(
                "INSERT OR IGNORE INTO retrieval_chunks(chunk_id,source_id,book_id,source_version,index_version,ordinal,source_text,index_text,text_hash,short_quote,locator_json,created_at,embedding_blob)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
                params![
                    chunk_id(
                        &draft.source_id,
                        draft.source_version,
                        chunk.ordinal,
                        &chunk.text_hash
                    ),
                    draft.source_id,
                    book_id,
                    draft.source_version,
                    CHUNK_INDEX_VERSION,
                    chunk.ordinal,
                    chunk.source_text,
                    chunk.index_text,
                    chunk.text_hash,
                    chunk.short_quote,
                    locator_json,
                    draft.updated_at,
                ],
            )?;
            db.execute(
                "INSERT INTO retrieval_chunks_fts(chunk_id,book_id,source_id,source_version,index_version,search_text)
                 VALUES (?,?,?,?,?,?)",
                params![
                    chunk_id(
                        &draft.source_id,
                        draft.source_version,
                        chunk.ordinal,
                        &chunk.text_hash
                    ),
                    book_id,
                    draft.source_id,
                    draft.source_version,
                    CHUNK_INDEX_VERSION,
                    fts_document_text(&chunk.index_text),
                ],
            )?;
        }
        // Older extraction could mark a source ready without any chunks. Newly
        // recovered chunks need embeddings even when the author's text is unchanged.
        let repaired = db.execute(
            "UPDATE retrieval_sources SET index_status='stale',embedding_fingerprint=NULL
             WHERE source_id=?1 AND index_status='ready' AND EXISTS (
                 SELECT 1 FROM retrieval_chunks WHERE source_id=?1 AND source_version=?2
                 AND index_version=?3 AND embedding_blob IS NULL)",
            params![draft.source_id, draft.source_version, CHUNK_INDEX_VERSION],
        )?;
        if repaired > 0 && draft.source_status == RetrievalSourceStatus::Active {
            super::retrieval_scheduler::mark_dirty(
                db,
                book_id,
                &draft.source_id,
                draft.source_version,
            )?;
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
    for draft in &drafts {
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
        if !unchanged
            && draft.source_status == RetrievalSourceStatus::Active
            && !draft.source_text.trim().is_empty()
        {
            super::retrieval_scheduler::mark_dirty(
                db,
                book_id,
                &draft.source_id,
                draft.source_version,
            )?;
        }
    }
    let existing_ids = db
        .prepare("SELECT source_id FROM retrieval_sources WHERE book_id=?")?
        .query_map([book_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for existing_id in existing_ids {
        if !current_ids.contains(&existing_id) {
            db.execute(
                "DELETE FROM retrieval_chunks_fts WHERE source_id=?",
                [&existing_id],
            )?;
            db.execute(
                "DELETE FROM retrieval_sources WHERE book_id=? AND source_id=?",
                params![book_id, existing_id],
            )?;
        }
    }
    sync_book_chunks(db, book_id, &drafts, &chapters)?;
    Ok(())
}

pub(crate) fn read_sources(db: &Connection, book_id: &str) -> Result<Vec<RetrievalSource>> {
    let mut statement = db.prepare(
        "SELECT s.source_id,s.book_id,s.entity_id,s.source_kind,s.source_status,s.source_version,s.origin,s.authoring_status,s.visibility_scope_json,s.source_text,s.index_text,s.updated_at,s.index_status,s.index_version,s.embedding_fingerprint,
                (SELECT MAX(j.updated_at) FROM retrieval_index_jobs j
                 WHERE j.source_id=s.source_id AND j.book_id=s.book_id
                   AND j.source_version=s.source_version AND j.index_version=s.index_version
                   AND j.embedding_fingerprint=s.embedding_fingerprint AND j.state='completed') AS index_updated_at,
                s.entity_metadata_json
         FROM retrieval_sources s WHERE s.book_id=? ORDER BY s.source_kind,s.entity_id,s.source_id",
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
            row.get::<_, Option<i64>>(15)?,
            row.get::<_, String>(16)?,
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
            index_updated_at,
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
            index_updated_at,
            entity_metadata: parse_json(&metadata, "Invalid retrieval entity metadata")?,
        });
    }
    Ok(sources)
}

pub(crate) fn read_chunks(db: &Connection, scope: &RetrievalScope) -> Result<Vec<RetrievalChunk>> {
    let visible_sources = read_sources(db, &scope.book_id)?
        .into_iter()
        .filter(|source| source_is_visible(source, scope))
        .map(|source| (source.source_id.clone(), source))
        .collect::<HashMap<_, _>>();
    if visible_sources.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare(
        "SELECT c.chunk_id,c.source_id,c.book_id,c.source_version,c.index_version,c.ordinal,
                c.source_text,c.index_text,c.text_hash,c.short_quote,c.locator_json
         FROM retrieval_chunks c
         JOIN retrieval_sources s ON s.source_id=c.source_id AND s.book_id=c.book_id
         WHERE c.book_id=? AND c.source_version=s.source_version AND c.index_version=?
         ORDER BY c.source_id,c.ordinal,c.chunk_id",
    )?;
    let rows = statement.query_map(params![scope.book_id, CHUNK_INDEX_VERSION], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, String>(9)?,
            row.get::<_, String>(10)?,
        ))
    })?;
    let mut chunks = Vec::new();
    for row in rows {
        let (
            chunk_id,
            source_id,
            book_id,
            source_version,
            index_version,
            ordinal,
            source_text,
            index_text,
            text_hash,
            short_quote,
            locator_json,
        ) = row?;
        if !visible_sources.contains_key(&source_id) {
            continue;
        }
        let locator: RetrievalChunkLocator = serde_json::from_str(&locator_json)
            .map_err(|_| registry_error("Invalid retrieval chunk locator"))?;
        if let Some(anchor) = &scope.before_anchor {
            if locator.chapter_id.as_deref() == Some(anchor.chapter_id.as_str()) {
                let Some(source) = visible_sources.get(&source_id) else {
                    continue;
                };
                // The current chapter can only contribute locator-backed
                // manuscript chunks before the anchor. A chapter summary or
                // note has no paragraph boundary and may contain later text.
                if source.source_kind != crate::rag::contracts::RetrievalSourceKind::Manuscript
                    || locator.paragraph_spans.is_empty()
                    || !locator.paragraph_spans.iter().all(|span| {
                        let before_paragraph = anchor
                            .paragraph_ordinal
                            .is_some_and(|ordinal| span.paragraph_ordinal < ordinal);
                        let before_offset = anchor
                            .paragraph_ordinal
                            .zip(anchor.text_offset)
                            .is_some_and(|(ordinal, offset)| {
                                span.paragraph_ordinal == ordinal && span.end_offset <= offset
                            });
                        before_paragraph || before_offset
                    })
                {
                    continue;
                }
            }
        }
        if locator.text_hash != text_hash
            || locator.chunk_ordinal != ordinal
            || stable_text_hash(&source_text) != text_hash
        {
            return Err(registry_error(
                "Retrieval chunk locator does not match its row",
            ));
        }
        chunks.push(RetrievalChunk {
            chunk_id,
            source_id,
            book_id,
            source_version,
            index_version,
            ordinal,
            source_text,
            index_text,
            text_hash,
            short_quote,
            locator,
        });
    }
    Ok(chunks)
}

pub(crate) fn resolve_scope(db: &Connection, mut scope: RetrievalScope) -> Result<RetrievalScope> {
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
    if let Some(range) = &scope.time_range {
        if range.updated_after.is_some_and(|value| value < 0)
            || range.updated_before.is_some_and(|value| value < 0)
            || range
                .updated_after
                .zip(range.updated_before)
                .is_some_and(|(after, before)| after > before)
        {
            return Err(invalid());
        }
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
        // Saves maintain the registry transactionally. Only bootstrap books
        // predating the registry; status polling must not re-chunk a whole book.
        let registered: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM retrieval_sources WHERE book_id=?)",
            [&scope.book_id],
            |row| row.get(0),
        )?;
        if !registered {
            sync_book_sources(&tx, &scope.book_id)?;
        }
        let sources = read_sources(&tx, &scope.book_id)?
            .into_iter()
            .filter(|source| source_is_visible(source, &scope))
            .collect::<Vec<_>>();
        tx.commit()?;
        Ok(json!(sources))
    }

    pub fn list_retrieval_chunks(&mut self, input: ListRetrievalChunks) -> Result<Value> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let scope = resolve_scope(&tx, input.scope)?;
        sync_book_sources(&tx, &scope.book_id)?;
        let chunks = read_chunks(&tx, &scope)?;
        tx.commit()?;
        Ok(json!(chunks))
    }
}

pub(crate) fn sync_sources_in_transaction(db: &Connection, book_id: &str) -> Result<()> {
    sync_book_sources(db, book_id)
}

// Reordering changes the scope used by "before current chapter" retrieval,
// but not source text, chunk locators or embeddings. Keep the index intact.
pub(crate) fn sync_order_metadata_in_transaction(db: &Connection, book_id: &str) -> Result<()> {
    let registered: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM retrieval_sources WHERE book_id=?)",
        [book_id],
        |row| row.get(0),
    )?;
    if !registered {
        return sync_book_sources(db, book_id);
    }
    let chapter_ids = db
        .prepare(
            "SELECT c.id FROM chapters c JOIN volumes v ON v.id=c.volume_id
             WHERE c.book_id=? ORDER BY v.position,v.id,c.position,c.id",
        )?
        .query_map([book_id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (order, chapter_id) in chapter_ids.iter().enumerate() {
        db.execute(
            "UPDATE retrieval_sources
             SET visibility_scope_json=json_set(visibility_scope_json,'$.chapterOrder',?1)
             WHERE book_id=?2 AND json_extract(visibility_scope_json,'$.kind')='chapter'
               AND json_extract(visibility_scope_json,'$.chapterId')=?3
               AND json_extract(visibility_scope_json,'$.chapterOrder')<>?1",
            params![order as i64, book_id, chapter_id],
        )?;
    }
    Ok(())
}
