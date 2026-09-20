use super::contracts::{
    RetrievalAuthoringStatus, RetrievalScope, RetrievalSource, RetrievalSourceKind,
    RetrievalSourceOrigin, RetrievalSourceStatus, RetrievalVisibilityScope,
};
use serde_json::Value;

pub fn source_id(book_id: &str, kind: &RetrievalSourceKind, entity_id: &str) -> String {
    format!("{}:{}:{}", book_id, kind.as_str(), entity_id)
}

pub fn normalize_index_text(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut pending_space = false;
    for character in value.chars() {
        if character.is_whitespace() {
            pending_space = !output.is_empty();
            continue;
        }
        if pending_space {
            output.push(' ');
        }
        pending_space = false;
        if character.is_ascii() {
            output.extend(character.to_lowercase());
        } else {
            output.push(character);
        }
    }
    output.trim().to_owned()
}

pub fn tiptap_text(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    if object.get("type")?.as_str()? != "doc" {
        return None;
    }
    let mut output = String::new();
    append_tiptap_node(value, &mut output).then_some(output.trim().to_owned())
}

fn append_tiptap_node(value: &Value, output: &mut String) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let Some(kind) = object.get("type").and_then(Value::as_str) else {
        return false;
    };
    match kind {
        "doc" | "paragraph" | "heading" | "blockquote" | "bulletList" | "orderedList"
        | "listItem" | "codeBlock" => {
            let Some(children) = object.get("content").and_then(Value::as_array) else {
                return kind == "paragraph" || kind == "heading";
            };
            for child in children {
                if !append_tiptap_node(child, output) {
                    return false;
                }
            }
            if kind != "doc" && kind != "listItem" {
                output.push('\n');
            }
            true
        }
        "text" => {
            let Some(text) = object.get("text").and_then(Value::as_str) else {
                return false;
            };
            output.push_str(text);
            true
        }
        "mention" => {
            let attrs = object.get("attrs").and_then(Value::as_object);
            let label = attrs
                .and_then(|attrs| attrs.get("label"))
                .and_then(Value::as_str)
                .or_else(|| {
                    attrs
                        .and_then(|attrs| attrs.get("id"))
                        .and_then(Value::as_str)
                });
            let Some(label) = label else {
                return false;
            };
            output.push_str(label);
            true
        }
        "hardBreak" => {
            output.push('\n');
            true
        }
        "horizontalRule" => {
            output.push('\n');
            true
        }
        _ => false,
    }
}

pub fn source_is_visible(source: &RetrievalSource, scope: &RetrievalScope) -> bool {
    if source.book_id != scope.book_id {
        return false;
    }
    if source.source_status == RetrievalSourceStatus::Discarded
        || (source.source_status != RetrievalSourceStatus::Active && !scope.include_stale)
    {
        return false;
    }
    if !scope.allowed_source_kinds.is_empty()
        && !scope
            .allowed_source_kinds
            .iter()
            .any(|kind| kind == &source.source_kind)
    {
        return false;
    }
    if !scope.include_future_plan && source.source_kind == RetrievalSourceKind::FuturePlan {
        return false;
    }
    if !scope.include_generated
        && (source.origin == RetrievalSourceOrigin::Generated
            || source.authoring_status == RetrievalAuthoringStatus::AiSuggestion)
    {
        return false;
    }
    if !scope.allowed_chapter_ids.is_empty() && !scope_matches_chapters(source, scope) {
        return false;
    }
    if let Some(order) = scope.before_chapter_order {
        let allowed = match &source.visibility_scope {
            RetrievalVisibilityScope::Chapter { chapter_order, .. } => *chapter_order < order,
            RetrievalVisibilityScope::Planning { .. } => true,
            RetrievalVisibilityScope::Book => true,
        };
        if !allowed {
            return false;
        }
    }
    true
}

fn scope_matches_chapters(source: &RetrievalSource, scope: &RetrievalScope) -> bool {
    match &source.visibility_scope {
        RetrievalVisibilityScope::Chapter { chapter_id, .. } => {
            scope.allowed_chapter_ids.iter().any(|id| id == chapter_id)
        }
        RetrievalVisibilityScope::Planning { chapter_ids } => chapter_ids.iter().any(|id| {
            scope
                .allowed_chapter_ids
                .iter()
                .any(|allowed| allowed == id)
        }),
        RetrievalVisibilityScope::Book => true,
    }
}
