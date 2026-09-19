use super::validation::{array, import_invalid, non_empty_text, required, uuid_field};
use super::{IdMap, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub(super) fn build_id_map(work: &Value) -> Result<IdMap> {
    let mut map = IdMap::default();
    let book_id = uuid_field(required(work, "book")?, "id")?;
    map.book.insert(book_id, Uuid::new_v4().to_string());
    for volume in array(work, "volumes")? {
        map.volumes
            .insert(uuid_field(volume, "id")?, Uuid::new_v4().to_string());
    }
    for chapter in array(work, "chapters")? {
        map.chapters
            .insert(uuid_field(chapter, "id")?, Uuid::new_v4().to_string());
    }
    for character in array(work, "characters")? {
        map.characters
            .insert(uuid_field(character, "id")?, Uuid::new_v4().to_string());
    }
    for graph in array(work, "graphs")? {
        for node in array(graph, "nodes")? {
            map.node_keys
                .insert(uuid_field(node, "nodeKey")?, Uuid::new_v4().to_string());
        }
        for edge in array(graph, "edges")? {
            map.edges
                .insert(uuid_field(edge, "id")?, Uuid::new_v4().to_string());
        }
    }
    for note in array(work, "foreshadowings")? {
        map.notes.insert(
            (
                uuid_field(note, "chapterId")?,
                non_empty_text(note, "id", 4096)?,
            ),
            Uuid::new_v4().to_string(),
        );
    }
    let planning = required(work, "planning")?;
    for plot in array(planning, "plotSettings")? {
        map.plots.insert(
            non_empty_text(plot, "id", 4096)?,
            Uuid::new_v4().to_string(),
        );
    }
    for workspace in array(work, "brainstormWorkspaces")? {
        for option in array(workspace, "generatedOptions")? {
            map.options.insert(
                non_empty_text(option, "id", 4096)?,
                Uuid::new_v4().to_string(),
            );
        }
    }
    Ok(map)
}

fn mapped(map: &HashMap<String, String>, value: &str) -> String {
    map.get(value).cloned().unwrap_or_else(|| value.to_owned())
}

fn mapped_note(map: &IdMap, chapter_id: &str, note_id: &str) -> String {
    map.notes
        .get(&(chapter_id.to_owned(), note_id.to_owned()))
        .cloned()
        .unwrap_or_else(|| note_id.to_owned())
}

fn rewrite_json_references(value: &mut Value, map: &IdMap, chapter_id: Option<&str>) {
    if let Some(array) = value.as_array_mut() {
        for item in array {
            rewrite_json_references(item, map, chapter_id);
        }
        return;
    }
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_owned);
    for (key, child) in object.iter_mut() {
        match key.as_str() {
            "bookId" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.book, id));
                }
            }
            "chapterId" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.chapters, id));
                }
            }
            "characterId" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.characters, id));
                }
            }
            "sourceCharacterId" | "targetCharacterId" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.characters, id));
                }
            }
            "nodeKey" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.node_keys, id));
                }
            }
            "sourceNodeKey" | "targetNodeKey" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.node_keys, id));
                }
            }
            "selectedChapterIds" | "chapterIds" | "missingChapterIds" => {
                if let Some(ids) = child.as_array_mut() {
                    for id in ids {
                        let old = id.as_str().map(str::to_owned);
                        if let Some(old) = old {
                            *id = Value::String(mapped(&map.chapters, &old));
                        }
                    }
                }
            }
            "selectedOptionId" => {
                if let Some(id) = child.as_str() {
                    *child = Value::String(mapped(&map.options, id));
                }
            }
            _ => {}
        }
        rewrite_json_references(child, map, chapter_id);
    }
    if kind.as_deref() == Some("mention") {
        if let Some(attrs) = object.get_mut("attrs").and_then(Value::as_object_mut) {
            if let Some(id) = attrs.get("id").and_then(Value::as_str) {
                attrs.insert("id".into(), Value::String(mapped(&map.characters, id)));
            }
        }
    }
    if kind.is_some() {
        if let Some(marks) = object.get_mut("marks").and_then(Value::as_array_mut) {
            for mark in marks {
                if mark.get("type").and_then(Value::as_str) == Some("foreshadowing") {
                    if let (Some(chapter_id), Some(attrs)) = (
                        chapter_id,
                        mark.get_mut("attrs").and_then(Value::as_object_mut),
                    ) {
                        if let Some(id) = attrs.get("id").and_then(Value::as_str) {
                            attrs.insert(
                                "id".into(),
                                Value::String(mapped_note(map, chapter_id, id)),
                            );
                        }
                    }
                }
            }
        }
    }
}

fn rewrite_brainstorm_context(value: &mut Value, map: &IdMap) {
    rewrite_json_references(value, map, None);
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if let Some(selected_chapters) = object
        .get_mut("selectedChapters")
        .and_then(Value::as_array_mut)
    {
        for selected in selected_chapters {
            let id = selected
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some(id) = id {
                *selected.get_mut("id").expect("checked above") =
                    Value::String(mapped(&map.chapters, &id));
            }
        }
    }
    if let Some(characters) = object
        .get_mut("appearingCharacters")
        .and_then(Value::as_array_mut)
    {
        for character in characters {
            let id = character
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some(id) = id {
                *character.get_mut("id").expect("checked above") =
                    Value::String(mapped(&map.characters, &id));
            }
        }
    }
}

pub(super) fn copy_work(work: &Value, map: &IdMap, title: &str) -> Result<Value> {
    let mut copy = work.clone();
    let old_book_id = uuid_field(required(work, "book")?, "id")?;
    let new_book_id = mapped(&map.book, &old_book_id);
    {
        let book = copy
            .get_mut("book")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| import_invalid("The export book is invalid"))?;
        book.insert("id".into(), Value::String(new_book_id.clone()));
        book.insert("title".into(), Value::String(title.to_owned()));
        book.insert("databaseVersion".into(), json!(1));
    }
    for volume in copy["volumes"].as_array_mut().unwrap() {
        let old = volume["id"].as_str().unwrap().to_owned();
        volume["id"] = Value::String(mapped(&map.volumes, &old));
        volume["bookId"] = Value::String(new_book_id.clone());
        volume["databaseVersion"] = json!(1);
    }
    for chapter in copy["chapters"].as_array_mut().unwrap() {
        let old_chapter_id = chapter["id"].as_str().unwrap().to_owned();
        chapter["id"] = Value::String(mapped(&map.chapters, &old_chapter_id));
        chapter["bookId"] = Value::String(new_book_id.clone());
        let old_volume_id = chapter["volumeId"].as_str().unwrap().to_owned();
        chapter["volumeId"] = Value::String(mapped(&map.volumes, &old_volume_id));
        chapter["databaseVersion"] = json!(1);
        if let Some(ids) = chapter
            .get_mut("foreshadowingIds")
            .and_then(Value::as_array_mut)
        {
            for id in ids {
                let old = id.as_str().map(str::to_owned);
                if let Some(old) = old {
                    *id = Value::String(mapped_note(map, &old_chapter_id, &old));
                }
            }
        }
        if let Some(body) = chapter.get_mut("body") {
            if body.get("format").and_then(Value::as_str) == Some("tiptap-json") {
                if let Some(content_value) = body.get_mut("content") {
                    rewrite_json_references(content_value, map, Some(&old_chapter_id));
                }
            }
        }
    }
    for character in copy["characters"].as_array_mut().unwrap() {
        let old = character["id"].as_str().unwrap().to_owned();
        character["id"] = Value::String(mapped(&map.characters, &old));
        character["bookId"] = Value::String(new_book_id.clone());
        character["databaseVersion"] = json!(1);
    }
    for note in copy["foreshadowings"].as_array_mut().unwrap() {
        let old_chapter_id = note["chapterId"].as_str().unwrap().to_owned();
        let old_note_id = note["id"].as_str().unwrap().to_owned();
        note["id"] = Value::String(mapped_note(map, &old_chapter_id, &old_note_id));
        note["chapterId"] = Value::String(mapped(&map.chapters, &old_chapter_id));
        note["databaseVersion"] = json!(1);
    }
    for graph in copy["graphs"].as_array_mut().unwrap() {
        graph["bookId"] = Value::String(new_book_id.clone());
        graph["databaseVersion"] = json!(1);
        for node in graph["nodes"].as_array_mut().unwrap() {
            let old = node["nodeKey"].as_str().unwrap().to_owned();
            node["nodeKey"] = Value::String(mapped(&map.node_keys, &old));
            let old_character = node["characterId"].as_str().unwrap().to_owned();
            node["characterId"] = Value::String(mapped(&map.characters, &old_character));
        }
        for edge in graph["edges"].as_array_mut().unwrap() {
            let old = edge["id"].as_str().unwrap().to_owned();
            edge["id"] = Value::String(mapped(&map.edges, &old));
            let source = edge["sourceNodeKey"].as_str().unwrap().to_owned();
            let target = edge["targetNodeKey"].as_str().unwrap().to_owned();
            edge["sourceNodeKey"] = Value::String(mapped(&map.node_keys, &source));
            edge["targetNodeKey"] = Value::String(mapped(&map.node_keys, &target));
        }
    }
    let planning = copy
        .get_mut("planning")
        .ok_or_else(|| import_invalid("Planning is missing"))?;
    planning["bookId"] = Value::String(new_book_id.clone());
    planning["databaseVersion"] = json!(if planning["databaseVersion"].as_i64().unwrap_or(0) > 0 {
        1
    } else {
        0
    });
    rewrite_json_references(planning, map, None);
    if let Some(summaries) = planning
        .get_mut("chapterSummaries")
        .and_then(Value::as_array_mut)
    {
        for summary in summaries {
            if summary.get("sourceChapterVersion").is_some() {
                summary["sourceChapterVersion"] = json!(1);
            }
        }
    }
    for plot in planning["plotSettings"].as_array_mut().unwrap() {
        let old = plot["id"].as_str().unwrap().to_owned();
        plot["id"] = Value::String(mapped(&map.plots, &old));
    }
    for workspace in copy["brainstormWorkspaces"].as_array_mut().unwrap() {
        workspace["bookId"] = Value::String(new_book_id.clone());
        workspace["databaseVersion"] = json!(1);
        rewrite_json_references(workspace, map, None);
        if let Some(context_snapshot) = workspace.get_mut("contextSnapshot") {
            rewrite_brainstorm_context(context_snapshot, map);
        }
        for option in workspace["generatedOptions"].as_array_mut().unwrap() {
            let old = option["id"].as_str().unwrap().to_owned();
            option["id"] = Value::String(mapped(&map.options, &old));
        }
    }
    Ok(copy)
}
