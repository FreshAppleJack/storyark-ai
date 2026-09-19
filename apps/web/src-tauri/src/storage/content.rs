use super::{Result, StorageError};
use serde_json::Value;
use std::collections::HashSet;

pub(super) fn incompatible() -> StorageError {
    StorageError::new(
        "CONTENT_INCOMPATIBLE",
        "Content cannot be safely edited; retain the original source",
    )
}
pub(super) fn validate(raw: &str) -> Result<()> {
    if raw.len() > 8 * 1024 * 1024 {
        return Err(incompatible());
    }
    let root: Value = serde_json::from_str(raw).map_err(|_| incompatible())?;
    if root["type"] != "doc" {
        return Err(incompatible());
    }
    node(&root, 0, false)?;
    Ok(())
}
pub(super) fn validate_preserved(raw: &str) -> Result<()> {
    if raw.len() > 8 * 1024 * 1024 {
        return Err(incompatible());
    }
    let root: Value = serde_json::from_str(raw).map_err(|_| incompatible())?;
    if root["type"] != "doc" {
        return Err(incompatible());
    }
    node(&root, 0, true)?;
    Ok(())
}
fn attributes(value: Option<&Value>, allowed: &[&str], preserve_unknown: bool) -> Result<()> {
    if let Some(value) = value {
        let object = value.as_object().ok_or_else(incompatible)?;
        if !preserve_unknown && object.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err(incompatible());
        }
        if preserve_unknown {
            json_value(value, 0)?;
        } else if object.values().any(|value| {
            !(value.is_null() || value.is_string() || value.is_boolean() || value.is_number())
        }) {
            return Err(incompatible());
        }
    }
    Ok(())
}
fn inline(kind: &str) -> bool {
    matches!(kind, "text" | "mention" | "hardBreak")
}
fn block(kind: &str) -> bool {
    matches!(
        kind,
        "paragraph"
            | "heading"
            | "blockquote"
            | "bulletList"
            | "orderedList"
            | "codeBlock"
            | "horizontalRule"
    )
}
fn json_value(value: &Value, depth: usize) -> Result<()> {
    if depth > 64 {
        return Err(incompatible());
    }
    match value {
        Value::Array(values) => values
            .iter()
            .try_for_each(|value| json_value(value, depth + 1)),
        Value::Object(values) => values
            .values()
            .try_for_each(|value| json_value(value, depth + 1)),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => Ok(()),
    }
}
fn node(value: &Value, depth: usize, preserve_unknown: bool) -> Result<()> {
    if depth > 64 {
        return Err(incompatible());
    }
    let object = value.as_object().ok_or_else(incompatible)?;
    if !preserve_unknown
        && object
            .keys()
            .any(|k| !["type", "attrs", "marks", "content", "text"].contains(&k.as_str()))
    {
        return Err(incompatible());
    }
    let kind = value["type"].as_str().ok_or_else(incompatible)?;
    let attrs: &[&str] = match kind {
        "doc" | "text" | "hardBreak" | "blockquote" | "bulletList" | "listItem"
        | "horizontalRule" => &[],
        "paragraph" => &["textAlign"],
        "heading" => &["level", "textAlign"],
        "orderedList" => &["start", "type"],
        "codeBlock" => &["language"],
        "mention" => &["id", "label", "color", "mentionSuggestionChar"],
        _ => return Err(incompatible()),
    };
    if kind == "doc" && depth != 0 {
        return Err(incompatible());
    }
    attributes(object.get("attrs"), attrs, preserve_unknown)?;
    if kind == "heading"
        && !value["attrs"]["level"]
            .as_i64()
            .is_some_and(|n| (1..=6).contains(&n))
    {
        return Err(incompatible());
    }
    if kind == "mention" && !value["attrs"]["id"].as_str().is_some_and(|s| !s.is_empty()) {
        return Err(incompatible());
    }
    if kind == "text" {
        if !value["text"].as_str().is_some_and(|s| !s.is_empty()) {
            return Err(incompatible());
        }
    } else if object.contains_key("text") {
        return Err(incompatible());
    }
    if let Some(marks) = object.get("marks") {
        if !inline(kind) {
            return Err(incompatible());
        }
        let mut seen = HashSet::new();
        for mark in marks.as_array().ok_or_else(incompatible)? {
            let map = mark.as_object().ok_or_else(incompatible)?;
            if !preserve_unknown && map.keys().any(|k| !["type", "attrs"].contains(&k.as_str())) {
                return Err(incompatible());
            }
            let name = mark["type"].as_str().ok_or_else(incompatible)?;
            if !seen.insert(name) {
                return Err(incompatible());
            }
            let allowed: &[&str] = match name {
                "bold" | "italic" | "strike" | "underline" | "code" | "ignoreAutoHighlight" => &[],
                "textStyle" => &["fontFamily", "fontSize"],
                "foreshadowing" => &["id"],
                "link" => &["href", "target", "rel", "class"],
                _ if preserve_unknown => &[],
                _ => return Err(incompatible()),
            };
            attributes(map.get("attrs"), allowed, preserve_unknown)?;
            if name == "foreshadowing"
                && !mark["attrs"]["id"].as_str().is_some_and(|s| !s.is_empty())
            {
                return Err(incompatible());
            }
        }
    }
    let children = match object.get("content") {
        Some(v) => v.as_array().ok_or_else(incompatible)?.as_slice(),
        None => &[],
    };
    if (inline(kind) || kind == "horizontalRule") && object.contains_key("content") {
        return Err(incompatible());
    }
    if matches!(
        kind,
        "doc" | "blockquote" | "bulletList" | "orderedList" | "listItem"
    ) && children.is_empty()
    {
        return Err(incompatible());
    }
    for (index, child) in children.iter().enumerate() {
        let child_kind = child["type"].as_str().ok_or_else(incompatible)?;
        let valid = match kind {
            "doc" | "blockquote" => block(child_kind),
            "paragraph" | "heading" => inline(child_kind),
            "codeBlock" => child_kind == "text" && child.get("marks").is_none(),
            "bulletList" | "orderedList" => child_kind == "listItem",
            "listItem" => {
                if index == 0 {
                    child_kind == "paragraph"
                } else {
                    block(child_kind)
                }
            }
            _ => false,
        };
        if !valid {
            return Err(incompatible());
        }
        node(child, depth + 1, preserve_unknown)?;
    }
    Ok(())
}
pub(super) fn notes(notes: &[Value]) -> Result<()> {
    let mut ids = HashSet::new();
    for note in notes {
        if !note.is_object() {
            return Err(incompatible());
        }
        let id = note["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(incompatible)?;
        if !ids.insert(id) || !note["note"].is_string() || !note["excerpt"].is_string() {
            return Err(incompatible());
        }
        for key in ["createdAt", "updatedAt"] {
            if !note[key]
                .as_i64()
                .is_some_and(|n| (0..=super::validation::MAX_INTEGER).contains(&n))
            {
                return Err(incompatible());
            }
        }
        if note["updatedAt"].as_i64() < note["createdAt"].as_i64() {
            return Err(incompatible());
        }
        if note.get("isRecovered").is_some_and(|v| !v.is_boolean()) {
            return Err(incompatible());
        }
    }
    Ok(())
}
