use std::collections::HashMap;
use zeroize::Zeroizing;

pub type Secret = Zeroizing<String>;
pub trait Vault: Send {
    fn get(&self, reference: &str) -> Result<Secret, ()>;
    fn set(&mut self, reference: &str, secret: &str) -> Result<(), ()>;
    fn remove(&mut self, reference: &str) -> Result<(), ()>;
}

pub struct SystemVault;
impl SystemVault {
    fn entry(reference: &str) -> Result<keyring::Entry, ()> {
        // Never let keyring's unsupported-platform mock pretend to persist.
        if !cfg!(any(target_os = "windows", target_os = "macos")) {
            return Err(());
        }
        keyring::Entry::new("io.github.freshapplejack.storyark.ai", reference).map_err(|_| ())
    }
}
impl Vault for SystemVault {
    fn get(&self, reference: &str) -> Result<Secret, ()> {
        Self::entry(reference)?
            .get_password()
            .map(Zeroizing::new)
            .map_err(|_| ())
    }
    fn set(&mut self, reference: &str, secret: &str) -> Result<(), ()> {
        Self::entry(reference)?.set_password(secret).map_err(|_| ())
    }
    fn remove(&mut self, reference: &str) -> Result<(), ()> {
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

pub struct Credentials {
    pub system: Box<dyn Vault>,
    session: HashMap<String, Secret>,
}
impl Default for Credentials {
    fn default() -> Self {
        Self {
            system: Box::new(SystemVault),
            session: HashMap::new(),
        }
    }
}
impl Credentials {
    pub fn get(&self, reference: &str, mode: &str) -> Result<Secret, ()> {
        if mode == "system" {
            self.system.get(reference)
        } else {
            self.session.get(reference).cloned().ok_or(())
        }
    }
    pub fn set(&mut self, reference: &str, mode: &str, secret: Secret) -> Result<(), ()> {
        if mode == "system" {
            self.system.set(reference, &secret)
        } else {
            self.session.insert(reference.into(), secret);
            Ok(())
        }
    }
    pub fn remove(&mut self, reference: &str, mode: &str) -> Result<(), ()> {
        if mode == "system" {
            self.system.remove(reference)
        } else {
            self.session.remove(reference);
            Ok(())
        }
    }
}

pub fn normalize(value: String) -> Result<Secret, ()> {
    let original = Zeroizing::new(value);
    let trimmed = original.trim();
    if trimmed.is_empty() || trimmed.len() > 8192 || trimmed.chars().any(char::is_control) {
        return Err(());
    }
    Ok(Zeroizing::new(trimmed.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_without_a_vendor_prefix() {
        assert_eq!(
            normalize("  arbitrary-token  ".into()).unwrap().as_str(),
            "arbitrary-token"
        );
        assert!(normalize("embedded\ncontrol".into()).is_err());
        assert!(normalize("  ".into()).is_err());
    }

    #[test]
    #[ignore = "Writes an isolated synthetic credential to the native OS vault"]
    fn native_vault_survives_process_restart() {
        const VALUE: &str = "storyark-native-vault-synthetic-fixture";
        if let Ok(reference) = std::env::var("STORYARK_CREDENTIAL_TEST_REF") {
            assert!(SystemVault
                .get(&reference)
                .is_ok_and(|value| value.as_str() == VALUE));
            return;
        }
        let reference = uuid::Uuid::new_v4().to_string();
        let mut vault = SystemVault;
        assert!(vault.set(&reference, VALUE).is_ok());
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ai::credentials::tests::native_vault_survives_process_restart",
                "--ignored",
            ])
            .env("STORYARK_CREDENTIAL_TEST_REF", &reference)
            .status();
        let cleaned = vault.remove(&reference);
        assert!(cleaned.is_ok());
        assert!(result.unwrap().success());
    }
}
