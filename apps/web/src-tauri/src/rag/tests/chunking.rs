use crate::rag::chunking::{
    chunk_blocks, locator, text_blocks, tiptap_blocks, ChunkBlock, MAX_CHUNK_CHARS, OVERLAP_CHARS,
};
use crate::rag::sources::normalize_index_text;
use serde_json::json;

#[test]
fn omitted_empty_content_preserves_text_and_paragraph_locations() {
    let document = json!({"type":"doc","content":[
        {"type":"paragraph"},
        {"type":"paragraph","content":[{"type":"text","text":"那个男人回来了。"}]},
        {"type":"paragraph"},
        {"type":"paragraph","content":[{"type":"text","text":"老者打开了门。"}]},
        {"type":"paragraph"}
    ]});
    let blocks = tiptap_blocks(&document).unwrap();
    assert_eq!(blocks.len(), 5);
    let chunks = chunk_blocks(&blocks);
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[0].source_text, "那个男人回来了。");
    assert_eq!(chunks[0].paragraph_spans[0].paragraph_ordinal, 1);
    assert_eq!(chunks[0].paragraph_spans[0].node_path, vec![1]);
    assert_eq!(chunks[1].paragraph_spans[0].paragraph_ordinal, 3);
    assert_eq!(chunks[1].paragraph_spans[0].node_path, vec![3]);
    assert!(
        tiptap_blocks(&json!({"type":"doc","content":[{"type":"paragraph","content":42}]}))
            .is_none()
    );
}

#[test]
fn fixed_profile_handles_short_empty_and_repeated_text() {
    assert!(chunk_blocks(&text_blocks("   ")).is_empty());
    let short = chunk_blocks(&text_blocks("Hello，世界 123!"));
    assert_eq!(short.len(), 1);
    assert_eq!(short[0].index_text, "hello,世界 123!");

    let repeated = chunk_blocks(&[
        ChunkBlock {
            text: "same".into(),
            index_terms: Vec::new(),
            node_path: vec![0],
            paragraph_ordinal: Some(0),
            boundary_before: false,
        },
        ChunkBlock {
            text: "same".into(),
            index_terms: Vec::new(),
            node_path: vec![1],
            paragraph_ordinal: Some(1),
            boundary_before: false,
        },
    ]);
    assert_eq!(repeated.len(), 1);
    assert_eq!(repeated[0].paragraph_spans.len(), 2);
    assert!(repeated[0].source_text.contains("same\nsame"));
}

#[test]
fn normalization_is_stable_for_aliases_digits_and_full_width_punctuation() {
    assert_eq!(
        normalize_index_text("Ａlice　ALICE\t１２３。"),
        "alice alice 123。"
    );
}

#[test]
fn fixed_profile_splits_long_cjk_without_spaces_and_keeps_overlap() {
    let input = "甲乙丙丁戊己庚辛壬癸".repeat(180);
    let chunks = chunk_blocks(&text_blocks(&input));
    assert!(chunks.len() > 1);
    assert!(chunks
        .iter()
        .all(|chunk| chunk.source_text.chars().count() <= MAX_CHUNK_CHARS));
    let previous_tail = chunks[0]
        .source_text
        .chars()
        .rev()
        .take(OVERLAP_CHARS)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    assert!(chunks[1].source_text.starts_with(&previous_tail));
}

#[test]
fn empty_paragraphs_create_scene_boundaries_without_cross_scene_overlap() {
    let chunks = chunk_blocks(&[
        ChunkBlock {
            text: "before".into(),
            index_terms: Vec::new(),
            node_path: vec![0],
            paragraph_ordinal: Some(0),
            boundary_before: false,
        },
        ChunkBlock {
            text: String::new(),
            index_terms: Vec::new(),
            node_path: vec![1],
            paragraph_ordinal: Some(1),
            boundary_before: false,
        },
        ChunkBlock {
            text: "after".into(),
            index_terms: Vec::new(),
            node_path: vec![2],
            paragraph_ordinal: Some(2),
            boundary_before: false,
        },
    ]);
    assert_eq!(chunks.len(), 2);
    assert!(!chunks[1].source_text.contains("before"));
}

#[test]
fn tiptap_mentions_keep_display_text_and_ignore_unknown_marks() {
    let document = json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "角色: ", "marks": [{"type": "unknownMark", "attrs": {"x": 1}}]},
                {"type": "mention", "attrs": {"id": "character-1", "label": "艾丽丝", "aliases": ["Alice"]}}
            ]
        }]
    });
    let blocks = tiptap_blocks(&document).unwrap();
    assert_eq!(blocks[0].text, "角色: 艾丽丝");
    let chunks = chunk_blocks(&blocks);
    assert_eq!(chunks[0].source_text, "角色: 艾丽丝");
    assert_eq!(chunks[0].index_text, "角色: 艾丽丝 alice");
}

#[test]
fn locator_keeps_paths_paragraphs_hash_and_quote() {
    let blocks = vec![ChunkBlock {
        text: "第一段".into(),
        index_terms: Vec::new(),
        node_path: vec![0],
        paragraph_ordinal: Some(0),
        boundary_before: false,
    }];
    let chunk = &chunk_blocks(&blocks)[0];
    let locator = locator(
        chunk,
        Some("chapter-1".into()),
        Some("volume-1".into()),
        Some("Title".into()),
        Some("Volume".into()),
        Some(3),
    );
    assert_eq!(locator.chapter_id.as_deref(), Some("chapter-1"));
    assert_eq!(locator.paragraph_ordinals, vec![0]);
    assert_eq!(locator.tiptap_node_paths, vec![vec![0]]);
    assert_eq!(locator.text_hash, chunk.text_hash);
    assert_eq!(locator.short_quote, "第一段");
}
