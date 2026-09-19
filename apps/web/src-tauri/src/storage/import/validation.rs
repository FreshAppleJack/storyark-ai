use super::{
    ImportCounts, Result, StorageError, EXCHANGE_CONTENT_VERSION, EXCHANGE_SCHEMA_VERSION,
};
use crate::storage::content;
use crate::storage::validation::MAX_INTEGER;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub(super) fn import_invalid(message: &str) -> StorageError {
    StorageError::new("IMPORT_INVALID", message)
}

fn unsupported_version() -> StorageError {
    StorageError::new(
        "IMPORT_UNSUPPORTED_VERSION",
        "This StoryArk export version is not supported by this application",
    )
}

pub(super) fn required<'a>(value: &'a Value, key: &str) -> Result<&'a Value> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .ok_or_else(|| import_invalid("The export is missing a required field"))
}

pub(super) fn string(value: &Value, key: &str) -> Result<String> {
    required(value, key)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| import_invalid("The export contains a field with the wrong type"))
}

pub(super) fn optional_string(value: &Value, key: &str) -> Result<Option<String>> {
    match value.as_object().and_then(|object| object.get(key)) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(|text| Some(text.to_owned()))
            .ok_or_else(|| import_invalid("The export contains a field with the wrong type")),
    }
}

pub(super) fn integer(value: &Value, key: &str) -> Result<i64> {
    let number = required(value, key)?
        .as_i64()
        .ok_or_else(|| import_invalid("The export contains a field with the wrong type"))?;
    if !(0..=MAX_INTEGER).contains(&number) {
        return Err(import_invalid(
            "The export contains an unsafe numeric value",
        ));
    }
    Ok(number)
}

pub(super) fn boolean(value: &Value, key: &str) -> Result<bool> {
    required(value, key)?
        .as_bool()
        .ok_or_else(|| import_invalid("The export contains a field with the wrong type"))
}

pub(super) fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    required(value, key)?
        .as_array()
        .ok_or_else(|| import_invalid("The export contains a field with the wrong type"))
}

pub(super) fn object<'a>(value: &'a Value, key: &str) -> Result<&'a Map<String, Value>> {
    required(value, key)?
        .as_object()
        .ok_or_else(|| import_invalid("The export contains a field with the wrong type"))
}

fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|id| id.to_string() == value)
        .unwrap_or(false)
}

pub(super) fn uuid_field(value: &Value, key: &str) -> Result<String> {
    let id = string(value, key)?;
    if !canonical_uuid(&id) {
        return Err(import_invalid("The export contains an invalid entity ID"));
    }
    Ok(id)
}

pub(super) fn non_empty_text(value: &Value, key: &str, max: usize) -> Result<String> {
    let text = string(value, key)?;
    if text.trim().is_empty() || text.len() > max {
        return Err(import_invalid(
            "The export contains text outside the supported range",
        ));
    }
    Ok(text)
}

fn check_metadata(value: &Value) -> Result<()> {
    let created = integer(value, "createdAt")?;
    let updated = integer(value, "updatedAt")?;
    let version = integer(value, "databaseVersion")?;
    if version < 1 || updated < created {
        return Err(import_invalid(
            "The export contains invalid record metadata",
        ));
    }
    Ok(())
}

fn validate_handle_config(value: Option<&Value>) -> Result<()> {
    let Some(value) = value else { return Ok(()) };
    if value.is_null() {
        return Ok(());
    }
    let object = value
        .as_object()
        .ok_or_else(|| import_invalid("A graph handle configuration is invalid"))?;
    for (side, mode) in object {
        if !["top", "right", "bottom", "left"].contains(&side.as_str())
            || !["source", "target", "both", "none"].contains(
                &mode
                    .as_str()
                    .ok_or_else(|| import_invalid("A graph handle configuration is invalid"))?,
            )
        {
            return Err(import_invalid("A graph handle configuration is invalid"));
        }
    }
    Ok(())
}

fn validate_body(
    body: &Value,
    chapter_id: &str,
    note_ids: &HashSet<String>,
    character_ids: &HashSet<String>,
) -> Result<()> {
    let format = string(body, "format")?;
    let version = integer(body, "version")?;
    let state = string(body, "contentState")?;
    if !["editable", "read-only", "pending-migration"].contains(&state.as_str()) {
        return Err(import_invalid("A chapter content state is invalid"));
    }
    if format == "tiptap-json" {
        if version != EXCHANGE_CONTENT_VERSION {
            return Err(unsupported_version());
        }
        let content_value = required(body, "content")?;
        if content_value.to_string().len() > 8 * 1024 * 1024 {
            return Err(import_invalid("A chapter body exceeds the supported size"));
        }
        let content = content_value.to_string();
        let validation = if state == "editable" {
            content::validate(&content)
        } else {
            content::validate_preserved(&content)
        };
        validation.map_err(|_| {
            import_invalid("A chapter contains a Tiptap document that cannot be safely restored")
        })?;
        validate_tiptap_references(content_value, chapter_id, note_ids, character_ids)?;
        if body.get("originalContent").is_some() || body.get("originalFormat").is_some() {
            let original_content = optional_string(body, "originalContent")?;
            let original_format = optional_string(body, "originalFormat")?;
            if original_content.is_some() != original_format.is_some() {
                return Err(import_invalid(
                    "A chapter has an incomplete preserved source",
                ));
            }
        }
    } else {
        if !["legacy-json", "legacy-html", "unrecognized"].contains(&format.as_str())
            || version != 0
            || state == "editable"
        {
            return Err(import_invalid(
                "A legacy chapter body cannot be safely restored",
            ));
        }
        let content = string(body, "content")?;
        let original_content = string(body, "originalContent")?;
        let original_format = string(body, "originalFormat")?;
        if content.len() > 8 * 1024 * 1024
            || original_content.len() > 8 * 1024 * 1024
            || !["legacy-json", "legacy-html", "unrecognized"].contains(&original_format.as_str())
        {
            return Err(import_invalid(
                "A legacy chapter body cannot be safely restored",
            ));
        }
    }
    Ok(())
}

fn validate_tiptap_references(
    value: &Value,
    chapter_id: &str,
    note_ids: &HashSet<String>,
    character_ids: &HashSet<String>,
) -> Result<()> {
    let object = value
        .as_object()
        .ok_or_else(|| import_invalid("A Tiptap node is invalid"))?;
    if object.get("type").and_then(Value::as_str) == Some("mention") {
        if let Some(id) = object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("id"))
            .and_then(Value::as_str)
        {
            // Historical opaque mention IDs are retained. Canonical IDs are
            // checked because they are unambiguous character references.
            if canonical_uuid(id) && !character_ids.contains(id) {
                return Err(import_invalid("A Mention references a missing character"));
            }
        }
    }
    if let Some(marks) = object.get("marks") {
        for mark in marks
            .as_array()
            .ok_or_else(|| import_invalid("A Tiptap mark list is invalid"))?
        {
            if mark.get("type").and_then(Value::as_str) == Some("foreshadowing") {
                let id = mark
                    .get("attrs")
                    .and_then(Value::as_object)
                    .and_then(|attrs| attrs.get("id"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| import_invalid("A foreshadowing mark has no note reference"))?;
                if !note_ids.contains(id) {
                    return Err(import_invalid(
                        "A foreshadowing mark references a missing note",
                    ));
                }
            }
        }
    }
    if let Some(children) = object.get("content") {
        for child in children
            .as_array()
            .ok_or_else(|| import_invalid("A Tiptap child list is invalid"))?
        {
            validate_tiptap_references(child, chapter_id, note_ids, character_ids)?;
        }
    }
    let _ = chapter_id;
    Ok(())
}

fn validate_notes(
    work: &Value,
    chapter_ids: &HashSet<String>,
) -> Result<HashMap<String, HashSet<String>>> {
    let mut by_chapter = HashMap::new();
    for note in array(work, "foreshadowings")? {
        let chapter_id = uuid_field(note, "chapterId")?;
        if !chapter_ids.contains(&chapter_id) {
            return Err(import_invalid(
                "A foreshadowing note references another work",
            ));
        }
        let id = non_empty_text(note, "id", 4096)?;
        non_empty_text(note, "excerpt", 1_048_576)?;
        non_empty_text(note, "note", 1_048_576)?;
        check_metadata(note)?;
        if note
            .get("isRecovered")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(import_invalid(
                "A foreshadowing note has an invalid recovery flag",
            ));
        }
        let ids = by_chapter.entry(chapter_id).or_insert_with(HashSet::new);
        if !ids.insert(id) {
            return Err(import_invalid(
                "A chapter contains duplicate foreshadowing IDs",
            ));
        }
    }
    Ok(by_chapter)
}

pub(super) fn validate_work(work: &Value) -> Result<ImportCounts> {
    let root = work
        .as_object()
        .ok_or_else(|| import_invalid("The export root must be an object"))?;
    const TOP_LEVEL_FIELDS: &[&str] = &[
        "schemaVersion",
        "exportId",
        "exportedAt",
        "producer",
        "snapshot",
        "book",
        "volumes",
        "chapters",
        "characters",
        "graphs",
        "foreshadowings",
        "planning",
        "brainstormWorkspaces",
        "assets",
        "extensions",
    ];
    if root
        .keys()
        .any(|key| !TOP_LEVEL_FIELDS.contains(&key.as_str()))
    {
        return Err(import_invalid(
            "The export contains an unsupported top-level field",
        ));
    }
    if root.get("schemaVersion").and_then(Value::as_i64) != Some(EXCHANGE_SCHEMA_VERSION) {
        return Err(unsupported_version());
    }
    if !canonical_uuid(string(work, "exportId")?.as_str()) {
        return Err(import_invalid("The export ID is invalid"));
    }
    non_empty_text(work, "exportedAt", 128)?;
    let producer = required(work, "producer")?;
    non_empty_text(producer, "appVersion", 64)?;
    let platform = string(producer, "platform")?;
    if !["windows", "macos", "linux", "unknown"].contains(&platform.as_str()) {
        return Err(import_invalid("The export producer platform is invalid"));
    }
    let snapshot = object(work, "snapshot")?;
    if snapshot
        .get("databaseVersion")
        .and_then(Value::as_i64)
        .is_none()
        || snapshot.get("contentVersion").and_then(Value::as_i64) != Some(EXCHANGE_CONTENT_VERSION)
    {
        return Err(unsupported_version());
    }
    let book = required(work, "book")?;
    let book_id = uuid_field(book, "id")?;
    non_empty_text(book, "title", 4096)?;
    string(book, "author")?;
    let status = string(book, "status")?;
    if !["serializing", "completed"].contains(&status.as_str()) {
        return Err(import_invalid("The book status is invalid"));
    }
    integer(book, "position")?;
    boolean(book, "isReadOnly")?;
    check_metadata(book)?;
    if let Some(color) = book.get("coverColor") {
        if !color.is_string() || color.as_str().unwrap_or_default().len() > 64 {
            return Err(import_invalid("The book cover color is invalid"));
        }
    }

    let volumes = array(work, "volumes")?;
    let mut volume_ids = HashSet::new();
    for volume in volumes {
        let id = uuid_field(volume, "id")?;
        if !volume_ids.insert(id) || uuid_field(volume, "bookId")? != book_id {
            return Err(import_invalid("A volume has a duplicate ID or wrong book"));
        }
        non_empty_text(volume, "title", 4096)?;
        if !["draft", "published"].contains(&string(volume, "status")?.as_str()) {
            return Err(import_invalid("A volume status is invalid"));
        }
        integer(volume, "position")?;
        boolean(volume, "isReadOnly")?;
        check_metadata(volume)?;
    }

    let chapters = array(work, "chapters")?;
    let mut chapter_ids = HashSet::new();
    for chapter in chapters {
        let id = uuid_field(chapter, "id")?;
        if !chapter_ids.insert(id) || uuid_field(chapter, "bookId")? != book_id {
            return Err(import_invalid("A chapter has a duplicate ID or wrong book"));
        }
        if !volume_ids.contains(&uuid_field(chapter, "volumeId")?) {
            return Err(import_invalid("A chapter references a missing volume"));
        }
        non_empty_text(chapter, "title", 4096)?;
        if !["draft", "published"].contains(&string(chapter, "status")?.as_str()) {
            return Err(import_invalid("A chapter status is invalid"));
        }
        integer(chapter, "position")?;
        integer(chapter, "wordCount")?;
        boolean(chapter, "isReadOnly")?;
        check_metadata(chapter)?;
    }

    let characters = array(work, "characters")?;
    let mut character_ids = HashSet::new();
    let mut character_handles = HashMap::new();
    for character in characters {
        let id = uuid_field(character, "id")?;
        if !character_ids.insert(id.clone()) || uuid_field(character, "bookId")? != book_id {
            return Err(import_invalid(
                "A character has a duplicate ID or wrong book",
            ));
        }
        non_empty_text(character, "name", 4096)?;
        if !["protagonist", "antagonist", "supporting", "mob"]
            .contains(&string(character, "role")?.as_str())
        {
            return Err(import_invalid("A character role is invalid"));
        }
        if !required(character, "aliases")?.is_array()
            || !required(character, "tags")?.is_array()
            || string(character, "description")?.len() > 65_536
            || string(character, "color")?.is_empty()
        {
            return Err(import_invalid("A character field is invalid"));
        }
        validate_handle_config(character.get("handleConfig"))?;
        character_handles.insert(
            id,
            character
                .get("handleConfig")
                .cloned()
                .unwrap_or(Value::Null),
        );
        boolean(character, "isArchived")?;
        integer(character, "position")?;
        check_metadata(character)?;
    }

    let notes_by_chapter = validate_notes(work, &chapter_ids)?;
    for chapter in chapters {
        let chapter_id = chapter["id"].as_str().unwrap();
        let expected = chapter["foreshadowingIds"]
            .as_array()
            .ok_or_else(|| import_invalid("A chapter note list is invalid"))?;
        let mut listed: HashSet<String> = HashSet::new();
        for id in expected {
            let id = id
                .as_str()
                .ok_or_else(|| import_invalid("A chapter note ID is invalid"))?;
            if !listed.insert(id.to_owned()) {
                return Err(import_invalid(
                    "A chapter contains duplicate foreshadowing IDs",
                ));
            }
        }
        if listed
            != notes_by_chapter
                .get(chapter_id)
                .cloned()
                .unwrap_or_default()
        {
            return Err(import_invalid(
                "A chapter note list does not match its notes",
            ));
        }
        validate_body(
            required(chapter, "body")?,
            chapter_id,
            &listed,
            &character_ids,
        )?;
    }

    let graphs = array(work, "graphs")?;
    if graphs.len() > 1 {
        return Err(import_invalid(
            "An export may contain only one relationship graph",
        ));
    }
    let mut node_keys = HashSet::new();
    let mut edge_ids = HashSet::new();
    let mut graph_nodes = 0;
    let mut graph_edges = 0;
    for graph in graphs {
        if uuid_field(graph, "bookId")? != book_id {
            return Err(import_invalid("A graph belongs to another work"));
        }
        integer(graph, "databaseVersion")?;
        integer(graph, "createdAt")?;
        integer(graph, "updatedAt")?;
        let nodes = array(graph, "nodes")?;
        let edges = array(graph, "edges")?;
        graph_nodes += nodes.len();
        graph_edges += edges.len();
        for node in nodes {
            let node_key = uuid_field(node, "nodeKey")?;
            if !node_keys.insert(node_key)
                || !character_ids.contains(&uuid_field(node, "characterId")?)
            {
                return Err(import_invalid(
                    "A graph node has an invalid identity or character",
                ));
            }
            let x = required(node, "positionX")?.as_f64();
            let y = required(node, "positionY")?.as_f64();
            if !x.is_some_and(|value| value.is_finite() && value.abs() <= 1_000_000.0)
                || !y.is_some_and(|value| value.is_finite() && value.abs() <= 1_000_000.0)
            {
                return Err(import_invalid("A graph node has invalid coordinates"));
            }
            validate_handle_config(node.get("handleConfig"))?;
        }
        let defaults = |character_id: &str| {
            let mut result = HashMap::from([
                ("top", "target"),
                ("right", "source"),
                ("bottom", "source"),
                ("left", "target"),
            ]);
            if let Some(config) = character_handles
                .get(character_id)
                .and_then(Value::as_object)
            {
                for (side, mode) in config {
                    if let Some(mode) = mode.as_str() {
                        result.insert(side.as_str(), mode);
                    }
                }
            }
            result
        };
        let mut effective_handles = HashMap::new();
        for node in nodes {
            let character_id = node["characterId"].as_str().unwrap();
            let mut config = defaults(character_id);
            if let Some(overrides) = node.get("handleConfig").and_then(Value::as_object) {
                for (side, mode) in overrides {
                    if let Some(mode) = mode.as_str() {
                        config.insert(side.as_str(), mode);
                    }
                }
            }
            effective_handles.insert(node["nodeKey"].as_str().unwrap().to_owned(), config);
        }
        for edge in edges {
            let id = uuid_field(edge, "id")?;
            if !edge_ids.insert(id)
                || edge["sourceNodeKey"] == edge["targetNodeKey"]
                || string(edge, "sourceHandle")?.len() > 4096
                || string(edge, "targetHandle")?.len() > 4096
                || string(edge, "label")?.len() > 4096
            {
                return Err(import_invalid("A graph edge is invalid"));
            }
            validate_edge_handle(
                &effective_handles,
                &string(edge, "sourceNodeKey")?,
                &string(edge, "sourceHandle")?,
                "source",
            )?;
            validate_edge_handle(
                &effective_handles,
                &string(edge, "targetNodeKey")?,
                &string(edge, "targetHandle")?,
                "target",
            )?;
        }
    }

    let planning = required(work, "planning")?;
    if uuid_field(planning, "bookId")? != book_id {
        return Err(import_invalid("Planning belongs to another work"));
    }
    integer(planning, "databaseVersion")?;
    if string(planning, "storySummary")?.len() > 1_048_576
        || string(planning, "storyBackground")?.len() > 1_048_576
    {
        return Err(import_invalid("Planning text exceeds the supported size"));
    }
    let summaries = array(planning, "chapterSummaries")?;
    for summary in summaries {
        if !chapter_ids.contains(&uuid_field(summary, "chapterId")?)
            || string(summary, "summary")?.len() > 1_048_576
        {
            return Err(import_invalid("A planning summary references another work"));
        }
        if let Some(version) = summary.get("sourceChapterVersion") {
            if version.as_i64().is_none() {
                return Err(import_invalid("A planning source version is invalid"));
            }
        }
        integer(summary, "updatedAt")?;
    }
    let plots = array(planning, "plotSettings")?;
    let mut plot_ids = HashSet::new();
    for plot in plots {
        let id = non_empty_text(plot, "id", 4096)?;
        if !plot_ids.insert(id) {
            return Err(import_invalid("Planning contains duplicate plot IDs"));
        }
        for key in ["chapterIds", "missingChapterIds"] {
            if let Some(values) = plot.get(key) {
                for chapter_id in values
                    .as_array()
                    .ok_or_else(|| import_invalid("A plot chapter list is invalid"))?
                {
                    if !chapter_ids.contains(
                        chapter_id
                            .as_str()
                            .ok_or_else(|| import_invalid("A plot chapter ID is invalid"))?,
                    ) {
                        return Err(import_invalid("A plot references another work"));
                    }
                }
            }
        }
        string(plot, "title")?;
        string(plot, "details")?;
        integer(plot, "createdAt")?;
        integer(plot, "updatedAt")?;
    }

    let workspaces = array(work, "brainstormWorkspaces")?;
    if workspaces.len() > 1 {
        return Err(import_invalid(
            "An export may contain only one brainstorm workspace",
        ));
    }
    let mut brainstorm_options = 0;
    for workspace in workspaces {
        if uuid_field(workspace, "bookId")? != book_id {
            return Err(import_invalid(
                "A brainstorm workspace belongs to another work",
            ));
        }
        check_metadata(workspace)?;
        for chapter_id in array(workspace, "selectedChapterIds")? {
            if !chapter_ids.contains(
                chapter_id
                    .as_str()
                    .ok_or_else(|| import_invalid("A selected chapter ID is invalid"))?,
            ) {
                return Err(import_invalid(
                    "A brainstorm workspace references another work",
                ));
            }
        }
        if !required(workspace, "contextSnapshot")?.is_object()
            || required(workspace, "contextSnapshot")?.to_string().len() > 4_194_304
        {
            return Err(import_invalid("A brainstorm context snapshot is invalid"));
        }
        let options = array(workspace, "generatedOptions")?;
        brainstorm_options += options.len();
        let mut option_ids = HashSet::new();
        for option in options {
            let id = non_empty_text(option, "id", 4096)?;
            if !option_ids.insert(id) {
                return Err(import_invalid(
                    "A brainstorm workspace contains duplicate option IDs",
                ));
            }
            for key in [
                "title",
                "conflict",
                "motivation",
                "consequences",
                "development",
            ] {
                string(option, key)?;
            }
        }
        if let Some(selected) = workspace.get("selectedOptionId") {
            if !selected.is_null()
                && !option_ids.contains(
                    selected
                        .as_str()
                        .ok_or_else(|| import_invalid("A selected brainstorm option is invalid"))?,
                )
            {
                return Err(import_invalid(
                    "A selected brainstorm option does not exist",
                ));
            }
        }
        validate_brainstorm_metadata(workspace, &book_id, &chapter_ids)?;
    }

    let assets = array(work, "assets")?;
    if !assets.is_empty() {
        return Err(StorageError::new(
            "UNSUPPORTED_ASSET",
            "This version cannot import embedded assets yet; no database changes were made",
        ));
    }

    Ok(ImportCounts {
        volumes: volumes.len(),
        chapters: chapters.len(),
        characters: characters.len(),
        graph_nodes,
        graph_edges,
        foreshadowings: array(work, "foreshadowings")?.len(),
        planning_summaries: summaries.len(),
        plot_settings: plots.len(),
        brainstorm_workspaces: workspaces.len(),
        brainstorm_options,
        assets: assets.len(),
    })
}

fn validate_brainstorm_metadata(
    workspace: &Value,
    book_id: &str,
    chapter_ids: &HashSet<String>,
) -> Result<()> {
    let Some(metadata) = workspace.get("generationMetadata") else {
        return Ok(());
    };
    let source = required(metadata, "source")?;
    if uuid_field(source, "bookId")? != book_id {
        return Err(import_invalid(
            "Brainstorm generation metadata belongs to another work",
        ));
    }
    for selected in array(source, "selectedChapters")? {
        if !chapter_ids.contains(&uuid_field(selected, "chapterId")?) {
            return Err(import_invalid(
                "Brainstorm generation metadata references another work",
            ));
        }
        integer(selected, "databaseVersion")?;
    }
    Ok(())
}

fn validate_edge_handle(
    handles: &HashMap<String, HashMap<&str, &str>>,
    node_key: &str,
    handle: &str,
    direction: &str,
) -> Result<()> {
    let (side, suffix) = handle
        .split_once('-')
        .ok_or_else(|| import_invalid("A graph edge handle is invalid"))?;
    if suffix != direction
        || !handles
            .get(node_key)
            .and_then(|config| config.get(side))
            .is_some_and(|mode| *mode == direction || *mode == "both")
    {
        return Err(import_invalid("A graph edge handle is unavailable"));
    }
    Ok(())
}
