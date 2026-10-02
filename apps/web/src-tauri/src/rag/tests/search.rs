use crate::rag::search::{assemble_context, estimate_tokens, rrf_score, ContextItem};

#[test]
fn reciprocal_rank_fusion_prefers_hits_seen_by_both_recallers() {
    assert!(rrf_score(Some(1), Some(3)) > rrf_score(Some(1), None));
    assert!(rrf_score(Some(1), None) > rrf_score(None, Some(10)));
}

#[test]
fn context_budget_omits_whole_evidence_items_without_truncating_them() {
    let context = assemble_context(
        &[
            ContextItem {
                hit_id: "hit-1".into(),
                label: "manuscript / v2".into(),
                text: "第一条证据".into(),
            },
            ContextItem {
                hit_id: "hit-2".into(),
                label: "manuscript / v2".into(),
                text: "第二条证据".into(),
            },
        ],
        30,
        None,
    );
    assert_eq!(context.included_hit_ids, vec!["hit-1"]);
    assert_eq!(context.omitted_hit_ids, vec!["hit-2"]);
    assert!(context.text.contains("第一条证据"));
    assert!(!context.text.contains("第二条证据"));
}

#[test]
fn token_estimate_treats_cjk_and_ascii_runs_deterministically() {
    assert_eq!(estimate_tokens("abcd"), 1);
    assert_eq!(estimate_tokens("你好世界"), 4);
    assert_eq!(estimate_tokens("abcd 你好"), 3);
}
