use super::super::records::record;
use super::super::validation::invalid;
use super::validation::{
    array, boolean, import_invalid, integer, optional_string, required, string, uuid_field,
};
use super::{ImportCounts, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) fn find_book(db: &Connection, book_id: &str) -> Result<Option<Value>> {
    let exists: Option<String> = db
        .query_row("SELECT id FROM books WHERE id=?", [book_id], |row| {
            row.get(0)
        })
        .optional()?;
    exists.map(|_| record(db, "books", book_id)).transpose()
}

fn count_json_array(db: &rusqlite::Connection, sql: &str, book_id: &str) -> Result<i64> {
    Ok(db.query_row(sql, [book_id], |row| row.get(0))?)
}

pub(super) fn stats_for_db(db: &Connection, book_id: &str) -> Result<Value> {
    Ok(json!({
        "volumes": count_json_array(db, "SELECT count(*) FROM volumes WHERE book_id=?", book_id)?,
        "chapters": count_json_array(db, "SELECT count(*) FROM chapters WHERE book_id=?", book_id)?,
        "characters": count_json_array(db, "SELECT count(*) FROM characters WHERE book_id=?", book_id)?,
        "foreshadowings": count_json_array(db, "SELECT coalesce(sum(json_array_length(foreshadowings_json)),0) FROM chapters WHERE book_id=?", book_id)?,
        "graphNodes": count_json_array(db, "SELECT count(*) FROM graph_nodes WHERE book_id=?", book_id)?,
        "graphEdges": count_json_array(db, "SELECT count(*) FROM graph_edges WHERE book_id=?", book_id)?,
        "planningSummaries": count_json_array(db, "SELECT coalesce(json_array_length(chapter_summaries_json),0) FROM planning WHERE book_id=?", book_id)?,
        "plotSettings": count_json_array(db, "SELECT coalesce(json_array_length(plot_settings_json),0) FROM planning WHERE book_id=?", book_id)?,
        "brainstormWorkspaces": count_json_array(db, "SELECT count(*) FROM brainstorm_workspaces WHERE book_id=?", book_id)?,
        "brainstormOptions": count_json_array(db, "SELECT coalesce(json_array_length(generated_options_json),0) FROM brainstorm_workspaces WHERE book_id=?", book_id)?,
    }))
}

pub(super) fn import_stats(counts: &ImportCounts) -> Value {
    json!({
        "volumes": counts.volumes,
        "chapters": counts.chapters,
        "characters": counts.characters,
        "foreshadowings": counts.foreshadowings,
        "graphNodes": counts.graph_nodes,
        "graphEdges": counts.graph_edges,
        "planningSummaries": counts.planning_summaries,
        "plotSettings": counts.plot_settings,
        "brainstormWorkspaces": counts.brainstorm_workspaces,
        "brainstormOptions": counts.brainstorm_options,
        "assets": counts.assets,
    })
}

fn title_exists(db: &rusqlite::Connection, title: &str) -> Result<bool> {
    Ok(db
        .query_row(
            "SELECT 1 FROM books WHERE title=? LIMIT 1",
            [title],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some())
}

pub(super) fn next_copy_title(db: &Connection, base: &str) -> Result<String> {
    if !title_exists(db, base)? {
        return Ok(base.to_owned());
    }
    for index in 1..=1_000_000 {
        let candidate = format!("{base} ({index})");
        if !title_exists(db, &candidate)? {
            return Ok(candidate);
        }
    }
    Err(import_invalid("No available copy name was found"))
}

fn source_version(value: &Value, key: &str, copy: bool) -> Result<i64> {
    let version = integer(value, key)?;
    Ok(if copy { 1 } else { version.max(1) })
}

fn json_string(value: &Value) -> Result<String> {
    serde_json::to_string(value).map_err(|_| import_invalid("The export contains unsupported JSON"))
}

pub(super) fn insert_work(tx: &Transaction<'_>, work: &Value, copy: bool) -> Result<String> {
    let book = required(work, "book")?;
    let book_id = uuid_field(book, "id")?;
    let book_version = source_version(book, "databaseVersion", copy)?;
    tx.execute(
        "INSERT INTO books(id,title,author,status,position,is_read_only,database_version,created_at,updated_at,cover_color) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params![
            book_id,
            string(book, "title")?,
            string(book, "author")?,
            string(book, "status")?,
            integer(book, "position")?,
            boolean(book, "isReadOnly")?,
            book_version,
            integer(book, "createdAt")?,
            integer(book, "updatedAt")?,
            optional_string(book, "coverColor")?.unwrap_or_default(),
        ],
    )?;

    for volume in array(work, "volumes")? {
        tx.execute(
            "INSERT INTO volumes(id,book_id,title,status,position,is_read_only,database_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            params![
                uuid_field(volume, "id")?,
                uuid_field(volume, "bookId")?,
                string(volume, "title")?,
                string(volume, "status")?,
                integer(volume, "position")?,
                boolean(volume, "isReadOnly")?,
                source_version(volume, "databaseVersion", copy)?,
                integer(volume, "createdAt")?,
                integer(volume, "updatedAt")?,
            ],
        )?;
    }

    let mut notes_by_chapter: HashMap<String, Vec<Value>> = HashMap::new();
    for note in array(work, "foreshadowings")? {
        notes_by_chapter
            .entry(uuid_field(note, "chapterId")?)
            .or_default()
            .push(note.clone());
    }
    for chapter in array(work, "chapters")? {
        let body_value = required(chapter, "body")?.clone();
        let _ = body_value
            .as_object()
            .ok_or_else(|| import_invalid("A chapter body is invalid"))?;
        let format = string(&body_value, "format")?;
        let content_value = required(&body_value, "content")?;
        let content = if format == "tiptap-json" {
            json_string(content_value)?
        } else {
            content_value
                .as_str()
                .ok_or_else(|| import_invalid("A legacy chapter body is invalid"))?
                .to_owned()
        };
        let original_content = optional_string(&body_value, "originalContent")?;
        let original_format = optional_string(&body_value, "originalFormat")?;
        let chapter_id = uuid_field(chapter, "id")?;
        let notes = notes_by_chapter.remove(&chapter_id).unwrap_or_default();
        tx.execute(
            "INSERT INTO chapters(id,book_id,volume_id,title,status,position,content_format,content_version,content,original_content,original_format,word_count,foreshadowings_json,is_read_only,database_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                chapter_id,
                uuid_field(chapter, "bookId")?,
                uuid_field(chapter, "volumeId")?,
                string(chapter, "title")?,
                string(chapter, "status")?,
                integer(chapter, "position")?,
                format,
                integer(&body_value, "version")?,
                content,
                original_content,
                original_format,
                integer(chapter, "wordCount")?,
                json_string(&Value::Array(notes))?,
                boolean(chapter, "isReadOnly")?,
                source_version(chapter, "databaseVersion", copy)?,
                integer(chapter, "createdAt")?,
                integer(chapter, "updatedAt")?,
            ],
        )?;
    }

    for character in array(work, "characters")? {
        tx.execute(
            "INSERT INTO characters(id,book_id,name,aliases_json,role,description,color,tags_json,avatar,handle_config_json,is_archived,position,database_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                uuid_field(character, "id")?,
                uuid_field(character, "bookId")?,
                string(character, "name")?,
                json_string(required(character, "aliases")?)?,
                string(character, "role")?,
                string(character, "description")?,
                string(character, "color")?,
                json_string(required(character, "tags")?)?,
                optional_string(character, "avatar")?,
                character.get("handleConfig").filter(|value| !value.is_null()).map(json_string).transpose()?,
                boolean(character, "isArchived")?,
                integer(character, "position")?,
                source_version(character, "databaseVersion", copy)?,
                integer(character, "createdAt")?,
                integer(character, "updatedAt")?,
            ],
        )?;
    }

    for graph in array(work, "graphs")? {
        tx.execute(
            "INSERT INTO graphs(book_id,database_version,created_at,updated_at) VALUES (?,?,?,?)",
            params![
                uuid_field(graph, "bookId")?,
                source_version(graph, "databaseVersion", copy)?,
                integer(graph, "createdAt")?,
                integer(graph, "updatedAt")?,
            ],
        )?;
        for node in array(graph, "nodes")? {
            tx.execute(
                "INSERT INTO graph_nodes(node_key,book_id,character_id,position_x,position_y,handle_config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                params![
                    uuid_field(node, "nodeKey")?,
                    uuid_field(graph, "bookId")?,
                    uuid_field(node, "characterId")?,
                    required(node, "positionX")?.as_f64().ok_or_else(invalid)?,
                    required(node, "positionY")?.as_f64().ok_or_else(invalid)?,
                    node.get("handleConfig").filter(|value| !value.is_null()).map(json_string).transpose()?,
                    node.get("createdAt").and_then(Value::as_i64).unwrap_or(integer(graph, "createdAt")?),
                    node.get("updatedAt").and_then(Value::as_i64).unwrap_or(integer(graph, "updatedAt")?),
                ],
            )?;
        }
        for edge in array(graph, "edges")? {
            tx.execute(
                "INSERT INTO graph_edges(id,book_id,source_node_key,target_node_key,source_handle,target_handle,label,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                params![
                    uuid_field(edge, "id")?,
                    uuid_field(graph, "bookId")?,
                    uuid_field(edge, "sourceNodeKey")?,
                    uuid_field(edge, "targetNodeKey")?,
                    string(edge, "sourceHandle")?,
                    string(edge, "targetHandle")?,
                    string(edge, "label")?,
                    edge.get("createdAt").and_then(Value::as_i64).unwrap_or(integer(graph, "createdAt")?),
                    edge.get("updatedAt").and_then(Value::as_i64).unwrap_or(integer(graph, "updatedAt")?),
                ],
            )?;
        }
    }

    let planning = required(work, "planning")?;
    if integer(planning, "databaseVersion")? > 0 {
        let book_created = integer(book, "createdAt")?;
        let updated = planning
            .get("updatedAt")
            .and_then(Value::as_i64)
            .unwrap_or(integer(book, "updatedAt")?)
            .max(book_created);
        tx.execute(
            "INSERT INTO planning(book_id,story_summary,story_background,chapter_summaries_json,plot_settings_json,database_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            params![
                uuid_field(planning, "bookId")?,
                string(planning, "storySummary")?,
                string(planning, "storyBackground")?,
                json_string(required(planning, "chapterSummaries")?)?,
                json_string(required(planning, "plotSettings")?)?,
                source_version(planning, "databaseVersion", copy)?,
                book_created,
                updated,
            ],
        )?;
    }

    for workspace in array(work, "brainstormWorkspaces")? {
        tx.execute(
            "INSERT INTO brainstorm_workspaces(book_id,selected_chapter_ids_json,context_snapshot_json,generated_options_json,selected_option_id,final_content,database_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            params![
                uuid_field(workspace, "bookId")?,
                json_string(required(workspace, "selectedChapterIds")?)?,
                json_string(required(workspace, "contextSnapshot")?)?,
                json_string(required(workspace, "generatedOptions")?)?,
                workspace.get("selectedOptionId").and_then(Value::as_str),
                string(workspace, "finalContent")?,
                source_version(workspace, "databaseVersion", copy)?,
                integer(workspace, "createdAt")?,
                integer(workspace, "updatedAt")?,
            ],
        )?;
    }
    Ok(book_id)
}
