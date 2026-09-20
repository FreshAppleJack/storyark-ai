use super::sources::normalize_index_text;

pub const LEXICAL_NORMALIZATION_VERSION: i64 = 1;
pub const FTS_TOKENIZER: &str = "unicode61";

pub fn fts_document_text(value: &str) -> String {
    let normalized = normalize_index_text(value);
    let mut tokens = vec![normalized.clone()];
    for run in cjk_runs(&normalized) {
        tokens.extend(ngram_tokens(run));
    }
    tokens.join(" ")
}

pub fn fts_query(value: &str) -> Option<String> {
    let normalized = normalize_index_text(value);
    let mut terms = Vec::new();
    let mut ascii = String::new();
    for character in normalized.chars() {
        if is_cjk(character) {
            flush_ascii(&mut terms, &mut ascii);
        } else if character.is_ascii_alphanumeric() || character == '_' {
            ascii.push(character);
        } else {
            flush_ascii(&mut terms, &mut ascii);
        }
    }
    flush_ascii(&mut terms, &mut ascii);
    for run in cjk_runs(&normalized) {
        terms.extend(ngram_tokens(run));
    }
    terms.sort();
    terms.dedup();
    (!terms.is_empty()).then(|| {
        terms
            .into_iter()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ")
    })
}

fn flush_ascii(terms: &mut Vec<String>, ascii: &mut String) {
    if !ascii.is_empty() {
        terms.push(std::mem::take(ascii));
    }
}

fn cjk_runs(value: &str) -> Vec<&str> {
    let mut runs = Vec::new();
    let mut start = None;
    for (index, character) in value.char_indices() {
        if is_cjk(character) {
            start.get_or_insert(index);
        } else if let Some(run_start) = start.take() {
            runs.push(&value[run_start..index]);
        }
    }
    if let Some(run_start) = start {
        runs.push(&value[run_start..]);
    }
    runs
}

fn ngram_tokens(run: &str) -> Vec<String> {
    let characters = run.chars().collect::<Vec<_>>();
    if characters.is_empty() {
        return Vec::new();
    }
    let mut tokens = Vec::new();
    for size in [2usize, 3] {
        if characters.len() < size {
            continue;
        }
        for window in characters.windows(size) {
            let token = window.iter().collect::<String>();
            tokens.push(format!("cjk{size}_{token}"));
        }
    }
    if tokens.is_empty() {
        tokens.extend(
            characters
                .into_iter()
                .map(|character| format!("cjk1_{character}")),
        );
    }
    tokens
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2FA1F
    )
}
