use super::records::record;
use super::validation::{invalid, ownership, valid_id, MAX_INTEGER};
use super::Result;
use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashSet;

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
