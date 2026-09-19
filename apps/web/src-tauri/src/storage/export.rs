use super::brainstorm::{self, SaveBrainstorm};
use super::content;
use super::graph_types::{GraphEdge, GraphNode};
use super::graph_validation::validate_graph;
use super::planning;
use super::records::{record, rows};
use super::validation::{invalid, valid_id};
use super::{Database, Result, StorageError};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

fn parse_json(raw: &str, message: &str) -> Result<Value> {
    serde_json::from_str(raw).map_err(|_| StorageError::new("CONTENT_INCOMPATIBLE", message))
}

fn parse_optional_json(raw: Option<String>, message: &str) -> Result<Option<Value>> {
    raw.map(|value| parse_json(&value, message)).transpose()
}

fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|id| id.to_string() == value)
        .unwrap_or(false)
}

fn validate_tiptap_references(
    value: &Value,
    note_ids: &HashSet<String>,
    character_ids: &HashSet<String>,
) -> Result<()> {
    let object = value.as_object().ok_or_else(invalid)?;
    if let Some(marks) = object.get("marks") {
        for mark in marks.as_array().ok_or_else(invalid)? {
            let mark = mark.as_object().ok_or_else(invalid)?;
            if mark.get("type").and_then(Value::as_str) == Some("foreshadowing") {
                let id = mark
                    .get("attrs")
                    .and_then(Value::as_object)
                    .and_then(|attrs| attrs.get("id"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        StorageError::new(
                            "CONTENT_INCOMPATIBLE",
                            "A foreshadowing mark has no note reference",
                        )
                    })?;
                if !note_ids.contains(id) {
                    return Err(StorageError::new(
                        "CONTENT_INCOMPATIBLE",
                        "A foreshadowing mark references a missing note",
                    ));
                }
            }
        }
    }
    if object.get("type").and_then(Value::as_str) == Some("mention") {
        if let Some(attrs) = object.get("attrs").and_then(Value::as_object) {
            for key in ["id", "characterId"] {
                if let Some(character_id) = attrs.get(key).and_then(Value::as_str) {
                    if canonical_uuid(character_id) && !character_ids.contains(character_id) {
                        return Err(StorageError::new(
                            "CONTENT_INCOMPATIBLE",
                            "A mention references a missing character",
                        ));
                    }
                }
            }
        }
    }
    if let Some(children) = object.get("content") {
        for child in children.as_array().ok_or_else(invalid)? {
            validate_tiptap_references(child, note_ids, character_ids)?;
        }
    }
    Ok(())
}

fn validate_chapter_for_export(chapter: &Value, character_ids: &HashSet<String>) -> Result<()> {
    let body = chapter
        .get("body")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            StorageError::new("CONTENT_INCOMPATIBLE", "Stored chapter body is invalid")
        })?;
    let notes = chapter
        .get("foreshadowings")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            StorageError::new("CONTENT_INCOMPATIBLE", "Stored chapter notes are invalid")
        })?;
    content::notes(notes)?;
    let note_ids = notes
        .iter()
        .filter_map(|note| note.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect::<HashSet<_>>();

    if body.get("format").and_then(Value::as_str) == Some("tiptap-json") {
        let raw = body.get("content").and_then(Value::as_str).ok_or_else(|| {
            StorageError::new("CONTENT_INCOMPATIBLE", "Stored chapter JSON is invalid")
        })?;
        match body.get("contentState").and_then(Value::as_str) {
            Some("editable") => content::validate(raw)?,
            Some("read-only") | Some("pending-migration") => content::validate_preserved(raw)?,
            _ => {
                return Err(StorageError::new(
                    "CONTENT_INCOMPATIBLE",
                    "Stored chapter content state is invalid",
                ))
            }
        }
        let document = parse_json(raw, "Stored chapter JSON is invalid")?;
        validate_tiptap_references(&document, &note_ids, character_ids)?;
    } else {
        let content = body.get("content").and_then(Value::as_str);
        let original_content = body.get("originalContent").and_then(Value::as_str);
        let original_format = body.get("originalFormat").and_then(Value::as_str);
        if content.is_none() || original_content.is_none() || original_format.is_none() {
            return Err(StorageError::new(
                "CONTENT_INCOMPATIBLE",
                "Legacy chapter content must retain its original source",
            ));
        }
    }
    Ok(())
}

fn read_graph_for_export(db: &Connection, book_id: &str) -> Result<Option<Value>> {
    let aggregate = db
        .query_row(
            "SELECT database_version,created_at,updated_at FROM graphs WHERE book_id=?",
            [book_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((database_version, created_at, updated_at)) = aggregate else {
        return Ok(None);
    };

    let mut node_statement = db.prepare(
        "SELECT node_key,character_id,position_x,position_y,handle_config_json,created_at,updated_at FROM graph_nodes WHERE book_id=? ORDER BY node_key",
    )?;
    let mut node_cursor = node_statement.query([book_id])?;
    let mut nodes = Vec::new();
    let mut node_values = Vec::new();
    while let Some(row) = node_cursor.next()? {
        let node_key: String = row.get(0)?;
        let character_id: String = row.get(1)?;
        let position_x: f64 = row.get(2)?;
        let position_y: f64 = row.get(3)?;
        let handle_config =
            parse_optional_json(row.get(4)?, "Stored graph configuration is invalid")?;
        let created_at: i64 = row.get(5)?;
        let updated_at: i64 = row.get(6)?;
        nodes.push(GraphNode {
            node_key: node_key.clone(),
            character_id: character_id.clone(),
            position_x,
            position_y,
            handle_config: handle_config.clone(),
        });
        node_values.push(json!({
            "nodeKey": node_key,
            "characterId": character_id,
            "positionX": position_x,
            "positionY": position_y,
            "handleConfig": handle_config,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }));
    }

    let mut edge_statement = db.prepare(
        "SELECT id,source_node_key,target_node_key,source_handle,target_handle,label,created_at,updated_at FROM graph_edges WHERE book_id=? ORDER BY id",
    )?;
    let mut edge_cursor = edge_statement.query([book_id])?;
    let mut edges = Vec::new();
    let mut edge_values = Vec::new();
    while let Some(row) = edge_cursor.next()? {
        let id: String = row.get(0)?;
        let source_node_key: String = row.get(1)?;
        let target_node_key: String = row.get(2)?;
        let source_handle: Option<String> = row.get(3)?;
        let target_handle: Option<String> = row.get(4)?;
        let source_handle = source_handle.ok_or_else(|| {
            StorageError::new(
                "CONTENT_INCOMPATIBLE",
                "Stored graph source handle is missing",
            )
        })?;
        let target_handle = target_handle.ok_or_else(|| {
            StorageError::new(
                "CONTENT_INCOMPATIBLE",
                "Stored graph target handle is missing",
            )
        })?;
        let label: String = row.get(5)?;
        let created_at: i64 = row.get(6)?;
        let updated_at: i64 = row.get(7)?;
        edges.push(GraphEdge {
            id: id.clone(),
            source_node_key: source_node_key.clone(),
            target_node_key: target_node_key.clone(),
            source_handle: source_handle.clone(),
            target_handle: target_handle.clone(),
            label: label.clone(),
        });
        edge_values.push(json!({
            "id": id,
            "sourceNodeKey": source_node_key,
            "targetNodeKey": target_node_key,
            "sourceHandle": source_handle,
            "targetHandle": target_handle,
            "label": label,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }));
    }

    validate_graph(db, book_id, &nodes, &edges)?;
    Ok(Some(json!({
        "bookId": book_id,
        "databaseVersion": database_version,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "nodes": node_values,
        "edges": edge_values,
    })))
}

impl Database {
    /// Read the complete owned work from one SQLite read transaction. This
    /// intentionally returns only persisted work data; preferences, AI
    /// credentials, runtime candidates and derived indexes stay outside the
    /// exchange boundary.
    pub fn read_work_export_snapshot(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self.connection.transaction()?;
        let book = record(&tx, "books", book_id)?;
        let volumes = rows(
            &tx,
            "SELECT * FROM volumes WHERE book_id=? ORDER BY position,id",
            &[&book_id],
        )?;
        let chapters = rows(
            &tx,
            "SELECT c.* FROM chapters c JOIN volumes v ON v.id=c.volume_id WHERE c.book_id=? ORDER BY v.position,v.id,c.position,c.id",
            &[&book_id],
        )?;
        let characters = rows(
            &tx,
            "SELECT * FROM characters WHERE book_id=? ORDER BY position,id",
            &[&book_id],
        )?;
        let character_ids = characters
            .iter()
            .filter_map(|character| {
                character
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect::<HashSet<_>>();
        for chapter in &chapters {
            validate_chapter_for_export(chapter, &character_ids)?;
        }

        let graph = read_graph_for_export(&tx, book_id)?;
        let planning = planning::read(&tx, book_id)?;
        let brainstorm_workspace = brainstorm::read(&tx, book_id)?;
        if brainstorm_workspace
            .get("databaseVersion")
            .and_then(Value::as_i64)
            .is_some_and(|version| version > 0)
        {
            let input = SaveBrainstorm {
                book_id: book_id.to_owned(),
                expected_database_version: brainstorm_workspace["databaseVersion"]
                    .as_i64()
                    .ok_or_else(invalid)?,
                selected_chapter_ids: brainstorm_workspace["selectedChapterIds"].clone(),
                context_snapshot: brainstorm_workspace["contextSnapshot"].clone(),
                generated_options: brainstorm_workspace["generatedOptions"].clone(),
                selected_option_id: brainstorm_workspace["selectedOptionId"]
                    .as_str()
                    .map(str::to_owned),
                final_content: brainstorm_workspace["finalContent"]
                    .as_str()
                    .ok_or_else(invalid)?
                    .to_owned(),
                session_key: "export-read".into(),
                revision: 0,
            };
            brainstorm::validate(&tx, book_id, &input)?;
        }
        let database_version: i64 =
            tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
        tx.commit()?;
        Ok(json!({
            "databaseVersion": database_version,
            "book": book,
            "volumes": volumes,
            "chapters": chapters,
            "characters": characters,
            "graph": graph,
            "planning": planning,
            "brainstormWorkspace": if brainstorm_workspace["databaseVersion"] == 0 { Value::Null } else { brainstorm_workspace },
        }))
    }
}
