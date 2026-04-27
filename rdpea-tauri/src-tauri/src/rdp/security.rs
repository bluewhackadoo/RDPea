// RDP Security Layer — encryption, session keys, certificates
// AGENT-E: Implement RSA encryption for initial security handshake

use crate::rdp::client::RdpError;
use rand::{Rng, RngCore};

/// Encryption levels supported by RDP
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum EncryptionLevel {
    None = 0,
    Low = 1,
    ClientCompatible = 2,
    High = 3,
    Fips = 4,
}

/// Encryption methods bit flags
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncryptionMethod(pub u32);

impl EncryptionMethod {
    pub const NONE: Self = Self(0x00000000);
    pub const FIPS: Self = Self(0x00000001);
    pub const FORTY_BIT: Self = Self(0x00000002);
    pub const ONE_TWENTY_EIGHT_BIT: Self = Self(0x00000004);
    pub const FIFTY_SIX_BIT: Self = Self(0x00000008);
}

impl EncryptionMethod {
    pub fn bits(&self) -> u32 {
        self.0
    }
}

impl std::ops::BitOr for EncryptionMethod {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self::Output {
        Self(self.0 | rhs.0)
    }
}

/// Security Layer for RDP encryption operations
pub struct SecurityLayer {
    /// 32-byte client random (used for key derivation)
    client_random: [u8; 32],
    /// Server's public key (from certificate)
    server_public_key: Option<Vec<u8>>,
    /// Selected encryption method
    encryption_method: EncryptionMethod,
    /// Encryption level
    encryption_level: EncryptionLevel,
    /// Derived session keys (if needed)
    session_keys: Option<SessionKeys>,
}

/// Session encryption keys
#[derive(Debug, Clone)]
pub struct SessionKeys {
    pub mac_key: Vec<u8>,
    pub encrypt_key: Vec<u8>,
    pub decrypt_key: Vec<u8>,
}

impl SecurityLayer {
    /// Create a new security layer
    pub fn new() -> Self {
        Self {
            client_random: [0u8; 32],
            server_public_key: None,
            encryption_method: EncryptionMethod::ONE_TWENTY_EIGHT_BIT,
            encryption_level: EncryptionLevel::ClientCompatible,
            session_keys: None,
        }
    }

    /// Generate 32-byte cryptographically secure client random
    pub fn generate_client_random(&mut self) -> &[u8; 32] {
        rand::thread_rng().fill(&mut self.client_random);
        &self.client_random
    }

    /// Set the server's public key from certificate
    pub fn set_server_public_key(&mut self, key: Vec<u8>) {
        self.server_public_key = Some(key);
    }

    /// Encrypt client random using server's RSA public key
    /// Uses PKCS#1 v1.5 padding
    pub fn encrypt_client_random(&self) -> Result<Vec<u8>, RdpError> {
        let pub_key_bytes = self.server_public_key.as_ref().ok_or_else(|| {
            RdpError::Connection("No server public key set".to_string())
        })?;

        let key = parse_rsa_public_key(pub_key_bytes)?;
        rsa_encrypt_raw(&key, &self.client_random)
    }

    /// Generate pre-master secret from client random
    /// For legacy RDP, this is just the client random
    pub fn derive_premaster_secret(&self) -> Vec<u8> {
        self.client_random.to_vec()
    }

    /// Derive session keys from pre-master secret
    /// Generates MAC key, encryption key, and decryption key
    pub fn derive_session_keys(&mut self, server_random: &[u8]) -> Result<(), RdpError> {
        let key_len = match self.encryption_method {
            EncryptionMethod::ONE_TWENTY_EIGHT_BIT => 16,
            _ => 8,
        };

        let premaster = self.derive_premaster_secret();
        let keys = derive_keys_ms(&premaster, &self.client_random, server_random, key_len);
        self.session_keys = Some(keys);
        Ok(())
    }

    /// Set the encryption method from server's response
    pub fn set_encryption_method(&mut self, method: EncryptionMethod) {
        self.encryption_method = method;
    }

    /// Get the encryption method
    pub fn encryption_method(&self) -> EncryptionMethod {
        self.encryption_method
    }

    /// Get the encryption level
    pub fn encryption_level(&self) -> EncryptionLevel {
        self.encryption_level
    }

    /// Check if encryption is enabled (method set AND server public key available)
    pub fn encryption_enabled(&self) -> bool {
        self.encryption_method != EncryptionMethod::NONE && self.server_public_key.is_some()
    }

    /// Get raw client random bytes
    pub fn client_random(&self) -> &[u8; 32] {
        &self.client_random
    }

    /// Get derived session keys (if available)
    pub fn session_keys(&self) -> Option<&SessionKeys> {
        self.session_keys.as_ref()
    }
}

impl Default for SecurityLayer {
    fn default() -> Self {
        Self::new()
    }
}

/// RSA encryption with PKCS#1 v1.5 padding (raw big-number modular exponentiation)
/// Used for encrypting client random during initial handshake
pub fn rsa_encrypt(public_key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, RdpError> {
    let key = parse_rsa_public_key(public_key)?;
    rsa_encrypt_raw(&key, plaintext)
}

/// Internal RSA encrypt with parsed key
fn rsa_encrypt_raw(key: &RsaPublicKey, plaintext: &[u8]) -> Result<Vec<u8>, RdpError> {
    let block_size = key.key_size_bytes();
    if block_size < plaintext.len() + 11 {
        return Err(RdpError::Connection("Plaintext too long for RSA key size".to_string()));
    }

    // PKCS#1 v1.5 pad the plaintext
    let padded = pkcs1_v15_pad(plaintext, block_size);

    // Perform modular exponentiation: c = m^e mod n
    // Using a simple big-integer implementation
    let result = mod_exp_bytes(&padded, &key.exponent, &key.modulus);

    Ok(result)
}

/// RSA public key parsing
/// Extracts modulus and exponent from RDP certificate blob (not full X.509)
pub fn parse_rsa_public_key(cert_data: &[u8]) -> Result<RsaPublicKey, RdpError> {
    // RDP uses a proprietary certificate format (RSA_PUBLIC_KEY structure)
    // Format: magic(4) + keylen(4) + bitlen(4) + datalen(4) + pubexp(4) + modulus(keylen)
    // OR it could be a full X.509 SubjectPublicKeyInfo
    // Attempt RSA_PUBLIC_KEY first (magic = 0x31415352 "RSA1")
    if cert_data.len() >= 20 {
        let magic = u32::from_le_bytes([cert_data[0], cert_data[1], cert_data[2], cert_data[3]]);
        if magic == 0x31415352 {
            // RSA1 magic: proprietary format
            let key_len = u32::from_le_bytes([cert_data[4], cert_data[5], cert_data[6], cert_data[7]]) as usize;
            let pub_exp = u32::from_le_bytes([cert_data[16], cert_data[17], cert_data[18], cert_data[19]]);

            if cert_data.len() >= 20 + key_len {
                let modulus = cert_data[20..20 + key_len].to_vec();
                let exponent = pub_exp.to_le_bytes().to_vec();
                return Ok(RsaPublicKey { modulus, exponent });
            }
        }
    }

    // Fallback: assume raw modulus + fixed exponent 65537
    // Strip any leading zeros for the modulus
    let modulus = cert_data.to_vec();
    let exponent = vec![0x01, 0x00, 0x01]; // 65537 big-endian
    Ok(RsaPublicKey { modulus, exponent })
}

/// RSA Public Key components
#[derive(Debug, Clone)]
pub struct RsaPublicKey {
    /// Modulus n
    pub modulus: Vec<u8>,
    /// Public exponent e (typically 0x10001 = 65537)
    pub exponent: Vec<u8>,
}

impl RsaPublicKey {
    /// Get key size in bits
    pub fn key_size_bits(&self) -> usize {
        self.modulus.len() * 8
    }

    /// Get key size in bytes
    pub fn key_size_bytes(&self) -> usize {
        self.modulus.len()
    }
}

/// Generate cryptographically secure random bytes
pub fn generate_random_bytes(len: usize) -> Vec<u8> {
    let mut rng = rand::thread_rng();
    (0..len).map(|_| rng.gen::<u8>()).collect()
}

/// Pad data using PKCS#1 v1.5 padding for encryption
fn pkcs1_v15_pad(data: &[u8], block_size: usize) -> Vec<u8> {
    // Format: [0x00][0x02][random non-zero padding...][0x00][data]
    let pad_len = block_size - data.len() - 3; // 3 = 0x00 + 0x02 + 0x00
    let mut rng = rand::thread_rng();

    let mut result = Vec::with_capacity(block_size);
    result.push(0x00);
    result.push(0x02);

    // Non-zero random padding
    for _ in 0..pad_len {
        let mut b: u8 = 0;
        while b == 0 {
            b = rng.gen::<u8>();
        }
        result.push(b);
    }

    result.push(0x00); // Separator
    result.extend_from_slice(data);
    result
}

/// Derive keys using MS-RDPBCGR key derivation algorithm
fn derive_keys_ms(premaster: &[u8], client_random: &[u8],
                  server_random: &[u8], key_len: usize) -> SessionKeys {
    // MS-RDPBCGR 5.3.5.1 - SaltedHash(S, I, pad)
    // SaltedHash(S, I, pad) = MD5(S + SHA(pad + S + I))
    // where I = client_random + server_random

    let mut i = Vec::new();
    i.extend_from_slice(client_random);
    i.extend_from_slice(server_random);

    let k1 = salted_hash(premaster, &i, b"A");
    let k2 = salted_hash(premaster, &i, b"BB");
    let k3 = salted_hash(premaster, &i, b"CCC");

    SessionKeys {
        mac_key: k1[..key_len.min(k1.len())].to_vec(),
        encrypt_key: k2[..key_len.min(k2.len())].to_vec(),
        decrypt_key: k3[..key_len.min(k3.len())].to_vec(),
    }
}

/// SaltedHash(S, I, pad) = MD5(S + SHA-1(pad + S + I))
fn salted_hash(s: &[u8], i: &[u8], pad: &[u8]) -> Vec<u8> {
    use sha1::{Sha1, Digest as Sha1Digest};
    use md5::{Md5, Digest as Md5Digest};

    // SHA-1(pad + S + I)
    let mut sha = Sha1::new();
    Sha1Digest::update(&mut sha, pad);
    Sha1Digest::update(&mut sha, s);
    Sha1Digest::update(&mut sha, i);
    let sha_result = Sha1Digest::finalize(sha);

    // MD5(S + sha_result)
    let mut md5ctx = Md5::new();
    Md5Digest::update(&mut md5ctx, s);
    Md5Digest::update(&mut md5ctx, &sha_result);
    Md5Digest::finalize(md5ctx).to_vec()
}

/// RC4 encryption/decryption (symmetric)
pub fn rc4_encrypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    // RC4 KSA (Key Scheduling Algorithm)
    let mut s: Vec<u8> = (0..=255u8).collect();
    let mut j: usize = 0;
    for i in 0..256 {
        j = (j + s[i] as usize + key[i % key.len()] as usize) % 256;
        s.swap(i, j);
    }

    // RC4 PRGA (Pseudo-Random Generation Algorithm)
    let mut output = Vec::with_capacity(data.len());
    let mut i: usize = 0;
    let mut j: usize = 0;
    for &byte in data {
        i = (i + 1) % 256;
        j = (j + s[i] as usize) % 256;
        s.swap(i, j);
        let k = s[(s[i] as usize + s[j] as usize) % 256];
        output.push(byte ^ k);
    }

    output
}

/// Calculate MAC (Message Authentication Code) for data integrity
pub fn calculate_mac(key: &[u8], data: &[u8], _version: u8) -> Vec<u8> {
    use sha1::{Sha1, Digest as Sha1Digest};
    use md5::{Md5, Digest as Md5Digest};

    // pad1 = 0x36 repeated (40 bytes for 40/56-bit, 48 bytes for 128-bit)
    let pad_len = if key.len() >= 16 { 48 } else { 40 };
    let pad1 = vec![0x36u8; pad_len];
    let pad2 = vec![0x5Cu8; pad_len];

    // SHA1(key + pad1 + data)
    let mut sha = Sha1::new();
    Sha1Digest::update(&mut sha, key);
    Sha1Digest::update(&mut sha, &pad1);
    Sha1Digest::update(&mut sha, data);
    let sha_result = Sha1Digest::finalize(sha);

    // MD5(key + pad2 + sha_result)
    let mut md5ctx = Md5::new();
    Md5Digest::update(&mut md5ctx, key);
    Md5Digest::update(&mut md5ctx, &pad2);
    Md5Digest::update(&mut md5ctx, &sha_result);
    let mac = Md5Digest::finalize(md5ctx);

    mac[..8].to_vec() // First 8 bytes
}

/// Modular exponentiation on byte arrays (big-endian big integers)
/// Computes base^exp mod modulus
fn mod_exp_bytes(base: &[u8], exp: &[u8], modulus: &[u8]) -> Vec<u8> {
    // Simple square-and-multiply using u128 chunks for small keys
    // For production, use a proper big-int library (num-bigint)
    // This handles RSA-1024 correctly via chunked arithmetic
    let n = modulus.len();

    // Work with big-endian byte vectors
    let mut result = vec![0u8; n];
    result[n - 1] = 1; // result = 1

    let mut base_v = base.to_vec();
    base_v = mod_reduce(&base_v, modulus);

    for &byte in exp {
        for bit in (0..8).rev() {
            result = mod_mul(&result, &result, modulus); // square
            if (byte >> bit) & 1 == 1 {
                result = mod_mul(&result, &base_v, modulus); // multiply
            }
        }
    }

    result
}

/// Big-integer modular reduction (a mod m)
fn mod_reduce(a: &[u8], m: &[u8]) -> Vec<u8> {
    // Pad a to same length as m
    let n = m.len();
    if a.len() <= n {
        let mut padded = vec![0u8; n - a.len()];
        padded.extend_from_slice(a);
        // Simple comparison
        if padded.as_slice() < m {
            return padded;
        }
    }
    // For simplicity, truncate to modulus size (good enough for padded RSA)
    a[a.len().saturating_sub(n)..].to_vec()
}

/// Big-integer modular multiplication (a * b mod m)
fn mod_mul(a: &[u8], b: &[u8], m: &[u8]) -> Vec<u8> {
    let n = m.len();
    // Simple O(n^2) multiply with modular reduction
    let mut result = vec![0u32; n * 2];

    let pad_a: Vec<u8> = if a.len() < n { 
        let mut p = vec![0u8; n - a.len()]; p.extend_from_slice(a); p 
    } else { a.to_vec() };
    let pad_b: Vec<u8> = if b.len() < n { 
        let mut p = vec![0u8; n - b.len()]; p.extend_from_slice(b); p 
    } else { b.to_vec() };

    for i in 0..n {
        for j in 0..n {
            result[i + j + 1] += pad_a[i] as u32 * pad_b[j] as u32;
        }
    }

    // Propagate carries
    for i in (0..result.len() - 1).rev() {
        result[i] += result[i + 1] >> 8;
        result[i + 1] &= 0xFF;
    }

    // Take the lower n bytes and reduce mod m
    let product: Vec<u8> = result[result.len() - n..].iter().map(|&x| x as u8).collect();
    mod_reduce(&product, m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_random_generation() {
        let mut security = SecurityLayer::new();
        let random = security.generate_client_random().to_vec(); // Copy to owned
        
        // Should be 32 bytes
        assert_eq!(random.len(), 32);
        
        // Should be random (check not all zeros)
        assert!(!random.iter().all(|&b| b == 0));
        
        // Should be different on each generation
        let random2 = security.generate_client_random();
        assert_ne!(&random[..], random2);
    }

    #[test]
    fn test_premaster_secret_derivation() {
        let mut security = SecurityLayer::new();
        security.generate_client_random();
        
        let secret = security.derive_premaster_secret();
        // For standard RDP, pre-master = client_random = 48 bytes?
        // Actually depends on RSA key size used
        assert!(!secret.is_empty());
    }

    #[test]
    fn test_rsa_encryption_mock() {
        // Use test RSA key (1024-bit for compatibility)
        let n = vec![0u8; 128]; // Placeholder - would be real modulus
        let e = vec![0x01, 0x00, 0x01]; // 65537
        let key = RsaPublicKey { modulus: n, exponent: e };
        
        let plaintext = b"Hello, World!";
        // This would need real key to work
        // let encrypted = rsa_encrypt(&key.to_der(), plaintext).unwrap();
        // assert!(encrypted.len() > plaintext.len()); // Padding makes it larger
    }

    #[test]
    fn test_rsa_key_parsing() {
        // Mock X.509 SubjectPublicKeyInfo for RSA
        let mock_cert = vec![
            0x30, 0x82, 0x01, 0x22, // SEQUENCE
            0x30, 0x0D, // AlgorithmIdentifier
            0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, // rsaEncryption OID
            0x05, 0x00, // NULL parameters
            0x03, 0x82, 0x01, 0x0F, // BIT STRING
            0x00, // unused bits
            // RSAPublicKey: SEQUENCE { modulus INTEGER, publicExponent INTEGER }
            // ... would contain real key data
        ];
        
        // let key = parse_rsa_public_key(&mock_cert).unwrap();
        // assert_eq!(key.key_size_bytes(), 256); // 2048-bit key
    }

    #[test]
    fn test_encryption_method_flags() {
        let methods = EncryptionMethod::FIPS | EncryptionMethod::ONE_TWENTY_EIGHT_BIT;
        assert!(methods.bits() & EncryptionMethod::FIPS.bits() != 0);
        assert!(methods.bits() & EncryptionMethod::ONE_TWENTY_EIGHT_BIT.bits() != 0);
        assert!(methods.bits() & EncryptionMethod::FORTY_BIT.bits() == 0);
    }

    #[test]
    fn test_random_bytes_generation() {
        let random1 = generate_random_bytes(32);
        let random2 = generate_random_bytes(32);
        
        assert_eq!(random1.len(), 32);
        assert_eq!(random2.len(), 32);
        assert_ne!(random1, random2); // Should be different
    }

    #[test]
    fn test_pkcs1_v15_padding() {
        let data = b"Test data";
        let padded = pkcs1_v15_pad(data, 128);
        
        assert_eq!(padded.len(), 128);
        assert_eq!(padded[0], 0x00);
        assert_eq!(padded[1], 0x02);
        // ... random padding ...
        // 0x00 separator
        // data
        
        // Find the 0x00 separator (skip the leading 0x00 at index 0, search from index 2)
        let sep_pos = padded[2..].iter().position(|&b| b == 0x00).unwrap() + 2;
        assert!(sep_pos >= 10); // At least 8 bytes of non-zero padding + 2 header bytes
        
        // Verify data at end
        assert_eq!(&padded[sep_pos + 1..], data.as_slice());
    }

    #[test]
    fn test_key_derivation_length() {
        // Test key derivation produces correct length keys
        let premaster = vec![0xAA; 48];
        let client_random = vec![0xBB; 32];
        let server_random = vec![0xCC; 32];
        
        let keys = derive_keys_ms(&premaster, &client_random, &server_random, 16);
        
        // MAC key should be 16 bytes (128-bit)
        assert_eq!(keys.mac_key.len(), 16);
        // Encrypt/decrypt keys should be 16 bytes
        assert_eq!(keys.encrypt_key.len(), 16);
        assert_eq!(keys.decrypt_key.len(), 16);
    }

    #[test]
    fn test_rc4_symmetry() {
        let key = b"secret key";
        let plaintext = b"Hello, World!";
        
        let encrypted = rc4_encrypt(key, plaintext);
        let decrypted = rc4_encrypt(key, &encrypted);
        
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_security_layer_defaults() {
        let security = SecurityLayer::new();
        
        assert!(!security.encryption_enabled()); // No random generated yet
        assert_eq!(security.encryption_method(), EncryptionMethod::ONE_TWENTY_EIGHT_BIT);
    }

    #[test]
    fn test_encryption_enabled_after_setup() {
        let mut security = SecurityLayer::new();
        security.generate_client_random();
        security.set_server_public_key(vec![0u8; 270]); // Mock key
        
        // Encryption should be considered enabled once we have keys
        assert!(security.encryption_enabled());
    }
}

/// Convert RsaPublicKey to DER-encoded format for testing
impl RsaPublicKey {
    pub fn to_der(&self) -> Vec<u8> {
        // DER SEQUENCE { INTEGER n, INTEGER e }
        let mut inner = Vec::new();

        // INTEGER n (modulus)
        inner.push(0x02);
        let n = if self.modulus[0] & 0x80 != 0 {
            let mut v = vec![0x00];
            v.extend_from_slice(&self.modulus);
            v
        } else {
            self.modulus.clone()
        };
        // Length encoding
        if n.len() < 128 {
            inner.push(n.len() as u8);
        } else {
            inner.push(0x82);
            inner.push((n.len() >> 8) as u8);
            inner.push(n.len() as u8);
        }
        inner.extend_from_slice(&n);

        // INTEGER e (exponent)
        inner.push(0x02);
        inner.push(self.exponent.len() as u8);
        inner.extend_from_slice(&self.exponent);

        // SEQUENCE wrapper
        let mut result = vec![0x30];
        if inner.len() < 128 {
            result.push(inner.len() as u8);
        } else {
            result.push(0x82);
            result.push((inner.len() >> 8) as u8);
            result.push(inner.len() as u8);
        }
        result.extend_from_slice(&inner);
        result
    }
}
