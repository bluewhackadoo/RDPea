// Encrypted connection storage — AES-256-GCM with machine-derived key
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Encryption error: {0}")]
    Encryption(String),
    #[error("Decryption error: {0}")]
    Decryption(String),
}

#[derive(serde::Serialize, serde::Deserialize)]
struct EncryptedPayload {
    iv: String,
    encrypted: String,
    tag: String,
}

fn get_store_path() -> PathBuf {
    let data_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let app_dir = data_dir.join("com.rdpea.app");
    fs::create_dir_all(&app_dir).ok();
    app_dir.join("connections.enc")
}

fn get_derived_key() -> [u8; 32] {
    let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "rdpea".to_string());
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
    let machine_id = format!("{}-{}", computer, user);

    // scrypt-like key derivation using SHA-256 (matches the Node.js scryptSync behavior conceptually)
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    hasher.update(b"RDPea-salt-v1");
    // Iterate to strengthen
    let mut key = hasher.finalize().into();
    for _ in 0..10000 {
        let mut h = Sha256::new();
        h.update(&key);
        h.update(b"RDPea-salt-v1");
        key = h.finalize().into();
    }
    key
}

fn encrypt_data(data: &str) -> Result<String, StorageError> {
    let key = get_derived_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| StorageError::Encryption(e.to_string()))?;

    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    let ciphertext = cipher
        .encrypt(nonce, data.as_bytes())
        .map_err(|e| StorageError::Encryption(e.to_string()))?;

    // AES-GCM appends the 16-byte tag to the ciphertext
    let (encrypted, tag) = ciphertext.split_at(ciphertext.len() - 16);

    let payload = EncryptedPayload {
        iv: hex::encode(iv),
        encrypted: hex::encode(encrypted),
        tag: hex::encode(tag),
    };

    serde_json::to_string(&payload).map_err(StorageError::Json)
}

fn decrypt_data(payload_str: &str) -> Result<String, StorageError> {
    let payload: EncryptedPayload = serde_json::from_str(payload_str).map_err(StorageError::Json)?;

    let key = get_derived_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| StorageError::Decryption(e.to_string()))?;

    let iv = hex::decode(&payload.iv).map_err(|e| StorageError::Decryption(e.to_string()))?;
    let encrypted = hex::decode(&payload.encrypted).map_err(|e| StorageError::Decryption(e.to_string()))?;
    let tag = hex::decode(&payload.tag).map_err(|e| StorageError::Decryption(e.to_string()))?;

    let nonce = Nonce::from_slice(&iv);

    // Reconstruct ciphertext with tag appended
    let mut ciphertext_with_tag = encrypted;
    ciphertext_with_tag.extend_from_slice(&tag);

    let plaintext = cipher
        .decrypt(nonce, ciphertext_with_tag.as_ref())
        .map_err(|e| StorageError::Decryption(e.to_string()))?;

    String::from_utf8(plaintext).map_err(|e| StorageError::Decryption(e.to_string()))
}

pub fn load_connections() -> Result<serde_json::Value, StorageError> {
    let path = get_store_path();
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let raw = fs::read_to_string(&path)?;
    let decrypted = decrypt_data(&raw)?;
    let connections: serde_json::Value = serde_json::from_str(&decrypted)?;
    Ok(connections)
}

pub fn save_connections(connections: &serde_json::Value) -> Result<(), StorageError> {
    let json_str = serde_json::to_string(connections)?;
    let encrypted = encrypt_data(&json_str)?;
    let path = get_store_path();
    fs::write(&path, encrypted)?;
    Ok(())
}
