use crate::rag::lexical::{fts_document_text, fts_query};

#[test]
fn cjk_document_contains_explainable_bigrams_and_trigrams() {
    let document = fts_document_text("灯火照亮旧门");
    assert!(document.contains("cjk2_灯火"));
    assert!(document.contains("cjk3_灯火照"));
}

#[test]
fn query_uses_safe_anded_terms_for_cjk_and_ascii() {
    let query = fts_query("灯火照亮 Alice").unwrap();
    assert!(query.contains("\"cjk2_灯火\""));
    assert!(query.contains("\"alice\""));
    assert!(query.contains(" AND "));
    assert!(!query.contains("OR"));
}

#[test]
fn short_cjk_text_remains_searchable() {
    assert_eq!(fts_query("门").as_deref(), Some("\"cjk1_门\""));
}

#[test]
fn punctuation_and_full_width_text_are_normalized() {
    let query = fts_query("ＡＬＩＣＥ！").unwrap();
    assert_eq!(query, "\"alice\"");
}
