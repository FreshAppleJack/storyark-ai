use super::records::record;
use super::validation::{invalid, ownership, valid_id, MAX_INTEGER};
use super::Result;
use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashSet;

const SUMMARY_FINGERPRINT: &str = "0123456789abcdef";

fn text_value(value: &Value, maximum: usize, allow_empty: bool) -> bool {
    value
        .as_str()
        .is_some_and(|text| text.len() <= maximum && (allow_empty || !text.trim().is_empty()))
}

fn nonnegative(value: &Value) -> bool {
    value
        .as_i64()
        .is_some_and(|number| (0..=MAX_INTEGER).contains(&number))
}

fn positive(value: &Value) -> bool {
    value
        .as_i64()
        .is_some_and(|number| (1..=MAX_INTEGER).contains(&number))
}

fn fingerprint(value: &Value) -> bool {
    value.as_str().is_some_and(|hash| {
        hash.len() == 16
            && hash
                .bytes()
                .all(|byte| SUMMARY_FINGERPRINT.contains(byte as char))
    })
}

fn string_array(value: &Value, maximum_items: usize, maximum_chars: usize, nonempty: bool) -> bool {
    value.as_array().is_some_and(|items| {
        items.len() <= maximum_items
            && items
                .iter()
                .all(|item| text_value(item, maximum_chars, !nonempty))
    })
}

fn unique_strings(value: &Value) -> bool {
    value.as_array().is_some_and(|items| {
        let mut seen = HashSet::new();
        items
            .iter()
            .all(|item| item.as_str().is_some_and(|text| seen.insert(text)))
    })
}

fn validate_summary_snapshot(snapshot: &Value, chapter_id: &str) -> Result<()> {
    let chapter_snapshot_id = snapshot["chapterId"].as_str().ok_or_else(invalid)?;
    if chapter_snapshot_id != chapter_id
        || !text_value(&snapshot["chapterTitle"], 4096, true)
        || !matches!(
            snapshot["contentFormat"].as_str(),
            Some("tiptap-json" | "legacy-json" | "legacy-html" | "unrecognized")
        )
        || !(snapshot["contentVersion"].is_null() || nonnegative(&snapshot["contentVersion"]))
        || snapshot["fingerprintAlgorithm"] != "fnv1a64-utf16-v1"
        || !fingerprint(&snapshot["bodyFingerprint"])
        || !fingerprint(&snapshot["structuredFingerprint"])
        || !string_array(&snapshot["blockFingerprints"], 50_000, 16, true)
        || !snapshot["blockFingerprints"]
            .as_array()
            .unwrap()
            .iter()
            .all(fingerprint)
        || !unique_strings(&snapshot["mentionedCharacterIds"])
        || !string_array(&snapshot["mentionedCharacterIds"], 512, 64, true)
        || !snapshot["mentionedCharacterIds"]
            .as_array()
            .unwrap()
            .iter()
            .all(|id| id.as_str().is_some_and(|value| valid_id(value).is_ok()))
        || !unique_strings(&snapshot["foreshadowingIds"])
        || !string_array(&snapshot["foreshadowingIds"], 100_000, 4096, true)
        || !nonnegative(&snapshot["capturedAt"])
    {
        return Err(invalid());
    }
    if let Some(version) = snapshot.get("chapterDatabaseVersion") {
        if !version.is_null() {
            let version = version.as_i64().ok_or_else(invalid)?;
            if !(1..=MAX_INTEGER).contains(&version) {
                return Err(invalid());
            }
        }
    } else {
        return Err(invalid());
    }
    let notes = snapshot["foreshadowingNoteFingerprints"]
        .as_array()
        .ok_or_else(invalid)?;
    if notes.len() > 100_000 {
        return Err(invalid());
    }
    let mut note_ids = HashSet::new();
    for note in notes {
        let note_id = note["noteId"].as_str().ok_or_else(invalid)?;
        if note_id.is_empty()
            || note_id.len() > 4096
            || !note_ids.insert(note_id)
            || !fingerprint(&note["fingerprint"])
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_summary_generation(
    metadata: &Value,
    summary: &Value,
    book_id: &str,
    chapter_id: &str,
) -> Result<()> {
    if !text_value(&metadata["providerId"], 128, false)
        || !text_value(&metadata["protocol"], 128, false)
        || !text_value(&metadata["modelId"], 512, false)
        || !text_value(&metadata["promptVersion"], 128, false)
        || !nonnegative(&metadata["generatedAt"])
    {
        return Err(invalid());
    }
    let config_id = metadata["configId"].as_str().ok_or_else(invalid)?;
    valid_id(config_id)?;
    let source = &metadata["source"];
    if source["bookId"].as_str() != Some(book_id)
        || source["chapterId"].as_str() != Some(chapter_id)
        || !positive(&source["chapterDatabaseVersion"])
        || !fingerprint(&source["sourceBodyFingerprint"])
        || !(source["planningDatabaseVersion"].is_null()
            || nonnegative(&source["planningDatabaseVersion"]))
        || source["includesFuturePlan"] != false
        || source["sourceBodyFingerprint"] != summary["sourceSnapshot"]["bodyFingerprint"]
        || (!summary["sourceSnapshot"]["chapterDatabaseVersion"].is_null()
            && source["chapterDatabaseVersion"]
                != summary["sourceSnapshot"]["chapterDatabaseVersion"])
    {
        return Err(invalid());
    }
    let allowed = source["allowedSources"].as_array().ok_or_else(invalid)?;
    if allowed.len() > 512 {
        return Err(invalid());
    }
    let mut source_ids = HashSet::new();
    for item in allowed {
        let source_id = item["sourceId"].as_str().ok_or_else(invalid)?;
        let kind = item["sourceKind"].as_str().ok_or_else(invalid)?;
        if source_id.is_empty()
            || source_id.len() > 512
            || !source_ids.insert(source_id)
            || !text_value(&item["entityId"], 4096, false)
            || !matches!(
                kind,
                "planning"
                    | "confirmed_setting"
                    | "character"
                    | "relationship"
                    | "foreshadowing_note"
            )
            || !positive(&item["sourceVersion"])
            || !(item["indexVersion"].is_null() || positive(&item["indexVersion"]))
        {
            return Err(invalid());
        }
        if kind == "character" {
            valid_id(item["entityId"].as_str().ok_or_else(invalid)?)?;
        }
    }
    let trace = &source["retrievalTrace"];
    if !trace.is_null() {
        if !text_value(&trace["searchId"], 128, false)
            || !text_value(&trace["retrievalVersion"], 128, false)
            || trace["task"] != "chapter_summary"
            || !nonnegative(&trace["requestedAt"])
            || !(trace["indexVersion"].is_null() || positive(&trace["indexVersion"]))
            || !(trace["embeddingFingerprint"].is_null()
                || text_value(&trace["embeddingFingerprint"], 1024, false))
            || !validate_summary_retrieval_scope(&trace["scope"], book_id, chapter_id)
            || !string_array(&trace["excludedHitIds"], 200, 8192, true)
            || !unique_strings(&trace["excludedHitIds"])
            || !string_array(&trace["includedHitIds"], 200, 8192, true)
            || !unique_strings(&trace["includedHitIds"])
            || !string_array(&trace["omittedHitIds"], 200, 8192, true)
            || !unique_strings(&trace["omittedHitIds"])
            || !positive(&trace["budget"]["charBudget"])
            || !(trace["budget"]["tokenBudget"].is_null()
                || positive(&trace["budget"]["tokenBudget"]))
        {
            return Err(invalid());
        }
        let versions = trace["sourceVersions"].as_array().ok_or_else(invalid)?;
        if versions.len() > 512 {
            return Err(invalid());
        }
        let mut version_ids = HashSet::new();
        for item in versions {
            let source_id = item["sourceId"].as_str().ok_or_else(invalid)?;
            if source_id.is_empty()
                || source_id.len() > 512
                || source_id.split(':').nth(1) == Some("future_plan")
                || !version_ids.insert(source_id)
                || !(item["chapterId"].is_null()
                    || item["chapterId"]
                        .as_str()
                        .is_some_and(|id| valid_id(id).is_ok()))
                || !positive(&item["sourceVersion"])
                || !positive(&item["indexVersion"])
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}

fn validate_summary_freshness_acknowledgement(
    acknowledgement: &Value,
    summary: &Value,
    chapter_id: &str,
) -> Result<()> {
    validate_summary_snapshot(&acknowledgement["acknowledgedSourceSnapshot"], chapter_id)?;
    if !nonnegative(&acknowledgement["acknowledgedAt"]) {
        return Err(invalid());
    }
    let versions = acknowledgement["allowedSourceVersions"]
        .as_array()
        .ok_or_else(invalid)?;
    let expected_count = summary["generationMetadata"]["source"]["allowedSources"]
        .as_array()
        .map_or(0, Vec::len);
    if versions.len() > 512 || versions.len() != expected_count {
        return Err(invalid());
    }
    if versions
        .iter()
        .any(|version| !version.is_null() && !positive(version))
    {
        return Err(invalid());
    }
    Ok(())
}

fn validate_summary_retrieval_scope(scope: &Value, book_id: &str, chapter_id: &str) -> bool {
    if scope["bookId"].as_str() != Some(book_id)
        || scope["includeFuturePlan"] != false
        || scope["includeGenerated"] != false
        || scope["includeStale"] != false
        || !scope.get("beforeChapterOrder").is_some_and(Value::is_null)
        || !scope.get("beforeAnchor").is_some_and(Value::is_null)
        || !scope.get("timeRange").is_some_and(Value::is_null)
    {
        return false;
    }
    let Some(chapters) = scope["allowedChapterIds"].as_array() else {
        return false;
    };
    if chapters.len() != 1 || chapters[0].as_str() != Some(chapter_id) {
        return false;
    }
    let Some(kinds) = scope["allowedSourceKinds"].as_array() else {
        return false;
    };
    !kinds.is_empty()
        && kinds
            .iter()
            .all(|kind| matches!(kind.as_str(), Some("confirmed_setting" | "character")))
}

/// Shared structural validation for locally saved and imported chapter-summary provenance.
pub(super) fn validate_summary_metadata(
    summary: &Value,
    book_id: &str,
    chapter_id: &str,
) -> Result<()> {
    if let Some(snapshot) = summary.get("sourceSnapshot") {
        validate_summary_snapshot(snapshot, chapter_id)?;
    }
    if let Some(provenance) = summary.get("provenance") {
        if !matches!(provenance.as_str(), Some("author" | "ai-adopted")) {
            return Err(invalid());
        }
        if provenance == "ai-adopted"
            && (summary.get("sourceSnapshot").is_none()
                || summary.get("generationMetadata").is_none())
        {
            return Err(invalid());
        }
    }
    if let Some(metadata) = summary.get("generationMetadata") {
        if summary["provenance"] != "ai-adopted" {
            return Err(invalid());
        }
        validate_summary_generation(metadata, summary, book_id, chapter_id)?;
    }
    if let Some(acknowledgement) = summary.get("freshnessAcknowledgement") {
        validate_summary_freshness_acknowledgement(acknowledgement, summary, chapter_id)?;
    }
    Ok(())
}

pub(super) fn text(value: &Value, field: &str) -> Result<()> {
    if value[field]
        .as_str()
        .map_or(true, |text| text.len() > 1_048_576)
    {
        return Err(invalid());
    }
    Ok(())
}
fn time(value: &Value, field: &str) -> Result<()> {
    if value[field]
        .as_i64()
        .map_or(true, |n| !(0..=MAX_INTEGER).contains(&n))
    {
        return Err(invalid());
    }
    Ok(())
}
pub(super) fn validate(
    db: &Connection,
    book_id: &str,
    summaries: &Value,
    plots: &Value,
) -> Result<()> {
    let summaries = summaries.as_array().ok_or_else(invalid)?;
    let plots = plots.as_array().ok_or_else(invalid)?;
    if summaries.len() > 100_000 || plots.len() > 100_000 {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    for summary in summaries {
        let id = summary["chapterId"].as_str().ok_or_else(invalid)?;
        valid_id(id)?;
        if !seen.insert(id) {
            return Err(invalid());
        }
        let chapter = record(db, "chapters", id)?;
        ownership(&chapter, "bookId", book_id)?;
        text(summary, "summary")?;
        time(summary, "updatedAt")?;
        if let Some(version) = summary.get("sourceChapterVersion") {
            let version = version.as_i64().ok_or_else(invalid)?;
            if version < 1 || version > chapter["databaseVersion"].as_i64().ok_or_else(invalid)? {
                return Err(invalid());
            }
        }
        validate_summary_metadata(summary, book_id, id)?;
    }
    seen.clear();
    for plot in plots {
        let id = plot["id"].as_str().ok_or_else(invalid)?;
        if id.is_empty() || id.len() > 4096 || !seen.insert(id) {
            return Err(invalid());
        }
        text(plot, "title")?;
        text(plot, "details")?;
        time(plot, "createdAt")?;
        time(plot, "updatedAt")?;
        if plot["updatedAt"].as_i64() < plot["createdAt"].as_i64() {
            return Err(invalid());
        }
        let mut ids = HashSet::new();
        for id in plot["chapterIds"].as_array().ok_or_else(invalid)? {
            let id = id.as_str().ok_or_else(invalid)?;
            valid_id(id)?;
            if !ids.insert(id) {
                return Err(invalid());
            }
            ownership(&record(db, "chapters", id)?, "bookId", book_id)?;
        }
        if let Some(missing) = plot.get("missingChapterIds") {
            for id in missing.as_array().ok_or_else(invalid)? {
                valid_id(id.as_str().ok_or_else(invalid)?)?;
            }
        }
    }
    Ok(())
}
