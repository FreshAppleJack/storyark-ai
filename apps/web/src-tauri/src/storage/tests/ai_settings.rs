use super::*;
use crate::ai::{
    config::{ConfigInput, ConfigVersion, DeleteConfig, Protocol, SetDefault},
    credentials::{Secret, Vault},
    settings::{CredentialChange, SaveSettings},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct VaultData {
    values: HashMap<String, String>,
    fail_set: bool,
    fail_remove: bool,
}
struct TestVault(Arc<Mutex<VaultData>>);
impl Vault for TestVault {
    fn get(&self, r: &str) -> std::result::Result<Secret, ()> {
        self.0
            .lock()
            .unwrap()
            .values
            .get(r)
            .cloned()
            .map(zeroize::Zeroizing::new)
            .ok_or(())
    }
    fn set(&mut self, r: &str, s: &str) -> std::result::Result<(), ()> {
        let mut d = self.0.lock().unwrap();
        if d.fail_set {
            return Err(());
        }
        d.values.insert(r.into(), s.into());
        Ok(())
    }
    fn remove(&mut self, r: &str) -> std::result::Result<(), ()> {
        let mut d = self.0.lock().unwrap();
        if d.fail_remove {
            return Err(());
        }
        d.values.remove(r);
        Ok(())
    }
}
fn input(id: Option<String>, version: u64, remember: bool) -> SaveSettings {
    SaveSettings {
        id,
        expected_config_version: version,
        config: ConfigInput {
            name: "Test".into(),
            protocol: Protocol::OpenaiResponses,
            base_url: "https://example.com/v1".into(),
            model_id: "fixture".into(),
            timeout_ms: 30000,
            max_output_tokens: 128,
        },
        credential: CredentialChange::Replace {
            key: "synthetic-test-value".into(),
            remember,
        },
    }
}
#[test]
fn configuration_crud_versions_secrets_and_restart() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let vault = Arc::new(Mutex::new(VaultData::default()));
    db.credentials.system = Box::new(TestVault(vault.clone()));
    let ack = db.ai_save(input(None, 0, true)).unwrap();
    let id = ack["id"].as_str().unwrap().to_owned();
    let list = db.ai_list().unwrap();
    assert_eq!(list["configs"][0]["credentialStatus"], "configured");
    assert!(!list.to_string().contains("synthetic-test-value"));
    assert!(list["configs"][0].get("credentialRef").is_none());
    db.ai_default(SetDefault {
        config: Some(ConfigVersion {
            id: id.clone(),
            expected_config_version: 1,
        }),
        expected_database_version: 0,
    })
    .unwrap();
    assert_eq!(
        db.ai_save(input(Some(id.clone()), 2, true))
            .unwrap_err()
            .code,
        "VERSION_CONFLICT"
    );
    assert_eq!(vault.lock().unwrap().values.len(), 1);
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    db.credentials.system = Box::new(TestVault(vault));
    assert_eq!(
        db.ai_list().unwrap()["configs"][0]["credentialStatus"],
        "configured"
    );
    db.ai_save(input(Some(id.clone()), 1, false)).unwrap();
    assert_eq!(
        db.ai_list().unwrap()["configs"][0]["credentialStatus"],
        "session"
    );
    drop(db);
    let mut db = Database::open(&temp.0).unwrap();
    assert_eq!(
        db.ai_list().unwrap()["configs"][0]["credentialStatus"],
        "unavailable"
    );
    db.ai_delete(DeleteConfig {
        config: ConfigVersion {
            id,
            expected_config_version: 2,
        },
        expected_default_database_version: 1,
    })
    .unwrap();
    let list = db.ai_list().unwrap();
    assert!(list["configs"].as_array().unwrap().is_empty());
    assert_eq!(list["databaseVersion"], 2);
    assert!(list["defaultConfigId"].is_null());
}
#[test]
fn failed_commit_compensates_and_failed_cleanup_is_retryable() {
    let temp = TempDirectory::new();
    let mut db = Database::open(&temp.0).unwrap();
    let vault = Arc::new(Mutex::new(VaultData::default()));
    db.credentials.system = Box::new(TestVault(vault.clone()));
    let id = db.ai_save(input(None, 0, true)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    db.connection.execute_batch("CREATE TRIGGER fail_ai_update BEFORE UPDATE ON ai_model_configs BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(db.ai_save(input(Some(id.clone()), 1, true)).is_err());
    assert_eq!(vault.lock().unwrap().values.len(), 1);
    assert_eq!(db.ai_list().unwrap()["configs"][0]["configVersion"], 1);
    db.connection
        .execute_batch("DROP TRIGGER fail_ai_update")
        .unwrap();
    vault.lock().unwrap().fail_set = true;
    assert_eq!(
        db.ai_save(input(Some(id.clone()), 1, true))
            .unwrap_err()
            .code,
        "CREDENTIAL_UNAVAILABLE"
    );
    vault.lock().unwrap().fail_set = false;
    vault.lock().unwrap().fail_remove = true;
    db.ai_save(input(Some(id.clone()), 1, true)).unwrap();
    assert_eq!(vault.lock().unwrap().values.len(), 2);
    assert_eq!(db.ai_list().unwrap()["cleanupPending"], true);
    vault.lock().unwrap().fail_remove = false;
    db.cleanup_credentials().unwrap();
    assert_eq!(vault.lock().unwrap().values.len(), 1);
    let mut change = input(Some(id), 2, true);
    change.credential = CredentialChange::Keep;
    change.config.base_url = "https://other.example.com/v1".into();
    assert_eq!(
        db.ai_save(change).unwrap_err().code,
        "CREDENTIAL_REPLACEMENT_REQUIRED"
    );
}

#[test]
fn ai_commands_use_the_real_permission_manifest() {
    let temp = TempDirectory::new();
    let app = crate::with_storage_commands(tauri::test::mock_builder())
        .manage(Storage::open(&temp.0).unwrap())
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let listed = super::ipc::ipc(&window, "ai_list_configs", json!({}));
    assert_eq!(listed["ok"], true);
    let saved = super::ipc::ipc(
        &window,
        "ai_save_config",
        json!({"input":{
            "id":null,"expectedConfigVersion":0,
            "config":{"name":"IPC","protocol":"openai-responses","baseUrl":"https://example.com/v1","modelId":"fixture","timeoutMs":30000,"maxOutputTokens":128},
            "credential":{"action":"replace","key":"synthetic-ipc-fixture","remember":false}
        }}),
    );
    assert_eq!(saved["ok"], true);
    let listed = super::ipc::ipc(&window, "ai_list_configs", json!({}));
    assert_eq!(listed["value"]["configs"][0]["credentialStatus"], "session");
    assert!(!listed.to_string().contains("synthetic-ipc-fixture"));
}
