use super::graph_types::{GraphEdge, GraphNode, GraphSnapshot, SaveGraph};
use super::graph_validation::validate_graph;
use super::records::record;
use super::validation::{expected, invalid, now, unlocked, valid_id, MAX_INTEGER};
use super::{Database, Result, StorageError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(super) fn read_graph(db: &Connection, book_id: &str) -> Result<Option<GraphSnapshot>> {
    let version = db
        .query_row(
            "SELECT database_version FROM graphs WHERE book_id=?",
            [book_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(database_version) = version else {
        return Ok(None);
    };
    let mut statement = db.prepare("SELECT node_key,character_id,position_x,position_y,handle_config_json FROM graph_nodes WHERE book_id=? ORDER BY node_key")?;
    let nodes = statement
        .query_map([book_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .map(|row| {
            let (node_key, character_id, position_x, position_y, raw) = row?;
            let handle_config = raw
                .map(|raw| {
                    serde_json::from_str(&raw).map_err(|_| {
                        StorageError::new(
                            "CONTENT_INCOMPATIBLE",
                            "Stored graph configuration is invalid",
                        )
                    })
                })
                .transpose()?;
            Ok(GraphNode {
                node_key,
                character_id,
                position_x,
                position_y,
                handle_config,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut statement = db.prepare("SELECT id,source_node_key,target_node_key,source_handle,target_handle,label FROM graph_edges WHERE book_id=? ORDER BY id")?;
    let edges = statement
        .query_map([book_id], |row| {
            Ok(GraphEdge {
                id: row.get(0)?,
                source_node_key: row.get(1)?,
                target_node_key: row.get(2)?,
                source_handle: row.get(3)?,
                target_handle: row.get(4)?,
                label: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Some(GraphSnapshot {
        book_id: book_id.into(),
        database_version,
        nodes,
        edges,
    }))
}

impl Database {
    pub fn read_graph(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self.connection.transaction()?;
        record(&tx, "books", book_id)?;
        let graph = read_graph(&tx, book_id)?;
        if let Some(graph) = &graph {
            validate_graph(&tx, book_id, &graph.nodes, &graph.edges)?;
        }
        tx.commit()?;
        Ok(json!(graph))
    }

    // Explicit, idempotent initialization. Reading never seeds or resets a graph.
    pub fn initialize_graph(&mut self, book_id: &str) -> Result<Value> {
        valid_id(book_id)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        unlocked(&record(&tx, "books", book_id)?)?;
        let time = now()?;
        tx.execute("INSERT INTO graphs(book_id,created_at,updated_at) VALUES (?,?,?) ON CONFLICT(book_id) DO NOTHING", params![book_id,time,time])?;
        let graph = read_graph(&tx, book_id)?.ok_or_else(invalid)?;
        validate_graph(&tx, book_id, &graph.nodes, &graph.edges)?;
        tx.commit()?;
        Ok(json!(graph))
    }

    pub fn save_graph(&mut self, input: SaveGraph) -> Result<Value> {
        valid_id(&input.book_id)?;
        if input.session_key.is_empty()
            || input.session_key.len() > 4096
            || !(0..=MAX_INTEGER).contains(&input.revision)
        {
            return Err(invalid());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        unlocked(&record(&tx, "books", &input.book_id)?)?;
        let graph = read_graph(&tx, &input.book_id)?
            .ok_or_else(|| StorageError::new("NOT_FOUND", "Initialize the graph before saving"))?;
        expected(
            &json!({"databaseVersion":graph.database_version}),
            input.expected_database_version,
        )?;
        validate_graph(&tx, &input.book_id, &input.nodes, &input.edges)?;
        // All replacement writes, including the version, share this transaction.
        tx.execute("DELETE FROM graph_edges WHERE book_id=?", [&input.book_id])?;
        tx.execute("DELETE FROM graph_nodes WHERE book_id=?", [&input.book_id])?;
        let time = now()?;
        for node in &input.nodes {
            let config = node.handle_config.as_ref().map(Value::to_string);
            tx.execute("INSERT INTO graph_nodes(node_key,book_id,character_id,position_x,position_y,handle_config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", params![node.node_key,input.book_id,node.character_id,node.position_x,node.position_y,config,time,time])?;
        }
        for edge in &input.edges {
            tx.execute("INSERT INTO graph_edges(id,book_id,source_node_key,target_node_key,source_handle,target_handle,label,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", params![edge.id,input.book_id,edge.source_node_key,edge.target_node_key,edge.source_handle,edge.target_handle,edge.label,time,time])?;
        }
        let changed = tx.execute("UPDATE graphs SET database_version=database_version+1,updated_at=max(updated_at,?) WHERE book_id=? AND database_version=?", params![time,input.book_id,input.expected_database_version])?;
        if changed != 1 {
            return Err(StorageError::new("VERSION_CONFLICT", "Graph changed"));
        }
        let saved = read_graph(&tx, &input.book_id)?.ok_or_else(invalid)?;
        tx.commit()?;
        Ok(json!({"graph":saved,"sessionKey":input.session_key,"revision":input.revision}))
    }
}

// Character defaults must not invalidate ports on nodes which still inherit them.
pub(super) fn character_defaults_changed(
    db: &Connection,
    book_id: &str,
    character_id: &str,
) -> Result<()> {
    if let Some(graph) = read_graph(db, book_id)? {
        if graph
            .nodes
            .iter()
            .any(|node| node.character_id == character_id && node.handle_config.is_none())
        {
            validate_graph(db, book_id, &graph.nodes, &graph.edges)?;
            expected(
                &json!({"databaseVersion":graph.database_version}),
                graph.database_version,
            )?;
            db.execute("UPDATE graphs SET database_version=database_version+1,updated_at=max(updated_at,?) WHERE book_id=?", params![now()?,book_id])?;
        }
    }
    Ok(())
}
