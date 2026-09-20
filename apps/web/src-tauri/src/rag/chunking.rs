use super::contracts::{RetrievalChunkLocator, RetrievalParagraphSpan};
use serde_json::Value;

pub const CHUNK_INDEX_VERSION: i64 = 1;
pub const TARGET_CONTENT_CHARS: usize = 600;
pub const MAX_CHUNK_CHARS: usize = 800;
pub const OVERLAP_CHARS: usize = 80;
pub const SHORT_QUOTE_CHARS: usize = 96;

const MAX_PIECE_CHARS: usize = MAX_CHUNK_CHARS - OVERLAP_CHARS - 1;
const BREAK_LOOKBACK_CHARS: usize = 80;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkBlock {
    pub text: String,
    pub index_terms: Vec<String>,
    pub node_path: Vec<usize>,
    pub paragraph_ordinal: Option<i64>,
    pub boundary_before: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkParagraphSpan {
    pub paragraph_ordinal: i64,
    pub node_path: Vec<usize>,
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkDraft {
    pub ordinal: i64,
    pub source_text: String,
    pub index_text: String,
    pub text_hash: String,
    pub short_quote: String,
    pub paragraph_spans: Vec<ChunkParagraphSpan>,
}

#[derive(Clone)]
struct ChunkPiece {
    block_index: usize,
    text: String,
    index_terms: Vec<String>,
    node_path: Vec<usize>,
    paragraph_ordinal: Option<i64>,
    start_offset: usize,
    end_offset: usize,
    boundary_before: bool,
    is_overlap: bool,
}

pub fn text_blocks(value: &str) -> Vec<ChunkBlock> {
    if value.trim().is_empty() {
        return Vec::new();
    }
    value
        .split('\n')
        .enumerate()
        .map(|(index, text)| ChunkBlock {
            text: text.to_owned(),
            index_terms: Vec::new(),
            node_path: Vec::new(),
            paragraph_ordinal: None,
            boundary_before: index > 0 && text.trim().is_empty(),
        })
        .collect()
}

pub fn tiptap_blocks(value: &Value) -> Option<Vec<ChunkBlock>> {
    let object = value.as_object()?;
    if object.get("type")?.as_str()? != "doc" {
        return None;
    }
    let mut blocks = Vec::new();
    let mut paragraph_ordinal = 0_i64;
    collect_block_nodes(value, &mut Vec::new(), &mut paragraph_ordinal, &mut blocks)?;
    Some(blocks)
}

pub fn chunk_blocks(blocks: &[ChunkBlock]) -> Vec<ChunkDraft> {
    let mut pieces = Vec::new();
    let mut boundary_pending = false;
    for (block_index, block) in blocks.iter().enumerate() {
        if block.text.trim().is_empty() {
            boundary_pending = true;
            continue;
        }
        let mut block_pieces = split_block(block_index, block);
        if boundary_pending {
            if let Some(first) = block_pieces.first_mut() {
                first.boundary_before = true;
            }
            boundary_pending = false;
        }
        pieces.extend(block_pieces);
    }
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut pending_overlap = Vec::new();

    for piece in pieces {
        if piece.boundary_before {
            flush_current(&mut current, &mut pending_overlap, &mut chunks);
            pending_overlap.clear();
        }
        if current.is_empty() && !pending_overlap.is_empty() {
            current.append(&mut pending_overlap);
        }
        if !current.is_empty() {
            let content_chars = content_chars(&current);
            let total_chars = rendered_chars(&current) + separator_chars(&current, &piece);
            if content_chars >= TARGET_CONTENT_CHARS
                || total_chars + piece.text.chars().count() > MAX_CHUNK_CHARS
            {
                flush_current(&mut current, &mut pending_overlap, &mut chunks);
                if !pending_overlap.is_empty() {
                    current.append(&mut pending_overlap);
                }
            }
        }
        current.push(piece);
    }
    flush_current(&mut current, &mut pending_overlap, &mut chunks);
    chunks
}

pub fn locator(
    chunk: &ChunkDraft,
    chapter_id: Option<String>,
    volume_id: Option<String>,
    chapter_title_snapshot: Option<String>,
    volume_title_snapshot: Option<String>,
    chapter_source_version: Option<i64>,
) -> RetrievalChunkLocator {
    let paragraph_ordinals = chunk
        .paragraph_spans
        .iter()
        .map(|span| span.paragraph_ordinal)
        .fold(Vec::new(), |mut values, ordinal| {
            if !values.contains(&ordinal) {
                values.push(ordinal);
            }
            values
        });
    let tiptap_node_paths = chunk
        .paragraph_spans
        .iter()
        .map(|span| span.node_path.clone())
        .fold(Vec::new(), |mut values, path| {
            if !values.contains(&path) {
                values.push(path);
            }
            values
        });
    RetrievalChunkLocator {
        chapter_id,
        volume_id,
        chapter_title_snapshot,
        volume_title_snapshot,
        chapter_source_version,
        chunk_ordinal: chunk.ordinal,
        paragraph_ordinals,
        tiptap_node_paths,
        paragraph_spans: chunk
            .paragraph_spans
            .iter()
            .map(|span| RetrievalParagraphSpan {
                paragraph_ordinal: span.paragraph_ordinal,
                node_path: span.node_path.clone(),
                start_offset: span.start_offset as i64,
                end_offset: span.end_offset as i64,
            })
            .collect(),
        text_hash: chunk.text_hash.clone(),
        short_quote: chunk.short_quote.clone(),
    }
}

pub fn chunk_id(source_id: &str, source_version: i64, ordinal: i64, text_hash: &str) -> String {
    format!(
        "{}:v{}:i{}:o{}:{}",
        source_id, source_version, CHUNK_INDEX_VERSION, ordinal, text_hash
    )
}

pub fn stable_text_hash(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64-{hash:016x}")
}

fn split_block(block_index: usize, block: &ChunkBlock) -> Vec<ChunkPiece> {
    let chars = block.text.chars().collect::<Vec<_>>();
    if chars.is_empty() || block.text.trim().is_empty() {
        return Vec::new();
    }
    let mut pieces = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + MAX_PIECE_CHARS).min(chars.len());
        if end < chars.len() {
            end = preferred_break(&chars, start, end);
        }
        if end <= start {
            end = (start + MAX_PIECE_CHARS).min(chars.len());
        }
        pieces.push(ChunkPiece {
            block_index,
            text: chars[start..end].iter().collect(),
            index_terms: block.index_terms.clone(),
            node_path: block.node_path.clone(),
            paragraph_ordinal: block.paragraph_ordinal,
            start_offset: start,
            end_offset: end,
            boundary_before: pieces.is_empty() && block.boundary_before,
            is_overlap: false,
        });
        start = end;
    }
    pieces
}

fn preferred_break(chars: &[char], start: usize, end: usize) -> usize {
    let lower_bound = end.saturating_sub(BREAK_LOOKBACK_CHARS).max(start + 1);
    for index in (lower_bound..end).rev() {
        if chars[index].is_whitespace() || is_sentence_boundary(chars[index]) {
            return index + 1;
        }
    }
    end
}

fn is_sentence_boundary(character: char) -> bool {
    matches!(
        character,
        '。' | '！' | '？' | '；' | '：' | '，' | '、' | '．' | '.' | '!' | '?' | ';' | ':' | ','
    )
}

fn content_chars(pieces: &[ChunkPiece]) -> usize {
    pieces
        .iter()
        .filter(|piece| !piece.is_overlap)
        .map(|piece| piece.text.chars().count())
        .sum()
}

fn rendered_chars(pieces: &[ChunkPiece]) -> usize {
    pieces.iter().map(|piece| piece.text.chars().count()).sum()
}

fn separator_chars(pieces: &[ChunkPiece], next: &ChunkPiece) -> usize {
    pieces
        .last()
        .is_some_and(|previous| previous.block_index != next.block_index) as usize
}

fn flush_current(
    current: &mut Vec<ChunkPiece>,
    pending_overlap: &mut Vec<ChunkPiece>,
    chunks: &mut Vec<ChunkDraft>,
) {
    if current.is_empty() {
        return;
    }
    let ordinal = chunks.len() as i64;
    let (source_text, paragraph_spans, index_terms) = render(current);
    if source_text.is_empty() {
        current.clear();
        return;
    }
    let text_hash = stable_text_hash(&source_text);
    let index_text = std::iter::once(source_text.as_str())
        .chain(index_terms.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    chunks.push(ChunkDraft {
        ordinal,
        index_text: crate::rag::sources::normalize_index_text(&index_text),
        short_quote: short_quote(&source_text),
        source_text,
        text_hash,
        paragraph_spans,
    });
    *pending_overlap = overlap_tail(current);
    current.clear();
}

fn overlap_tail(current: &[ChunkPiece]) -> Vec<ChunkPiece> {
    let mut remaining = OVERLAP_CHARS;
    let mut tail = Vec::new();
    for piece in current.iter().rev() {
        if piece.is_overlap || remaining == 0 {
            continue;
        }
        let length = piece.text.chars().count();
        let take = length.min(remaining);
        let start = length - take;
        let text = piece
            .text
            .chars()
            .skip(start)
            .take(take)
            .collect::<String>();
        tail.push(ChunkPiece {
            block_index: piece.block_index,
            text,
            index_terms: piece.index_terms.clone(),
            node_path: piece.node_path.clone(),
            paragraph_ordinal: piece.paragraph_ordinal,
            start_offset: piece.end_offset - take,
            end_offset: piece.end_offset,
            boundary_before: false,
            is_overlap: true,
        });
        remaining -= take;
    }
    tail.reverse();
    tail
}

fn render(pieces: &[ChunkPiece]) -> (String, Vec<ChunkParagraphSpan>, Vec<String>) {
    let mut text = String::new();
    let mut spans = Vec::new();
    let mut index_terms = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        if !text.is_empty() && index > 0 && pieces[index - 1].block_index != piece.block_index {
            text.push('\n');
        }
        text.push_str(&piece.text);
        for term in &piece.index_terms {
            if !index_terms.contains(term) {
                index_terms.push(term.clone());
            }
        }
        if let Some(paragraph_ordinal) = piece.paragraph_ordinal {
            spans.push(ChunkParagraphSpan {
                paragraph_ordinal,
                node_path: piece.node_path.clone(),
                start_offset: piece.start_offset,
                end_offset: piece.end_offset,
            });
        }
    }
    (text, spans, index_terms)
}

fn short_quote(value: &str) -> String {
    value.chars().take(SHORT_QUOTE_CHARS).collect()
}

fn collect_block_nodes(
    value: &Value,
    path: &mut Vec<usize>,
    paragraph_ordinal: &mut i64,
    blocks: &mut Vec<ChunkBlock>,
) -> Option<()> {
    let object = value.as_object()?;
    let kind = object.get("type")?.as_str()?;
    match kind {
        "doc" | "bulletList" | "orderedList" | "listItem" => {
            let children = object.get("content").and_then(Value::as_array)?;
            for (index, child) in children.iter().enumerate() {
                path.push(index);
                collect_block_nodes(child, path, paragraph_ordinal, blocks)?;
                path.pop();
            }
        }
        "paragraph" | "heading" | "blockquote" | "codeBlock" => {
            let mut index_terms = Vec::new();
            let text = inline_text(value, &mut index_terms)?;
            let boundary_before = kind == "heading" && !blocks.is_empty();
            blocks.push(ChunkBlock {
                text,
                index_terms,
                node_path: path.clone(),
                paragraph_ordinal: Some(*paragraph_ordinal),
                boundary_before,
            });
            *paragraph_ordinal += 1;
        }
        "horizontalRule" => blocks.push(ChunkBlock {
            text: String::new(),
            index_terms: Vec::new(),
            node_path: path.clone(),
            paragraph_ordinal: None,
            boundary_before: true,
        }),
        _ => return None,
    }
    Some(())
}

fn inline_text(value: &Value, index_terms: &mut Vec<String>) -> Option<String> {
    let object = value.as_object()?;
    let kind = object.get("type")?.as_str()?;
    match kind {
        "text" => Some(object.get("text")?.as_str()?.to_owned()),
        "mention" => object
            .get("attrs")
            .and_then(|attrs| {
                let object = attrs.as_object()?;
                if let Some(aliases) = object.get("aliases").and_then(Value::as_array) {
                    index_terms.extend(aliases.iter().filter_map(Value::as_str).map(str::to_owned));
                }
                object
                    .get("label")
                    .or_else(|| object.get("id"))
                    .and_then(Value::as_str)
            })
            .map(str::to_owned),
        "hardBreak" => Some("\n".to_owned()),
        "paragraph" | "heading" | "blockquote" | "codeBlock" => {
            let children = object.get("content").and_then(Value::as_array)?;
            let mut text = String::new();
            for child in children {
                text.push_str(&inline_text(child, index_terms)?);
            }
            Some(text)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
            crate::rag::sources::normalize_index_text("Ａlice　ALICE\t１２３。"),
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
}
