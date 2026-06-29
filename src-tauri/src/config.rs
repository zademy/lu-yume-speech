use std::path::PathBuf;

pub fn app_config_dir() -> PathBuf {
    let mut p = dirs::config_dir().expect("no config dir on this platform");
    p.push("lu-yume");
    std::fs::create_dir_all(&p).ok();
    p
}

pub fn settings_path() -> PathBuf {
    app_config_dir().join("settings.json")
}

pub const KEYRING_SERVICE: &str = "lu-yume";
pub const KEYRING_USER: &str = "groq-api-key";
