use super::validation::{expected, invalid, now};
use super::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Runs before chapter/volume deletion in the caller's transaction. Historical
/// text survives; only live links and chapter-owned summaries are removed.
pub(super) fn remove_chapters(db: &Connection, book_id: &str, ids: &HashSet<String>) -> Result<()> {
    let mut planning = super::planning::read(db, book_id)?;
    let original = planning.clone();
    planning["chapterSummaries"]
        .as_array_mut()
        .ok_or_else(invalid)?
        .retain(|item| !ids.contains(item["chapterId"].as_str().unwrap_or_default()));
    for plot in planning["plotSettings"]
        .as_array_mut()
        .ok_or_else(invalid)?
    {
        let removed: Vec<_> = plot["chapterIds"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .filter(|id| ids.contains(id.as_str().unwrap_or_default()))
            .cloned()
            .collect();
        if removed.is_empty() {
            continue;
        }
        plot["chapterIds"]
            .as_array_mut()
            .ok_or_else(invalid)?
            .retain(|id| !ids.contains(id.as_str().unwrap_or_default()));
        let mut missing = plot.get("missingChapterIds").cloned().unwrap_or(json!([]));
        for id in removed {
            if !missing.as_array().ok_or_else(invalid)?.contains(&id) {
                missing.as_array_mut().ok_or_else(invalid)?.push(id);
            }
        }
        plot["missingChapterIds"] = missing;
    }
    if planning != original {
        expected(
            &original,
            original["databaseVersion"].as_i64().ok_or_else(invalid)?,
        )?;
        db.execute("UPDATE planning SET chapter_summaries_json=?,plot_settings_json=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE book_id=?",
            params![planning["chapterSummaries"].to_string(),planning["plotSettings"].to_string(),now()?,book_id])?;
    }
    let workspace = db.query_row("SELECT selected_chapter_ids_json,context_snapshot_json,database_version FROM brainstorm_workspaces WHERE book_id=?", [book_id], |row| {
        Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?,row.get::<_, i64>(2)?))
    }).optional()?;
    if let Some((selected, snapshot, version)) = workspace {
        let mut selected: Value = serde_json::from_str(&selected).map_err(|_| invalid())?;
        let before = selected.clone();
        selected
            .as_array_mut()
            .ok_or_else(invalid)?
            .retain(|id| !ids.contains(id.as_str().unwrap_or_default()));
        let mut snapshot: Value = serde_json::from_str(&snapshot).map_err(|_| invalid())?;
        if !snapshot.is_object() {
            return Err(invalid());
        }
        // Conservatively flag every deleted chapter: the opaque historical
        // snapshot remains intact even when its reference shape is unknown.
        let old_snapshot = snapshot.clone();
        let mut missing = snapshot
            .get("deletedChapterIds")
            .cloned()
            .unwrap_or(json!([]));
        let mut ordered: Vec<_> = ids.iter().collect();
        ordered.sort();
        for id in ordered {
            if !missing.as_array().ok_or_else(invalid)?.contains(&json!(id)) {
                missing.as_array_mut().ok_or_else(invalid)?.push(json!(id));
            }
        }
        snapshot["deletedChapterIds"] = missing;
        if selected != before || snapshot != old_snapshot {
            expected(&json!({"databaseVersion":version}), version)?;
            db.execute("UPDATE brainstorm_workspaces SET selected_chapter_ids_json=?,context_snapshot_json=?,database_version=database_version+1,updated_at=max(updated_at,?) WHERE book_id=?",
                params![selected.to_string(),snapshot.to_string(),now()?,book_id])?;
        }
    }
    Ok(())
}
