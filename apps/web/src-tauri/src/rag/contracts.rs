use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RETRIEVAL_VERSION: &str = "p1-r1-v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalSourceKind {
    Manuscript,
    ChapterSummary,
    Planning,
    ConfirmedSetting,
    Character,
    Relationship,
    ForeshadowingNote,
    FuturePlan,
}

impl RetrievalSourceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manuscript => "manuscript",
            Self::ChapterSummary => "chapter_summary",
            Self::Planning => "planning",
            Self::ConfirmedSetting => "confirmed_setting",
            Self::Character => "character",
            Self::Relationship => "relationship",
            Self::ForeshadowingNote => "foreshadowing_note",
            Self::FuturePlan => "future_plan",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "manuscript" => Self::Manuscript,
            "chapter_summary" => Self::ChapterSummary,
            "planning" => Self::Planning,
            "confirmed_setting" => Self::ConfirmedSetting,
            "character" => Self::Character,
            "relationship" => Self::Relationship,
            "foreshadowing_note" => Self::ForeshadowingNote,
            "future_plan" => Self::FuturePlan,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalSourceStatus {
    Active,
    Stale,
    Pending,
    Discarded,
}

impl RetrievalSourceStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Stale => "stale",
            Self::Pending => "pending",
            Self::Discarded => "discarded",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "active" => Self::Active,
            "stale" => Self::Stale,
            "pending" => Self::Pending,
            "discarded" => Self::Discarded,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalSourceOrigin {
    Author,
    Generated,
}

impl RetrievalSourceOrigin {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Author => "author",
            Self::Generated => "generated",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "author" => Self::Author,
            "generated" => Self::Generated,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalAuthoringStatus {
    AuthorConfirmed,
    AiSuggestion,
    Discarded,
}

impl RetrievalAuthoringStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AuthorConfirmed => "author_confirmed",
            Self::AiSuggestion => "ai_suggestion",
            Self::Discarded => "discarded",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "author_confirmed" | "confirmed" => Self::AuthorConfirmed,
            "ai_suggestion" | "suggested" => Self::AiSuggestion,
            "discarded" => Self::Discarded,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalIndexStatus {
    NotConfigured,
    Queued,
    Indexing,
    Ready,
    Partial,
    Stale,
    Failed,
}

impl RetrievalIndexStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::Queued => "queued",
            Self::Indexing => "indexing",
            Self::Ready => "ready",
            Self::Partial => "partial",
            Self::Stale => "stale",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "not_configured" => Self::NotConfigured,
            "queued" => Self::Queued,
            "indexing" => Self::Indexing,
            "ready" => Self::Ready,
            "partial" => Self::Partial,
            "stale" => Self::Stale,
            "failed" => Self::Failed,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum RetrievalVisibilityScope {
    #[serde(rename = "book")]
    Book,
    #[serde(rename = "chapter")]
    Chapter {
        #[serde(rename = "chapterId")]
        chapter_id: String,
        #[serde(rename = "chapterOrder")]
        chapter_order: i64,
    },
    #[serde(rename = "planning")]
    Planning {
        #[serde(rename = "chapterIds")]
        chapter_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalAnchor {
    pub chapter_id: String,
    pub paragraph_ordinal: Option<i64>,
    pub text_offset: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalTimeRange {
    pub updated_after: Option<i64>,
    pub updated_before: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalScope {
    pub book_id: String,
    #[serde(default)]
    pub allowed_source_kinds: Vec<RetrievalSourceKind>,
    #[serde(default)]
    pub allowed_chapter_ids: Vec<String>,
    pub before_chapter_order: Option<i64>,
    pub before_anchor: Option<RetrievalAnchor>,
    #[serde(default)]
    pub include_future_plan: bool,
    #[serde(default)]
    pub include_generated: bool,
    #[serde(default)]
    pub include_stale: bool,
    #[serde(default)]
    pub time_range: Option<RetrievalTimeRange>,
}

impl RetrievalScope {
    pub fn continue_before(book_id: String, anchor: RetrievalAnchor) -> Self {
        Self {
            book_id,
            allowed_source_kinds: vec![
                RetrievalSourceKind::Manuscript,
                RetrievalSourceKind::ChapterSummary,
                RetrievalSourceKind::ConfirmedSetting,
                RetrievalSourceKind::Character,
                RetrievalSourceKind::Relationship,
                RetrievalSourceKind::ForeshadowingNote,
            ],
            allowed_chapter_ids: Vec::new(),
            before_chapter_order: None,
            before_anchor: Some(anchor),
            include_future_plan: false,
            include_generated: false,
            include_stale: false,
            time_range: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSource {
    pub source_id: String,
    pub book_id: String,
    pub entity_id: String,
    pub source_kind: RetrievalSourceKind,
    pub source_status: RetrievalSourceStatus,
    pub source_version: i64,
    pub origin: RetrievalSourceOrigin,
    pub authoring_status: RetrievalAuthoringStatus,
    pub visibility_scope: RetrievalVisibilityScope,
    pub source_text: String,
    pub index_text: String,
    pub updated_at: i64,
    pub index_status: RetrievalIndexStatus,
    pub index_version: Option<i64>,
    pub embedding_fingerprint: Option<String>,
    pub index_updated_at: Option<i64>,
    pub entity_metadata: Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalParagraphSpan {
    pub paragraph_ordinal: i64,
    pub node_path: Vec<usize>,
    pub start_offset: i64,
    pub end_offset: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalChunkLocator {
    pub chapter_id: Option<String>,
    pub volume_id: Option<String>,
    pub chapter_title_snapshot: Option<String>,
    pub volume_title_snapshot: Option<String>,
    pub chapter_source_version: Option<i64>,
    pub chunk_ordinal: i64,
    pub paragraph_ordinals: Vec<i64>,
    pub tiptap_node_paths: Vec<Vec<usize>>,
    pub paragraph_spans: Vec<RetrievalParagraphSpan>,
    pub text_hash: String,
    pub short_quote: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalChunk {
    pub chunk_id: String,
    pub source_id: String,
    pub book_id: String,
    pub source_version: i64,
    pub index_version: i64,
    pub ordinal: i64,
    pub source_text: String,
    pub index_text: String,
    pub text_hash: String,
    pub short_quote: String,
    pub locator: RetrievalChunkLocator,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalSearchMode {
    Lexical,
    Semantic,
    Hybrid,
}

impl RetrievalSearchMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Lexical => "lexical",
            Self::Semantic => "semantic",
            Self::Hybrid => "hybrid",
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalTaskStrategy {
    #[default]
    Generic,
    Continuation,
    Brainstorm,
    ConsistencyCheck,
}

impl RetrievalTaskStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Generic => "generic",
            Self::Continuation => "continuation",
            Self::Brainstorm => "brainstorm",
            Self::ConsistencyCheck => "consistency_check",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalRecallMethod {
    Lexical,
    Alias,
    Semantic,
    Adjacent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalFreshness {
    Fresh,
    Stale,
    Pending,
    FuturePlan,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalSearchStatus {
    Ready,
    DegradedLexical,
    NoResults,
    StaleOnly,
    FuturePlanOnly,
    EmbeddingUnavailable,
    IndexNotReady,
    LexicalNoMatch,
    BudgetExhausted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSearchRequest {
    #[serde(default)]
    pub freshness_policy: Option<RetrievalFreshnessPolicy>,
    pub scope: RetrievalScope,
    pub query: String,
    #[serde(default = "default_search_mode")]
    pub mode: RetrievalSearchMode,
    #[serde(default = "default_search_limit", alias = "topK")]
    pub limit: usize,
    #[serde(default)]
    pub excluded_hit_ids: Vec<String>,
    #[serde(default = "default_char_budget")]
    pub char_budget: usize,
    #[serde(default)]
    pub token_budget: Option<usize>,
    #[serde(default = "default_adjacent_chunk_count")]
    pub adjacent_chunk_count: usize,
    #[serde(default)]
    pub task: RetrievalTaskStrategy,
    /// The frontend's last observed status is diagnostic only. The database
    /// remains authoritative when the search status is calculated.
    #[serde(default)]
    pub index_status: Option<RetrievalIndexStatus>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetrievalFreshnessPolicy {
    pub fresh_only: bool,
    pub allow_lexical_fallback: bool,
    /// Index waiting budget only; never starts indexing or generation.
    #[serde(default)]
    pub max_wait_ms: u64,
}

fn default_search_mode() -> RetrievalSearchMode {
    RetrievalSearchMode::Hybrid
}

fn default_search_limit() -> usize {
    10
}

fn default_char_budget() -> usize {
    6_000
}

fn default_adjacent_chunk_count() -> usize {
    1
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSearchHit {
    pub hit_id: String,
    pub book_id: String,
    pub source_kind: RetrievalSourceKind,
    pub entity_id: String,
    pub chapter_id: Option<String>,
    pub source_version: i64,
    pub source_updated_at: i64,
    pub index_updated_at: Option<i64>,
    pub chunk_id: String,
    pub quote: String,
    pub locator: RetrievalChunkLocator,
    pub recall_methods: Vec<RetrievalRecallMethod>,
    pub freshness: RetrievalFreshness,
    pub chunk: RetrievalChunk,
    pub score: f32,
    pub lexical_score: Option<f32>,
    pub semantic_score: Option<f32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSourceVersionRecord {
    pub source_id: String,
    pub chapter_id: Option<String>,
    pub source_version: i64,
    pub index_version: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSearchTrace {
    pub search_id: String,
    pub retrieval_version: String,
    pub task: RetrievalTaskStrategy,
    pub created_at: i64,
    pub book_id: String,
    pub chapter_id: Option<String>,
    pub scope: RetrievalScope,
    pub excluded_hit_ids: Vec<String>,
    pub index_version: Option<i64>,
    pub embedding_fingerprint: Option<String>,
    pub source_versions: Vec<RetrievalSourceVersionRecord>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalContextMaterial {
    pub hit_id: String,
    pub label: String,
    pub source_kind: RetrievalSourceKind,
    pub entity_id: String,
    pub chapter_id: Option<String>,
    pub source_version: i64,
    pub chunk_id: String,
    pub quote: String,
    pub freshness: RetrievalFreshness,
    pub recall_methods: Vec<RetrievalRecallMethod>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalContextEvidence {
    #[serde(flatten)]
    pub material: RetrievalContextMaterial,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalContext {
    pub search_id: String,
    pub retrieval_version: String,
    pub task: RetrievalTaskStrategy,
    pub requested_at: i64,
    pub book_id: String,
    pub chapter_id: Option<String>,
    pub scope: RetrievalScope,
    pub excluded_hit_ids: Vec<String>,
    pub source_versions: Vec<RetrievalSourceVersionRecord>,
    pub index_version: Option<i64>,
    pub embedding_fingerprint: Option<String>,
    pub budget: RetrievalContextBudget,
    pub materials: Vec<RetrievalContextMaterial>,
    pub evidence: Vec<RetrievalContextEvidence>,
    pub text: String,
    pub char_count: usize,
    pub token_estimate: usize,
    pub char_budget: usize,
    pub token_budget: Option<usize>,
    pub included_hit_ids: Vec<String>,
    pub omitted_hit_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalContextBudget {
    pub char_budget: usize,
    pub token_budget: Option<usize>,
}

pub type RetrievalRequest = RetrievalSearchRequest;
pub type RetrievalHit = RetrievalSearchHit;
pub type RetrievalTrace = RetrievalSearchTrace;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSearchResponse {
    pub requested_mode: RetrievalSearchMode,
    pub effective_mode: RetrievalSearchMode,
    pub status: RetrievalSearchStatus,
    pub degraded: bool,
    pub degradation_reason: Option<String>,
    pub embedding_available: bool,
    pub retrieval_version: String,
    pub score_semantics: String,
    pub lexical_match_count: usize,
    pub semantic_match_count: usize,
    pub trace: RetrievalSearchTrace,
    pub context: RetrievalContext,
    pub hits: Vec<RetrievalSearchHit>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalIndexJobState {
    Queued,
    Indexing,
    Paused,
    Cancelled,
    Completed,
    Failed,
}

impl RetrievalIndexJobState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Indexing => "indexing",
            Self::Paused => "paused",
            Self::Cancelled => "cancelled",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "queued" => Self::Queued,
            "indexing" => Self::Indexing,
            "paused" => Self::Paused,
            "cancelled" => Self::Cancelled,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalIndexJob {
    pub job_id: String,
    pub book_id: String,
    pub source_id: String,
    pub source_version: i64,
    pub index_version: i64,
    pub embedding_fingerprint: String,
    pub state: RetrievalIndexJobState,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
