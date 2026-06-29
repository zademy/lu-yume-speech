use crate::config::{KEYRING_SERVICE, KEYRING_USER};
use crate::error::Result;
use keyring::Entry;

fn entry() -> Result<Entry> {
    Ok(Entry::new(KEYRING_SERVICE, KEYRING_USER)?)
}

#[tauri::command]
pub fn api_key_has() -> bool {
    entry()
        .and_then(|e| e.get_password().map(|p| !p.is_empty()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn api_key_get() -> Option<String> {
    entry()
        .ok()?
        .get_password()
        .ok()
        .filter(|p| !p.is_empty())
}

#[tauri::command]
pub fn api_key_set(key: String) -> Result<()> {
    let e = entry()?;
    e.set_password(&key)?;
    Ok(())
}

#[tauri::command]
pub fn api_key_delete() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
