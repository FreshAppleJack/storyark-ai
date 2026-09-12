use super::graph_types::{GraphEdge, GraphNode};
use super::records::record;
use super::validation::{invalid, ownership, valid_id};
use super::{Result, StorageError};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(super) fn handles(value: Option<&Value>) -> Result<Value> {
    let mut result = json!({"top":"target","right":"source","bottom":"source","left":"target"});
    if let Some(value) = value {
        let object = value.as_object().ok_or_else(invalid)?;
        for (side, mode) in object {
            if result.get(side).is_none()
                || !["source", "target", "both", "none"]
                    .contains(&mode.as_str().ok_or_else(invalid)?)
            {
                return Err(invalid());
            }
            result[side] = mode.clone();
        }
    }
    Ok(result)
}

fn port(config: &Value, handle: &str, direction: &str) -> Result<()> {
    let (side, suffix) = handle.split_once('-').ok_or_else(invalid)?;
    if suffix != direction
        || !matches!(config[side].as_str(), Some(mode) if mode == direction || mode == "both")
    {
        return Err(StorageError::new(
            "INVALID_INPUT",
            "Edge handle is unavailable; resolve its connections first",
        ));
    }
    Ok(())
}

pub(super) fn validate_graph(
    db: &Connection,
    book_id: &str,
    nodes: &[GraphNode],
    edges: &[GraphEdge],
) -> Result<()> {
    if nodes.len() > 10_000 || edges.len() > 50_000 {
        return Err(invalid());
    }
    let mut configs = HashMap::new();
    for node in nodes {
        valid_id(&node.node_key)?;
        valid_id(&node.character_id)?;
        if !node.position_x.is_finite()
            || !node.position_y.is_finite()
            || node.position_x.abs() > 1_000_000.0
            || node.position_y.abs() > 1_000_000.0
        {
            return Err(invalid());
        }
        let character = record(db, "characters", &node.character_id)?;
        ownership(&character, "bookId", book_id)?;
        let default = character
            .get("handleConfig")
            .filter(|value| !value.is_null());
        let config = handles(node.handle_config.as_ref().or(default))?;
        if configs.insert(node.node_key.as_str(), config).is_some() {
            return Err(invalid());
        }
    }
    let mut ids = HashSet::new();
    for edge in edges {
        valid_id(&edge.id)?;
        if !ids.insert(&edge.id)
            || edge.label.len() > 4096
            || edge.source_node_key == edge.target_node_key
        {
            return Err(invalid());
        }
        port(
            configs
                .get(edge.source_node_key.as_str())
                .ok_or_else(invalid)?,
            &edge.source_handle,
            "source",
        )?;
        port(
            configs
                .get(edge.target_node_key.as_str())
                .ok_or_else(invalid)?,
            &edge.target_handle,
            "target",
        )?;
    }
    Ok(())
}
