//! Context preparation stays separate from provider transport and persistence.
use super::{
    generation::{ContextInput, ContextSnapshot},
    tasks::AiRuntime,
};
use crate::storage::Result;

pub fn prepare(runtime: &AiRuntime, input: ContextInput) -> Result<ContextSnapshot> {
    runtime.prepare(input)
}
