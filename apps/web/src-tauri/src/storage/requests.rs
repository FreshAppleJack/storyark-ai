use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBook {
    pub title: String,
    pub author: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateVolume {
    pub book_id: String,
    pub title: String,
    pub expected_book_version: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateChapter {
    pub book_id: String,
    pub volume_id: String,
    pub title: String,
    pub expected_volume_version: i64,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveChapter {
    pub book_id: String,
    pub volume_id: String,
    pub chapter_id: String,
    pub expected_database_version: i64,
    pub session_key: String,
    pub revision: i64,
    pub title: String,
    pub content_format: String,
    pub content_version: i64,
    pub content: String,
    pub word_count: i64,
    pub foreshadowings: Vec<Value>,
}

// serde flatten and deny_unknown_fields are incompatible, so shared target
// shapes validate IDs and relationships in code instead of denying fields.
#[derive(Deserialize, Clone)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Target {
    Book {
        book_id: String,
    },
    Volume {
        book_id: String,
        volume_id: String,
    },
    Chapter {
        book_id: String,
        volume_id: String,
        chapter_id: String,
    },
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedTarget {
    #[serde(flatten)]
    pub target: Target,
    pub expected_database_version: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rename {
    #[serde(flatten)]
    pub target: ExpectedTarget,
    pub title: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetReadOnly {
    #[serde(flatten)]
    pub target: ExpectedTarget,
    pub is_read_only: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reorder {
    pub parent: Option<ExpectedTarget>,
    pub items: Vec<ExpectedTarget>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delete {
    #[serde(flatten)]
    pub target: ExpectedTarget,
    pub expected_parent_version: Option<i64>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CharacterInput {
    pub book_id: String,
    pub name: String,
    pub role: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub color: String,
    pub tags: Vec<String>,
    pub avatar: Option<String>,
    pub handle_config: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCharacter {
    #[serde(flatten)]
    pub character: CharacterInput,
    pub expected_book_version: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateCharacter {
    #[serde(flatten)]
    pub character: CharacterInput,
    pub character_id: String,
    pub expected_database_version: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveCharacter {
    pub book_id: String,
    pub character_id: String,
    pub expected_database_version: i64,
    pub is_archived: bool,
}
