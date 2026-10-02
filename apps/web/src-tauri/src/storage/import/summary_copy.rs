use super::mapping::{mapped, mapped_note, mapped_source_id};
use super::IdMap;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Keep historical fingerprints intact while recording the identity-only copy operation.
/// Do not acknowledge real edits or rewrite the original AI generation evidence.
pub(super) fn preserve_summary_baselines(planning: &mut Value, work: &Value, map: &IdMap) {
    let book_id = work["book"]["id"].as_str().unwrap();
    let mut versions = HashMap::new();
    for character in work["characters"].as_array().unwrap() {
        versions.insert(
            format!(
                "{}:character:{}",
                book_id,
                character["id"].as_str().unwrap()
            ),
            character["databaseVersion"].clone(),
        );
    }
    for entity in ["story-summary", "story-background"] {
        versions.insert(
            format!("{book_id}:planning:{entity}"),
            work["planning"]["databaseVersion"].clone(),
        );
    }
    for chapter in work["chapters"].as_array().unwrap() {
        for note in chapter["foreshadowingIds"].as_array().unwrap() {
            versions.insert(
                format!(
                    "{}:foreshadowing_note:{}:{}",
                    book_id,
                    chapter["id"].as_str().unwrap(),
                    note.as_str().unwrap()
                ),
                chapter["databaseVersion"].clone(),
            );
        }
    }
    for summary in planning["chapterSummaries"].as_array_mut().unwrap() {
        let chapter_id = summary["chapterId"].as_str().unwrap().to_owned();
        let sources = summary["generationMetadata"]["source"]["allowedSources"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let original_versions: Vec<Value> = sources
            .iter()
            .map(|source| source["sourceVersion"].clone())
            .collect();
        if let Some(snapshot) = summary
            .get_mut("sourceSnapshot")
            .filter(|value| value.is_object())
        {
            preserve_snapshot(
                snapshot,
                &chapter_id,
                map,
                &sources,
                &original_versions,
                &versions,
            );
        }
        if let Some(ack) = summary
            .get_mut("freshnessAcknowledgement")
            .filter(|value| value.is_object())
        {
            let expected = ack["allowedSourceVersions"]
                .as_array()
                .cloned()
                .unwrap_or(original_versions);
            preserve_snapshot(
                &mut ack["acknowledgedSourceSnapshot"],
                &chapter_id,
                map,
                &sources,
                &expected,
                &versions,
            );
        }
    }
}

fn preserve_snapshot(
    snapshot: &mut Value,
    chapter_id: &str,
    map: &IdMap,
    sources: &[Value],
    expected: &[Value],
    versions: &HashMap<String, Value>,
) {
    for (key, ids_key) in [
        ("characters", "mentionedCharacterIds"),
        ("foreshadowings", "foreshadowingIds"),
    ] {
        let previous = snapshot["copyReferences"][key]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let previous: HashMap<&str, &str> = previous
            .iter()
            .filter_map(|entry| Some((entry["id"].as_str()?, entry["fingerprintId"].as_str()?)))
            .collect();
        let references: Vec<Value> = snapshot[ids_key]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| {
                let id = id.as_str().unwrap();
                let fingerprint_id = previous.get(id).copied().unwrap_or(id);
                let copied_id = if key == "characters" {
                    mapped(&map.characters, id)
                } else {
                    mapped_note(map, chapter_id, id)
                };
                json!({"id": copied_id, "fingerprintId": fingerprint_id})
            })
            .collect();
        if !snapshot["copyReferences"].is_object() {
            snapshot["copyReferences"] = json!({});
        }
        snapshot["copyReferences"][key] = json!(references);
    }
    let previous = snapshot["copySourceVersions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let copied_versions: Vec<Value> = sources.iter().enumerate().map(|(index, source)| {
        let source_id = source["sourceId"].as_str().unwrap();
        let current = versions.get(source_id).cloned().unwrap_or(Value::Null);
        let matches = previous.iter().find(|entry| entry["sourceId"] == source_id)
            .map(|entry| entry["matchesBaseline"] == true && entry["version"] == current)
            .unwrap_or_else(|| expected.get(index) == Some(&current));
        let copied_version = if current.is_null() { Value::Null } else if current == 0 { json!(0) } else { json!(1) };
        json!({"sourceId": mapped_source_id(map, source_id), "version": copied_version, "matchesBaseline": matches})
    }).collect();
    snapshot["copySourceVersions"] = json!(copied_versions);
}
