use super::records::record;
use super::validation::{ownership, unlocked, valid_id};
use super::{requests::Target, Result};
use rusqlite::Connection;
use serde_json::Value;

pub(super) struct Located {
    pub(super) table: &'static str,
    pub(super) id: String,
    pub(super) row: Value,
    pub(super) ancestors: Vec<(&'static str, Value)>,
}
pub(super) fn locate(tx: &Connection, target: &Target) -> Result<Located> {
    match target {
        Target::Book { book_id } => {
            valid_id(book_id)?;
            let row = record(tx, "books", book_id)?;
            Ok(Located {
                table: "books",
                id: book_id.clone(),
                row,
                ancestors: vec![],
            })
        }
        Target::Volume { book_id, volume_id } => {
            valid_id(book_id)?;
            valid_id(volume_id)?;
            let book = record(tx, "books", book_id)?;
            let row = record(tx, "volumes", volume_id)?;
            ownership(&row, "bookId", book_id)?;
            Ok(Located {
                table: "volumes",
                id: volume_id.clone(),
                row,
                ancestors: vec![("books", book)],
            })
        }
        Target::Chapter {
            book_id,
            volume_id,
            chapter_id,
        } => {
            valid_id(book_id)?;
            valid_id(volume_id)?;
            valid_id(chapter_id)?;
            let book = record(tx, "books", book_id)?;
            let volume = record(tx, "volumes", volume_id)?;
            ownership(&volume, "bookId", book_id)?;
            let row = record(tx, "chapters", chapter_id)?;
            ownership(&row, "bookId", book_id)?;
            ownership(&row, "volumeId", volume_id)?;
            Ok(Located {
                table: "chapters",
                id: chapter_id.clone(),
                row,
                ancestors: vec![("books", book), ("volumes", volume)],
            })
        }
    }
}
pub(super) fn unlocked_ancestors(located: &Located) -> Result<()> {
    for (_, ancestor) in &located.ancestors {
        unlocked(ancestor)?;
    }
    Ok(())
}
