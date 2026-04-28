// NTLM Authentication for CredSSP/NLA (MS-NLMP)
// Translated from electron/rdp/ntlm.ts

use crate::rdp::client::RdpError;
use hmac::{Hmac, Mac};
use md5::Md5;
use md4::Md4;
use rand::RngCore;

type HmacMd5 = Hmac<Md5>;

// NTLM negotiate flags (matching TS reference)
const NTLMSSP_NEGOTIATE_56:                      u32 = 0x80000000;
const NTLMSSP_NEGOTIATE_KEY_EXCH:               u32 = 0x40000000;
const NTLMSSP_NEGOTIATE_128:                    u32 = 0x20000000;
const NTLMSSP_NEGOTIATE_EXTENDED_SESSION_SEC:   u32 = 0x00080000;
const NTLMSSP_NEGOTIATE_ALWAYS_SIGN:            u32 = 0x00008000;
const NTLMSSP_NEGOTIATE_NTLM:                   u32 = 0x00000200;
const NTLMSSP_NEGOTIATE_SEAL:                   u32 = 0x00000020;
const NTLMSSP_NEGOTIATE_SIGN:                   u32 = 0x00000010;
const NTLMSSP_REQUEST_TARGET:                   u32 = 0x00000004;
const NTLMSSP_NEGOTIATE_UNICODE:                u32 = 0x00000001;

pub struct NtlmCredentials {
    pub username: String,
    pub password: String,
    pub domain: String,
}

pub struct NtlmAuth {
    credentials: NtlmCredentials,
    negotiate_flags: u32,
    server_challenge: Option<Vec<u8>>,
    exported_session_key: Option<Vec<u8>>,
    client_signing_key: Option<Vec<u8>>,
    client_sealing_key: Option<Vec<u8>>,
    seq_num: u32,
    negotiate_message_bytes: Option<Vec<u8>>,
    challenge_message_bytes: Option<Vec<u8>>,
    // RC4 state stored as key+offset since rc4 crate doesn't impl Clone
    seal_key: Option<Vec<u8>>,
    seal_offset: usize,
    seal_buf: Vec<u8>,
}

impl NtlmAuth {
    pub fn new(credentials: NtlmCredentials) -> Self {
        let negotiate_flags =
            NTLMSSP_NEGOTIATE_56
            | NTLMSSP_NEGOTIATE_KEY_EXCH
            | NTLMSSP_NEGOTIATE_128
            | NTLMSSP_NEGOTIATE_EXTENDED_SESSION_SEC
            | NTLMSSP_NEGOTIATE_ALWAYS_SIGN
            | NTLMSSP_NEGOTIATE_NTLM
            | NTLMSSP_NEGOTIATE_SEAL
            | NTLMSSP_NEGOTIATE_SIGN
            | NTLMSSP_REQUEST_TARGET
            | NTLMSSP_NEGOTIATE_UNICODE;
        Self {
            credentials,
            negotiate_flags,
            server_challenge: None,
            exported_session_key: None,
            client_signing_key: None,
            client_sealing_key: None,
            seq_num: 0,
            negotiate_message_bytes: None,
            challenge_message_bytes: None,
            seal_key: None,
            seal_offset: 0,
            seal_buf: Vec::new(),
        }
    }

    /// Create NTLM Negotiate message (Type 1)
    pub fn create_negotiate_message(&mut self) -> Vec<u8> {
        let mut w = Vec::with_capacity(40);
        w.extend_from_slice(b"NTLMSSP\0");           // Signature
        w.extend_from_slice(&1u32.to_le_bytes());    // MessageType = NEGOTIATE
        w.extend_from_slice(&self.negotiate_flags.to_le_bytes());
        // DomainNameFields (empty)
        w.extend_from_slice(&0u16.to_le_bytes());
        w.extend_from_slice(&0u16.to_le_bytes());
        w.extend_from_slice(&0u32.to_le_bytes());
        // WorkstationFields (empty)
        w.extend_from_slice(&0u16.to_le_bytes());
        w.extend_from_slice(&0u16.to_le_bytes());
        w.extend_from_slice(&0u32.to_le_bytes());
        // Version: Win10 10.0.19041, NTLMRevisionCurrent=15
        w.push(10); w.push(0);
        w.extend_from_slice(&19041u16.to_le_bytes());
        w.extend_from_slice(&[0u8; 3]);
        w.push(15);
        self.negotiate_message_bytes = Some(w.clone());
        w
    }

    /// Parse NTLM Challenge message (Type 2), returns parsed challenge data
    pub fn parse_challenge_message(&mut self, data: &[u8]) -> Result<NtlmChallengeData, RdpError> {
        if data.len() < 32 || &data[0..8] != b"NTLMSSP\0" {
            return Err(RdpError::Protocol("Invalid NTLM signature".into()));
        }
        let msg_type = u32::from_le_bytes(data[8..12].try_into().unwrap());
        if msg_type != 2 {
            return Err(RdpError::Protocol(format!("Expected NTLM Challenge, got type {}", msg_type)));
        }
        let target_name_len = u16::from_le_bytes(data[12..14].try_into().unwrap()) as usize;
        let _target_name_max = u16::from_le_bytes(data[14..16].try_into().unwrap());
        let target_name_offset = u32::from_le_bytes(data[16..20].try_into().unwrap()) as usize;
        let flags = u32::from_le_bytes(data[20..24].try_into().unwrap());
        let server_challenge = data[24..32].to_vec();

        // target info at offset 40
        let (target_info_len, target_info_offset) = if data.len() >= 48 {
            let tilen = u16::from_le_bytes(data[40..42].try_into().unwrap()) as usize;
            let _timax = u16::from_le_bytes(data[42..44].try_into().unwrap());
            let tioff = u32::from_le_bytes(data[44..48].try_into().unwrap()) as usize;
            (tilen, tioff)
        } else {
            (0, 0)
        };

        let target_name = if target_name_len > 0 && target_name_offset + target_name_len <= data.len() {
            decode_utf16le(&data[target_name_offset..target_name_offset + target_name_len])
        } else {
            String::new()
        };
        let target_info = if target_info_len > 0 && target_info_offset + target_info_len <= data.len() {
            data[target_info_offset..target_info_offset + target_info_len].to_vec()
        } else {
            Vec::new()
        };

        self.server_challenge = Some(server_challenge.clone());
        self.negotiate_flags = flags;
        self.challenge_message_bytes = Some(data.to_vec());

        Ok(NtlmChallengeData { flags, server_challenge, target_name, target_info })
    }

    /// Create NTLM Authenticate message (Type 3) with MIC
    pub fn create_authenticate_message(&mut self, challenge: &NtlmChallengeData) -> Result<Vec<u8>, RdpError> {
        let username = self.credentials.username.clone();
        let password = self.credentials.password.clone();
        let domain = self.credentials.domain.clone();

        let (server_timestamp, modified_target_info) = process_target_info(&challenge.target_info);
        let client_challenge = random_bytes(8);
        let timestamp = server_timestamp.unwrap_or_else(file_time);

        let ntlm_v2_hash = ntlm_v2_hash(&password, &username, &domain);
        let temp = build_temp(&client_challenge, &timestamp, &modified_target_info);
        let nt_proof_str = hmac_md5(&ntlm_v2_hash, &[&challenge.server_challenge, temp.as_slice()]);
        let nt_challenge_response = [nt_proof_str.as_slice(), temp.as_slice()].concat();

        let session_base_key = hmac_md5(&ntlm_v2_hash, &[nt_proof_str.as_slice()]);

        let exported_session_key = random_bytes(16);
        let encrypted_random_session_key = rc4_crypt(&session_base_key, &exported_session_key);
        self.exported_session_key = Some(exported_session_key.clone());

        let domain_buf = encode_utf16le(&domain);
        let user_buf = encode_utf16le(&username);
        let workstation_buf = encode_utf16le("RDPEA");
        let lm_response = vec![0u8; 24];

        let mic_offset: usize = 72;
        let header_len: usize = 88;
        let mut offset = header_len;
        let domain_offset = offset; offset += domain_buf.len();
        let user_offset = offset; offset += user_buf.len();
        let workstation_offset = offset; offset += workstation_buf.len();
        let lm_offset = offset; offset += lm_response.len();
        let nt_offset = offset; offset += nt_challenge_response.len();
        let ek_offset = offset; offset += encrypted_random_session_key.len();

        let mut w = Vec::with_capacity(offset);
        w.extend_from_slice(b"NTLMSSP\0");
        w.extend_from_slice(&3u32.to_le_bytes()); // AUTHENTICATE

        // LmChallengeResponseFields
        write_fields(&mut w, lm_response.len(), lm_offset);
        // NtChallengeResponseFields
        write_fields(&mut w, nt_challenge_response.len(), nt_offset);
        // DomainNameFields
        write_fields(&mut w, domain_buf.len(), domain_offset);
        // UserNameFields
        write_fields(&mut w, user_buf.len(), user_offset);
        // WorkstationFields
        write_fields(&mut w, workstation_buf.len(), workstation_offset);
        // EncryptedRandomSessionKeyFields
        write_fields(&mut w, encrypted_random_session_key.len(), ek_offset);
        // NegotiateFlags
        w.extend_from_slice(&self.negotiate_flags.to_le_bytes());
        // Version
        w.push(10); w.push(0);
        w.extend_from_slice(&19041u16.to_le_bytes());
        w.extend_from_slice(&[0u8; 3]);
        w.push(15);
        // MIC placeholder (16 zero bytes at offset 72)
        w.extend_from_slice(&[0u8; 16]);
        // Payload
        w.extend_from_slice(&domain_buf);
        w.extend_from_slice(&user_buf);
        w.extend_from_slice(&workstation_buf);
        w.extend_from_slice(&lm_response);
        w.extend_from_slice(&nt_challenge_response);
        w.extend_from_slice(&encrypted_random_session_key);

        // Compute MIC = HMAC_MD5(ExportedSessionKey, Negotiate + Challenge + Authenticate)
        if let (Some(neg), Some(chal)) = (&self.negotiate_message_bytes, &self.challenge_message_bytes) {
            let mic = hmac_md5(&exported_session_key, &[neg.as_slice(), chal.as_slice(), w.as_slice()]);
            w[mic_offset..mic_offset + 16].copy_from_slice(&mic[..16]);
        }

        Ok(w)
    }

    pub fn get_exported_session_key(&self) -> Result<&[u8], RdpError> {
        self.exported_session_key.as_deref()
            .ok_or_else(|| RdpError::Protocol("Session key not yet established".into()))
    }

    /// Initialize NTLM sealing keys and RC4 state for EncryptMessage
    pub fn initialize_sealing(&mut self) -> Result<(), RdpError> {
        let esk = self.exported_session_key.as_ref()
            .ok_or_else(|| RdpError::Protocol("Session key not established".into()))?;

        let signing_key = {
            use md5::Digest as _;
            let mut h = Md5::new();
            md5::Digest::update(&mut h, esk);
            md5::Digest::update(&mut h, b"session key to client-to-server signing key magic constant\0");
            md5::Digest::finalize(h).to_vec()
        };
        let sealing_key = {
            use md5::Digest as _;
            let mut h = Md5::new();
            md5::Digest::update(&mut h, esk);
            md5::Digest::update(&mut h, b"session key to client-to-server sealing key magic constant\0");
            md5::Digest::finalize(h).to_vec()
        };

        self.client_signing_key = Some(signing_key);
        self.seal_key = Some(sealing_key.clone());
        self.client_sealing_key = Some(sealing_key);
        self.seal_offset = 0;
        self.seal_buf = vec![0u8; 4096];
        self.seq_num = 0;
        Ok(())
    }

    /// NTLM SealMessage — encrypt + MAC (MS-NLMP 3.4.4)
    pub fn seal_message(&mut self, message: &[u8]) -> Result<Vec<u8>, RdpError> {
        let seal_key = self.seal_key.as_ref()
            .ok_or_else(|| RdpError::Protocol("Sealing not initialized".into()))?
            .clone();
        let signing_key = self.client_signing_key.as_ref()
            .ok_or_else(|| RdpError::Protocol("Signing key not initialized".into()))?
            .clone();

        let encrypted = rc4_stream_encrypt(&seal_key, self.seal_offset, message);
        self.seal_offset += message.len();

        let seq_buf = self.seq_num.to_le_bytes();
        let hmac = hmac_md5(&signing_key, &[&seq_buf, message]);
        let mut checksum = hmac[..8].to_vec();

        if self.negotiate_flags & NTLMSSP_NEGOTIATE_KEY_EXCH != 0 {
            checksum = rc4_stream_encrypt(&seal_key, self.seal_offset, &checksum);
            self.seal_offset += checksum.len();
        }

        let mut signature = vec![0u8; 16];
        signature[0..4].copy_from_slice(&1u32.to_le_bytes()); // Version
        signature[4..12].copy_from_slice(&checksum[..8]);
        signature[12..16].copy_from_slice(&seq_buf);
        self.seq_num += 1;

        Ok([signature, encrypted].concat())
    }
}

pub struct NtlmChallengeData {
    pub flags: u32,
    pub server_challenge: Vec<u8>,
    pub target_name: String,
    pub target_info: Vec<u8>,
}

// ===== CredSSP / TSRequest ASN.1 helpers =====
// Translated from electron/rdp/ntlm.ts buildTsRequest / parseTsRequest

pub fn build_ts_request(
    version: u8,
    nego_token: Option<&[u8]>,
    auth_info: Option<&[u8]>,
    pub_key_auth: Option<&[u8]>,
    client_nonce: Option<&[u8]>,
) -> Vec<u8> {
    let mut fields: Vec<Vec<u8>> = Vec::new();

    // [0] version
    fields.push(asn1_constructed(0xA0, &asn1_integer(version as u32)));

    // [1] negoTokens
    if let Some(token) = nego_token {
        let inner = asn1_sequence(&[asn1_constructed(0xA0, &asn1_octet_string(token))]);
        let nego_tokens = asn1_constructed(0xA1, &asn1_sequence(&[inner]));
        fields.push(nego_tokens);
    }

    // [2] authInfo
    if let Some(ai) = auth_info {
        fields.push(asn1_constructed(0xA2, &asn1_octet_string(ai)));
    }

    // [3] pubKeyAuth
    if let Some(pka) = pub_key_auth {
        fields.push(asn1_constructed(0xA3, &asn1_octet_string(pka)));
    }

    // [5] clientNonce (CredSSP v5+)
    if let Some(cn) = client_nonce {
        fields.push(asn1_constructed(0xA5, &asn1_octet_string(cn)));
    }

    let parts: Vec<&[u8]> = fields.iter().map(|v| v.as_slice()).collect();
    asn1_sequence(&parts)
}

pub struct TsResponse {
    pub version: u8,
    pub nego_token: Option<Vec<u8>>,
    pub pub_key_auth: Option<Vec<u8>>,
    pub error_code: Option<u32>,
}

pub fn parse_ts_request(data: &[u8]) -> Result<TsResponse, RdpError> {
    if data.is_empty() || data[0] != 0x30 {
        return Err(RdpError::Protocol("TSRequest: expected SEQUENCE (0x30)".into()));
    }
    let (seq_len, header_len) = ber_length(&data[1..])?;
    let mut pos = 1 + header_len;
    let end = pos + seq_len;

    let mut version = 0u8;
    let mut nego_token = None;
    let mut pub_key_auth = None;
    let mut error_code = None;

    while pos < end && pos < data.len() {
        let tag = data[pos];
        pos += 1;
        let (flen, fhdr) = ber_length(&data[pos..])?;
        pos += fhdr;
        let field = &data[pos..pos + flen];
        pos += flen;

        match tag & 0x1F {
            0 => {
                // version INTEGER
                if field.len() >= 3 && field[0] == 0x02 {
                    version = field[2];
                }
            }
            1 => {
                // negoTokens
                nego_token = Some(extract_nego_token(field)?);
            }
            3 => {
                // pubKeyAuth OCTET STRING
                if field.len() >= 2 && field[0] == 0x04 {
                    let (plen, phdr) = ber_length(&field[1..])?;
                    pub_key_auth = Some(field[1 + phdr..1 + phdr + plen].to_vec());
                }
            }
            4 => {
                // errorCode INTEGER
                if field.len() >= 2 && field[0] == 0x02 {
                    let (elen, ehdr) = ber_length(&field[1..])?;
                    let ev = &field[1 + ehdr..1 + ehdr + elen];
                    let code = match elen {
                        1 => ev[0] as u32,
                        2 => u16::from_be_bytes([ev[0], ev[1]]) as u32,
                        4 => u32::from_be_bytes([ev[0], ev[1], ev[2], ev[3]]),
                        _ => 0,
                    };
                    error_code = Some(code);
                }
            }
            _ => {}
        }
    }

    Ok(TsResponse { version, nego_token, pub_key_auth, error_code })
}

pub fn build_ts_credentials(domain: &str, username: &str, password: &str) -> Vec<u8> {
    let dom_buf = encode_utf16le(domain);
    let user_buf = encode_utf16le(username);
    let pass_buf = encode_utf16le(password);

    let pwd_creds = asn1_sequence(&[
        asn1_constructed(0xA0, &asn1_octet_string(&dom_buf)),
        asn1_constructed(0xA1, &asn1_octet_string(&user_buf)),
        asn1_constructed(0xA2, &asn1_octet_string(&pass_buf)),
    ]);

    asn1_sequence(&[
        asn1_constructed(0xA0, &asn1_integer(1)),
        asn1_constructed(0xA1, &asn1_octet_string(&pwd_creds)),
    ])
}

fn extract_nego_token(data: &[u8]) -> Result<Vec<u8>, RdpError> {
    let mut pos = 0;
    // SEQUENCE OF
    if data[pos] != 0x30 { return Err(RdpError::Protocol("Expected SEQUENCE OF".into())); }
    pos += 1;
    let (l, h) = ber_length(&data[pos..])?; pos += h;
    // SEQUENCE
    if data[pos] != 0x30 { return Err(RdpError::Protocol("Expected inner SEQUENCE".into())); }
    pos += 1;
    let (l2, h2) = ber_length(&data[pos..])?; pos += h2;
    // [0]
    pos += 1;
    let (_, h3) = ber_length(&data[pos..])?; pos += h3;
    // OCTET STRING
    if data[pos] != 0x04 { return Err(RdpError::Protocol("Expected OCTET STRING".into())); }
    pos += 1;
    let (olen, ohdr) = ber_length(&data[pos..])?; pos += ohdr;
    Ok(data[pos..pos + olen].to_vec())
}

// ===== ASN.1 DER helpers =====

pub fn asn1_length(length: usize) -> Vec<u8> {
    if length < 0x80 {
        vec![length as u8]
    } else if length < 0x100 {
        vec![0x81, length as u8]
    } else {
        let mut v = vec![0x82];
        v.extend_from_slice(&(length as u16).to_be_bytes());
        v
    }
}

pub fn asn1_constructed(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut v = vec![tag];
    v.extend(asn1_length(content.len()));
    v.extend_from_slice(content);
    v
}

pub fn asn1_sequence(items: &[impl AsRef<[u8]>]) -> Vec<u8> {
    let content: Vec<u8> = items.iter().flat_map(|i| i.as_ref().iter().copied()).collect();
    let mut v = vec![0x30];
    v.extend(asn1_length(content.len()));
    v.extend(content);
    v
}

pub fn asn1_octet_string(data: &[u8]) -> Vec<u8> {
    let mut v = vec![0x04];
    v.extend(asn1_length(data.len()));
    v.extend_from_slice(data);
    v
}

pub fn asn1_integer(value: u32) -> Vec<u8> {
    if value < 0x80 {
        vec![0x02, 0x01, value as u8]
    } else if value < 0x8000 {
        let mut v = vec![0x02, 0x02];
        v.extend_from_slice(&(value as u16).to_be_bytes());
        v
    } else {
        let mut v = vec![0x02, 0x04];
        v.extend_from_slice(&value.to_be_bytes());
        v
    }
}

fn ber_length(data: &[u8]) -> Result<(usize, usize), RdpError> {
    if data.is_empty() {
        return Err(RdpError::Protocol("BER length: empty".into()));
    }
    let b = data[0];
    if b < 0x80 {
        Ok((b as usize, 1))
    } else if b == 0x81 {
        if data.len() < 2 { return Err(RdpError::Protocol("BER length: short".into())); }
        Ok((data[1] as usize, 2))
    } else if b == 0x82 {
        if data.len() < 3 { return Err(RdpError::Protocol("BER length: short".into())); }
        Ok((u16::from_be_bytes([data[1], data[2]]) as usize, 3))
    } else {
        Err(RdpError::Protocol(format!("BER length: unsupported 0x{:02X}", b)))
    }
}

// ===== Crypto helpers =====

fn hmac_md5(key: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let mut mac = HmacMd5::new_from_slice(key).expect("HMAC-MD5 key error");
    for part in parts {
        mac.update(part);
    }
    mac.finalize().into_bytes().to_vec()
}

fn ntlm_v2_hash(password: &str, username: &str, domain: &str) -> Vec<u8> {
    let nt_hash = {
        use md4::Digest as _;
        Md4::digest(&encode_utf16le(password)).to_vec()
    };
    let identity = encode_utf16le(&(username.to_uppercase() + domain));
    hmac_md5(&nt_hash, &[&identity])
}

fn build_temp(client_challenge: &[u8], timestamp: &[u8], target_info: &[u8]) -> Vec<u8> {
    let mut w = Vec::new();
    w.push(1u8);  // RespType
    w.push(1u8);  // HiRespType
    w.extend_from_slice(&0u16.to_le_bytes()); // Reserved1
    w.extend_from_slice(&0u32.to_le_bytes()); // Reserved2
    w.extend_from_slice(timestamp);
    w.extend_from_slice(client_challenge);
    w.extend_from_slice(&0u32.to_le_bytes()); // Reserved3
    w.extend_from_slice(target_info);
    w.extend_from_slice(&0u32.to_le_bytes()); // Reserved4
    w
}

fn file_time() -> Vec<u8> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let ft = (ms + 11644473600000) * 10000;
    ft.to_le_bytes().to_vec()
}

fn rc4_crypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    let (s, mut i, mut j) = rc4_init(key);
    rc4_process(&s, &mut i, &mut j, data)
}

fn rc4_stream_encrypt(key: &[u8], offset: usize, data: &[u8]) -> Vec<u8> {
    // Advance RC4 state by offset bytes, then encrypt data
    let (mut s, mut i, mut j) = rc4_init(key);
    rc4_skip(&mut s, &mut i, &mut j, offset);
    rc4_process(&s, &mut i, &mut j, data)
}

fn rc4_init(key: &[u8]) -> ([u8; 256], u8, u8) {
    let mut s = [0u8; 256];
    for (i, v) in s.iter_mut().enumerate() { *v = i as u8; }
    let mut j: u8 = 0;
    for i in 0..256usize {
        j = j.wrapping_add(s[i]).wrapping_add(key[i % key.len()]);
        s.swap(i, j as usize);
    }
    (s, 0, 0)
}

fn rc4_skip(s: &mut [u8; 256], i: &mut u8, j: &mut u8, n: usize) {
    for _ in 0..n {
        *i = i.wrapping_add(1);
        *j = j.wrapping_add(s[*i as usize]);
        s.swap(*i as usize, *j as usize);
    }
}

fn rc4_process(s: &[u8; 256], i: &mut u8, j: &mut u8, data: &[u8]) -> Vec<u8> {
    let mut s = *s;
    let mut out = Vec::with_capacity(data.len());
    for &b in data {
        *i = i.wrapping_add(1);
        *j = j.wrapping_add(s[*i as usize]);
        s.swap(*i as usize, *j as usize);
        let k = s[(s[*i as usize].wrapping_add(s[*j as usize])) as usize];
        out.push(b ^ k);
    }
    out
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

fn encode_utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|c| c.to_le_bytes()).collect()
}

fn decode_utf16le(bytes: &[u8]) -> String {
    let words: Vec<u16> = bytes.chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&words).to_string()
}

fn write_fields(w: &mut Vec<u8>, len: usize, offset: usize) {
    w.extend_from_slice(&(len as u16).to_le_bytes()); // Len
    w.extend_from_slice(&(len as u16).to_le_bytes()); // MaxLen
    w.extend_from_slice(&(offset as u32).to_le_bytes()); // Offset
}

fn process_target_info(target_info: &[u8]) -> (Option<Vec<u8>>, Vec<u8>) {
    let mut timestamp: Option<Vec<u8>> = None;
    let mut has_flags = false;
    let mut eol_pos = target_info.len();

    let mut pos = 0;
    while pos + 4 <= target_info.len() {
        let av_id = u16::from_le_bytes([target_info[pos], target_info[pos + 1]]);
        let av_len = u16::from_le_bytes([target_info[pos + 2], target_info[pos + 3]]) as usize;
        if av_id == 0x0000 { eol_pos = pos; break; }
        if av_id == 0x0007 && av_len == 8 {
            timestamp = Some(target_info[pos + 4..pos + 4 + 8].to_vec());
        }
        if av_id == 0x0006 { has_flags = true; }
        pos += 4 + av_len;
    }

    if timestamp.is_none() {
        return (None, target_info.to_vec());
    }

    if has_flags {
        let mut modified = target_info.to_vec();
        let mut p = 0;
        while p + 4 <= modified.len() {
            let id = u16::from_le_bytes([modified[p], modified[p + 1]]);
            let len = u16::from_le_bytes([modified[p + 2], modified[p + 3]]) as usize;
            if id == 0x0000 { break; }
            if id == 0x0006 && len == 4 {
                let existing = u32::from_le_bytes(modified[p + 4..p + 8].try_into().unwrap());
                let new_val = (existing | 0x00000002).to_le_bytes();
                modified[p + 4..p + 8].copy_from_slice(&new_val);
                return (timestamp, modified);
            }
            p += 4 + len;
        }
        (timestamp, modified)
    } else {
        // Insert MsvAvFlags before MsvAvEOL
        let mut flags_pair = vec![0u8; 8];
        flags_pair[0..2].copy_from_slice(&0x0006u16.to_le_bytes()); // AvId = MsvAvFlags
        flags_pair[2..4].copy_from_slice(&0x0004u16.to_le_bytes()); // AvLen = 4
        flags_pair[4..8].copy_from_slice(&0x00000002u32.to_le_bytes()); // MIC_PROVIDED
        let mut modified = Vec::new();
        modified.extend_from_slice(&target_info[..eol_pos]);
        modified.extend_from_slice(&flags_pair);
        modified.extend_from_slice(&target_info[eol_pos..]);
        (timestamp, modified)
    }
}
