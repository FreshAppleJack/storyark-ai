use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNode {
    pub node_key: String,
    pub character_id: String,
    pub position_x: f64,
    pub position_y: f64,
    pub handle_config: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphEdge {
    pub id: String,
    pub source_node_key: String,
    pub target_node_key: String,
    pub source_handle: String,
    pub target_handle: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphSnapshot {
    pub book_id: String,
    pub database_version: i64,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveGraph {
    pub book_id: String,
    pub expected_database_version: i64,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub session_key: String,
    pub revision: i64,
}
