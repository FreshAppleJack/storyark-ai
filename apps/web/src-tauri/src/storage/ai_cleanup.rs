use super::{Database, Result};
use rusqlite::TransactionBehavior;

impl Database {
    pub(super) fn cleanup_credentials(&mut self) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let items = tx
            .prepare("SELECT credential_ref,credential_mode FROM ai_credential_cleanup")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (reference, mode) in items {
            let active = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM ai_model_configs WHERE credential_ref=?)",
                [&reference],
                |r| r.get::<_, bool>(0),
            )?;
            if active || self.credentials.remove(&reference, &mode).is_ok() {
                tx.execute(
                    "DELETE FROM ai_credential_cleanup WHERE credential_ref=?",
                    [&reference],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}
