use crate::rag::contracts::RetrievalRecallMethod;

pub const RRF_K: f32 = 60.0;
pub const DEFAULT_ADJACENT_CHUNKS: usize = 1;
pub const MAX_CONTEXT_CHAR_BUDGET: usize = 64_000;
pub const MAX_CONTEXT_TOKEN_BUDGET: usize = 16_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContextItem {
    pub hit_id: String,
    pub label: String,
    pub text: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssembledContext {
    pub text: String,
    pub char_count: usize,
    pub token_estimate: usize,
    pub included_hit_ids: Vec<String>,
    pub omitted_hit_ids: Vec<String>,
}

pub fn rrf_score(lexical_rank: Option<usize>, semantic_rank: Option<usize>) -> f32 {
    lexical_rank
        .map(|rank| 1.0 / (RRF_K + rank as f32))
        .unwrap_or(0.0)
        + semantic_rank
            .map(|rank| 1.0 / (RRF_K + rank as f32))
            .unwrap_or(0.0)
}

pub fn estimate_tokens(value: &str) -> usize {
    let mut estimate = 0usize;
    let mut ascii_run = 0usize;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            ascii_run += 1;
            continue;
        }
        if ascii_run > 0 {
            estimate += ascii_run.div_ceil(4);
            ascii_run = 0;
        }
        if !character.is_whitespace() {
            estimate += 1;
        }
    }
    if ascii_run > 0 {
        estimate += ascii_run.div_ceil(4);
    }
    estimate
}

pub fn assemble_context(
    items: &[ContextItem],
    char_budget: usize,
    token_budget: Option<usize>,
) -> AssembledContext {
    let mut text = String::new();
    let mut char_count = 0usize;
    let mut token_estimate = 0usize;
    let mut included_hit_ids = Vec::new();
    let mut omitted_hit_ids = Vec::new();

    for item in items {
        let candidate = if item.label.is_empty() {
            item.text.clone()
        } else {
            format!("[{}]\n{}", item.label, item.text)
        };
        let separator = usize::from(!text.is_empty()) * 2;
        let candidate_chars = candidate.chars().count();
        let candidate_tokens = estimate_tokens(&candidate);
        let within_chars = char_count
            .saturating_add(separator)
            .saturating_add(candidate_chars)
            <= char_budget;
        let within_tokens = token_budget.map_or(true, |budget| {
            token_estimate
                .saturating_add(usize::from(!text.is_empty()))
                .saturating_add(candidate_tokens)
                <= budget
        });
        if within_chars && within_tokens {
            if !text.is_empty() {
                text.push_str("\n\n");
                char_count += 2;
                token_estimate += 1;
            }
            text.push_str(&candidate);
            char_count += candidate_chars;
            token_estimate += candidate_tokens;
            included_hit_ids.push(item.hit_id.clone());
        } else {
            omitted_hit_ids.push(item.hit_id.clone());
        }
    }

    AssembledContext {
        text,
        char_count,
        token_estimate,
        included_hit_ids,
        omitted_hit_ids,
    }
}

pub fn add_recall_method(methods: &mut Vec<RetrievalRecallMethod>, method: RetrievalRecallMethod) {
    if !methods.contains(&method) {
        methods.push(method);
    }
}
