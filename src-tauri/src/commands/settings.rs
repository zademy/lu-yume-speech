use crate::config::settings_path;
use crate::error::Result;
use serde_json::Value;

#[tauri::command]
pub fn settings_load() -> Result<Option<Value>> {
    let path = settings_path();
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path)?;
    let v: Value = serde_json::from_str(&raw)?;
    Ok(Some(v))
}

#[tauri::command]
pub fn settings_save(value: Value) -> Result<()> {
    let path = settings_path();
    let s = serde_json::to_string_pretty(&value)?;
    std::fs::write(path, s)?;
    Ok(())
}
