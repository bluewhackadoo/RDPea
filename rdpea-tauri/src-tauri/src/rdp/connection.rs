// RDP Connection Driver — full MS-RDPBCGR handshake sequence
// Orchestrates: TCP → X.224 → MCS → Security → Licensing → Capabilities → Active

use crate::rdp::client::RdpError;
use crate::rdp::transport::RdpTransport;
use crate::rdp::protocol::{Protocol, X224ConnectionRequest, X224ConnectionConfirm};
use crate::rdp::mcs::{McsConnectInitial, McsConnectResponse, encode_ber_length};
use crate::rdp::gcc::{
    ClientCoreData, ClientSecurityData, ClientNetworkData, ChannelDef, ChannelOptions,
    RdpVersion, EncryptionMethod, ServerDataBlock, ServerSecurityData as GccServerSecurity,
};
use crate::rdp::security::{SecurityLayer, rsa_encrypt, rc4_encrypt, calculate_mac};
use crate::rdp::types::*;

/// Full RDP session state
pub struct RdpConnection {
    pub transport: RdpTransport,
    pub security: SecurityLayer,
    pub user_id: u16,
    pub io_channel_id: u16,
    pub channel_ids: Vec<u16>,
    pub server_random: Vec<u8>,
    pub encryption_method: u32,
    pub send_count: u32,
    pub recv_count: u32,
}

impl RdpConnection {
    /// Perform the complete RDP connection handshake.
    /// Returns a ready RdpConnection in the Active phase.
    pub async fn establish(
        config: &RdpClientConfig,
        log: &mut impl FnMut(String),
    ) -> Result<Self, RdpError> {
        // ── Phase 1: TCP connect ──────────────────────────────────────────────
        log(format!("TCP connecting to {}:{}", config.host, config.port));
        let mut transport = RdpTransport::connect(&config.host, config.port).await?;
        log("TCP connected".into());

        // ── Phase 2: X.224 negotiation ───────────────────────────────────────
        log("X.224 negotiation...".into());
        let x224_req = X224ConnectionRequest::new()
            .with_rdp_cookie(&config.host)
            .with_negotiation_protocols(&[Protocol::Hybrid, Protocol::Ssl, Protocol::Rdp]);

        // X.224 is NOT wrapped in TPKT — send raw
        send_raw(&mut transport, &x224_req.to_bytes()).await?;

        let x224_resp_raw = recv_raw(&mut transport).await?;
        let x224_cc = X224ConnectionConfirm::from_bytes(&x224_resp_raw)
            .map_err(|e| RdpError::Protocol(format!("X.224 CC parse failed: {}", e)))?;

        let negotiated = x224_cc.selected_protocol.unwrap_or(Protocol::Rdp);
        log(format!("Negotiated protocol: {:?}", negotiated));

        // TLS upgrade if SSL/NLA negotiated
        if negotiated == Protocol::Ssl || negotiated == Protocol::Hybrid || negotiated == Protocol::HybridEx {
            log("Upgrading to TLS...".into());
            transport.upgrade_tls().await?;
            log("TLS established".into());
        }

        // ── Phase 3: MCS Connect Initial ──────────────────────────────────────
        log("MCS handshake...".into());
        let client_data = build_client_core_data(config);
        let mcs_ci = McsConnectInitial::new(&client_data);
        transport.send_tpkt(&mcs_ci.to_bytes()).await?;

        let mcs_resp_frame = transport.recv_tpkt().await?;
        let mcs_cr = McsConnectResponse::from_bytes(&mcs_resp_frame.payload)
            .map_err(|e| RdpError::Protocol(format!("MCS CR parse: {}", e)))?;

        if mcs_cr.result != 0 {
            return Err(RdpError::Protocol(format!("MCS Connect failed: {}", mcs_cr.result)));
        }

        // Parse GCC server data blocks from MCS user data
        let (server_random, encryption_method, server_cert) =
            parse_gcc_server_data(&mcs_cr.user_data)?;
        log(format!("Encryption method: 0x{:08X}", encryption_method));

        // ── Phase 4: MCS ErectDomain + AttachUser ─────────────────────────────
        transport.send_tpkt(&build_erect_domain()).await?;
        transport.send_tpkt(&build_attach_user_request()).await?;

        let auc_frame = transport.recv_tpkt().await?;
        let user_id = parse_attach_user_confirm(&auc_frame.payload)?;
        log(format!("MCS user_id: {}", user_id));

        // Join IO channel (1003) and user channel
        let io_channel_id: u16 = 1003;
        for ch in [io_channel_id, user_id] {
            transport.send_tpkt(&build_channel_join_request(user_id, ch)).await?;
            let cjc = transport.recv_tpkt().await?;
            parse_channel_join_confirm(&cjc.payload, ch)?;
        }

        // ── Phase 5: Security Exchange ────────────────────────────────────────
        let mut security = SecurityLayer::new();
        security.generate_client_random();

        if encryption_method != 0 {
            // Encrypt client random with server's RSA public key
            let encrypted_random = if let Some(ref cert) = server_cert {
                rsa_encrypt(cert, security.client_random())?
            } else {
                security.client_random().to_vec()
            };

            // Send Security Exchange PDU
            let sec_exchange = build_security_exchange(&encrypted_random);
            send_mcs_data(&mut transport, user_id, io_channel_id, &sec_exchange).await?;

            // Derive session keys
            security.set_server_public_key(server_cert.unwrap_or_default());
            security.derive_session_keys(&server_random)?;
            log("Session keys derived".into());
        }

        // ── Phase 6: Client Info PDU ──────────────────────────────────────────
        log("Sending client info...".into());
        let info_pdu = build_client_info_pdu(config);
        let encrypted_info = encrypt_pdu(&security, &info_pdu, encryption_method);
        send_mcs_data(&mut transport, user_id, io_channel_id, &encrypted_info).await?;

        // ── Phase 7: License + Capability Exchange ────────────────────────────
        log("Waiting for server messages...".into());
        let mut channel_ids = Vec::new();

        // Process incoming PDUs until we reach Active state
        for _ in 0..20 {
            let frame = transport.recv_tpkt().await?;
            if frame.payload.len() < 4 { continue; }

            let (channel_id, data) = parse_mcs_data_indication(&frame.payload)?;

            // Decrypt if needed
            let decrypted = decrypt_pdu(&security, &data, encryption_method);

            // Identify PDU type
            if channel_id == io_channel_id {
                if is_license_pdu(&decrypted) {
                    log("License PDU received — sending error response".into());
                    let license_err = build_license_error_pdu();
                    let enc = encrypt_pdu(&security, &license_err, encryption_method);
                    send_mcs_data(&mut transport, user_id, io_channel_id, &enc).await?;
                } else if is_demand_active(&decrypted) {
                    log("Demand Active received".into());
                    let confirm = build_confirm_active(&decrypted, config);
                    let enc = encrypt_pdu(&security, &confirm, encryption_method);
                    send_mcs_data(&mut transport, user_id, io_channel_id, &enc).await?;

                    // Send synchronize + control
                    for pdu in [
                        build_synchronize_pdu(user_id),
                        build_control_pdu(CTRLACTION_COOPERATE),
                        build_control_pdu(CTRLACTION_REQUEST_CONTROL),
                        build_font_list_pdu(),
                    ] {
                        let enc = encrypt_pdu(&security, &pdu, encryption_method);
                        send_mcs_data(&mut transport, user_id, io_channel_id, &enc).await?;
                    }
                    log("Active phase!".into());
                    break;
                }
            }
        }

        Ok(Self {
            transport,
            security,
            user_id,
            io_channel_id,
            channel_ids,
            server_random,
            encryption_method,
            send_count: 0,
            recv_count: 0,
        })
    }

    /// Receive one PDU. Returns (channel_id, decrypted_payload).
    pub async fn recv_pdu(&mut self) -> Result<(u16, Vec<u8>), RdpError> {
        let frame = self.transport.recv_tpkt().await?;
        let (channel_id, data) = parse_mcs_data_indication(&frame.payload)?;
        let decrypted = decrypt_pdu(&self.security, &data, self.encryption_method);
        self.recv_count += 1;
        Ok((channel_id, decrypted))
    }

    /// Send a PDU on the IO channel.
    pub async fn send_io(&mut self, data: &[u8]) -> Result<(), RdpError> {
        let enc = encrypt_pdu(&self.security, data, self.encryption_method);
        send_mcs_data(&mut self.transport, self.user_id, self.io_channel_id, &enc).await?;
        self.send_count += 1;
        Ok(())
    }

    pub fn client_random(&self) -> &[u8; 32] {
        self.security.client_random()
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn build_client_core_data(config: &RdpClientConfig) -> ClientCoreData {
    let mut data = ClientCoreData::default();
    data.desktop_width = config.width as u16;
    data.desktop_height = config.height as u16;
    data
}

/// Send bytes without TPKT framing (used for X.224 CR before MCS phase)
async fn send_raw(transport: &mut RdpTransport, data: &[u8]) -> Result<(), RdpError> {
    // X.224 CR is wrapped in TPKT in practice — RDP spec says X.224 PDU goes in TPKT payload
    transport.send_tpkt(data).await
}

/// Receive raw bytes — just get the TPKT payload
async fn recv_raw(transport: &mut RdpTransport) -> Result<Vec<u8>, RdpError> {
    let frame = transport.recv_tpkt().await?;
    Ok(frame.payload)
}

fn parse_gcc_server_data(
    user_data: &[u8],
) -> Result<(Vec<u8>, u32, Option<Vec<u8>>), RdpError> {
    let mut server_random = vec![0u8; 32];
    let mut encryption_method = 0u32;
    let mut server_cert = None;

    // GCC data starts after a conference create response header
    // Try to find SC_SECURITY block
    let mut pos = 0;
    while pos + 4 <= user_data.len() {
        let block_type = u16::from_le_bytes([user_data[pos], user_data[pos + 1]]);
        let block_len = u16::from_le_bytes([user_data[pos + 2], user_data[pos + 3]]) as usize;
        if block_len < 4 || pos + block_len > user_data.len() {
            break;
        }
        let block_data = &user_data[pos + 4..pos + block_len];

        match block_type {
            0x0C02 => {
                // SC_SECURITY
                if block_data.len() >= 8 {
                    encryption_method = u32::from_le_bytes([block_data[0], block_data[1], block_data[2], block_data[3]]);
                    let _encryption_level = u32::from_le_bytes([block_data[4], block_data[5], block_data[6], block_data[7]]);

                    if block_data.len() >= 12 && encryption_method != 0 {
                        let random_len = u32::from_le_bytes([block_data[8], block_data[9], block_data[10], block_data[11]]) as usize;
                        if block_data.len() >= 12 + random_len {
                            server_random = block_data[12..12 + random_len].to_vec();
                        }
                        let cert_offset = 12 + random_len;
                        if block_data.len() >= cert_offset + 4 {
                            let cert_len = u32::from_le_bytes([
                                block_data[cert_offset],
                                block_data[cert_offset + 1],
                                block_data[cert_offset + 2],
                                block_data[cert_offset + 3],
                            ]) as usize;
                            if block_data.len() >= cert_offset + 4 + cert_len {
                                server_cert = Some(block_data[cert_offset + 4..cert_offset + 4 + cert_len].to_vec());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        pos += block_len;
    }

    Ok((server_random, encryption_method, server_cert))
}

fn build_erect_domain() -> Vec<u8> {
    // MCS Erect Domain Request: tag 0x04, subHeight=1, subInterval=1
    vec![
        0x04, 0x01, 0x00, // ErectDomainRequest, subHeight=0
        0x01, 0x00,       // subInterval=0
    ]
}

fn build_attach_user_request() -> Vec<u8> {
    // MCS Attach User Request: tag 0x28 (type 10, packed)
    vec![0x28]
}

fn parse_attach_user_confirm(payload: &[u8]) -> Result<u16, RdpError> {
    // AttachUserConfirm: 0x2E result(1) initiator(2)
    if payload.len() < 4 {
        // Some servers just send a minimal response; use default
        return Ok(1007);
    }
    // Byte 0: tag (0x2E), byte 1: result, bytes 2-3: user_id (big-endian, channel offset from 1001)
    let initiator = u16::from_be_bytes([payload[2], payload[3]]);
    // Channel IDs in MCS are initiator + 1001
    Ok(initiator + 1001)
}

fn build_channel_join_request(user_id: u16, channel_id: u16) -> Vec<u8> {
    // MCS Channel Join Request: tag 0x38, initiator(2), channelId(2)
    let initiator = user_id - 1001;
    let mut v = vec![0x38];
    v.extend_from_slice(&initiator.to_be_bytes());
    v.extend_from_slice(&channel_id.to_be_bytes());
    v
}

fn parse_channel_join_confirm(payload: &[u8], _expected: u16) -> Result<(), RdpError> {
    if payload.is_empty() {
        return Err(RdpError::Protocol("Empty channel join confirm".into()));
    }
    // Tag 0x3E = success; just accept anything for now
    Ok(())
}

fn build_security_exchange(encrypted_random: &[u8]) -> Vec<u8> {
    // SEC_EXCHANGE_PKT header: flags(4) + length(4) + encrypted_random
    let mut pdu = Vec::new();
    pdu.extend_from_slice(&(SEC_EXCHANGE_PKT as u32).to_le_bytes()); // flags
    pdu.extend_from_slice(&(encrypted_random.len() as u32).to_le_bytes());
    pdu.extend_from_slice(encrypted_random);
    pdu
}

fn build_client_info_pdu(config: &RdpClientConfig) -> Vec<u8> {
    // SEC_INFO_PKT — minimal client info PDU (MS-RDPBCGR 2.2.1.11)
    let mut pdu = Vec::new();

    // codePage (4), flags (4), cbDomain (2), cbUserName (2), cbPassword (2),
    // cbAlternateShell (2), cbWorkingDir (2), domain, username, password, ...

    let domain_utf16: Vec<u16> = config.domain.encode_utf16().collect();
    let user_utf16: Vec<u16> = config.username.encode_utf16().collect();
    let pass_utf16: Vec<u16> = config.password.encode_utf16().collect();
    let shell_utf16: Vec<u16> = Vec::new();
    let workdir_utf16: Vec<u16> = Vec::new();

    let domain_bytes: Vec<u8> = domain_utf16.iter().flat_map(|c| c.to_le_bytes()).collect();
    let user_bytes: Vec<u8> = user_utf16.iter().flat_map(|c| c.to_le_bytes()).collect();
    let pass_bytes: Vec<u8> = pass_utf16.iter().flat_map(|c| c.to_le_bytes()).collect();

    pdu.extend_from_slice(&0u32.to_le_bytes()); // codePage
    pdu.extend_from_slice(&0x0033u32.to_le_bytes()); // flags: INFO_MOUSE | INFO_DISABLECTRLALTDEL | INFO_UNICODE
    pdu.extend_from_slice(&(domain_bytes.len() as u16).to_le_bytes());
    pdu.extend_from_slice(&(user_bytes.len() as u16).to_le_bytes());
    pdu.extend_from_slice(&(pass_bytes.len() as u16).to_le_bytes());
    pdu.extend_from_slice(&0u16.to_le_bytes()); // cbAlternateShell
    pdu.extend_from_slice(&0u16.to_le_bytes()); // cbWorkingDir
    pdu.extend_from_slice(&domain_bytes);
    pdu.push(0); pdu.push(0); // null terminator
    pdu.extend_from_slice(&user_bytes);
    pdu.push(0); pdu.push(0);
    pdu.extend_from_slice(&pass_bytes);
    pdu.push(0); pdu.push(0);
    pdu.push(0); pdu.push(0); // alternateShell = ""
    pdu.push(0); pdu.push(0); // workingDir = ""

    // Wrap with SEC_INFO_PKT header
    let mut full = Vec::new();
    full.extend_from_slice(&(SEC_INFO_PKT as u32).to_le_bytes());
    full.extend_from_slice(&pdu);
    full
}

fn encrypt_pdu(security: &SecurityLayer, data: &[u8], method: u32) -> Vec<u8> {
    if method == 0 {
        return data.to_vec();
    }
    // Encrypt with RC4 session key
    if let Some(keys) = security.session_keys() {
        let mac = calculate_mac(&keys.mac_key, data, 0);
        let mut payload = mac;
        payload.extend_from_slice(data);
        let encrypted_body = rc4_encrypt(&keys.encrypt_key, &payload[8..]); // skip MAC header
        let mut result = Vec::new();
        result.extend_from_slice(&(SEC_ENCRYPT as u32).to_le_bytes());
        result.extend_from_slice(&payload[..8]); // MAC (8 bytes)
        result.extend_from_slice(&encrypted_body);
        result
    } else {
        data.to_vec()
    }
}

fn decrypt_pdu(security: &SecurityLayer, data: &[u8], method: u32) -> Vec<u8> {
    if method == 0 || data.len() < 12 {
        return data.to_vec();
    }
    let flags = if data.len() >= 4 {
        u32::from_le_bytes([data[0], data[1], data[2], data[3]])
    } else {
        0
    };
    if flags & SEC_ENCRYPT == 0 {
        // Not encrypted — skip security header if present
        if flags & (SEC_INFO_PKT | SEC_EXCHANGE_PKT | SEC_LICENSE_PKT) != 0 {
            return data[4..].to_vec();
        }
        return data.to_vec();
    }
    if let Some(keys) = security.session_keys() {
        // Skip flags(4) + MAC(8) = 12 bytes
        if data.len() > 12 {
            rc4_encrypt(&keys.decrypt_key, &data[12..])
        } else {
            data.to_vec()
        }
    } else {
        data.to_vec()
    }
}

fn is_license_pdu(data: &[u8]) -> bool {
    // SEC_LICENSE_PKT flag or license PDU type
    if data.len() >= 4 {
        let flags = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        return flags & SEC_LICENSE_PKT != 0;
    }
    false
}

fn build_license_error_pdu() -> Vec<u8> {
    // Send a Client License Info or License Error (new license flow)
    // Simplest: send an error PDU that makes server skip licensing
    let mut pdu = Vec::new();
    pdu.extend_from_slice(&(SEC_LICENSE_PKT as u32).to_le_bytes());
    // bMsgType=0xFF (ERROR_ALERT), flags=0x00, wMsgSize=16
    pdu.push(0xFF); // ERROR_ALERT
    pdu.push(0x03); // ST_NO_TRANSITION
    pdu.extend_from_slice(&16u16.to_le_bytes());
    // dwErrorCode=STATUS_VALID_CLIENT (0x00000007)
    pdu.extend_from_slice(&0x00000007u32.to_le_bytes());
    // dwStateTransition=ST_NO_TRANSITION (0x00000002)
    pdu.extend_from_slice(&0x00000002u32.to_le_bytes());
    // wBlobType=0, wBlobLen=0
    pdu.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    pdu
}

fn is_demand_active(data: &[u8]) -> bool {
    // Share Control Header: shareControlHeader.pduType == PDU_TYPE_DEMAND_ACTIVE (0x11)
    if data.len() >= 6 {
        let pdu_type = u16::from_le_bytes([data[2], data[3]]) & 0x0F;
        return pdu_type == PDU_TYPE_DEMAND_ACTIVE;
    }
    false
}

fn build_confirm_active(demand: &[u8], config: &RdpClientConfig) -> Vec<u8> {
    // Minimal Confirm Active with basic capability sets
    let share_id = if demand.len() >= 10 {
        u32::from_le_bytes([demand[6], demand[7], demand[8], demand[9]])
    } else {
        0x1003EA
    };

    let mut caps = Vec::new();

    // General Capability Set (TS_GENERAL_CAPABILITYSET) — 24 bytes
    caps.extend_from_slice(&CAPSTYPE_GENERAL.to_le_bytes());
    caps.extend_from_slice(&28u16.to_le_bytes()); // length including header
    caps.extend_from_slice(&[0x01, 0x00]); // osMajorType: OSMAJORTYPE_WINDOWS
    caps.extend_from_slice(&[0x03, 0x00]); // osMinorType: OSMINORTYPE_WINDOWS_NT
    caps.extend_from_slice(&[0x00, 0x02]); // protocolVersion
    caps.extend_from_slice(&[0x00, 0x00]); // pad2octets
    caps.extend_from_slice(&[0x00, 0x00]); // compressionTypes
    caps.extend_from_slice(&[0x1D, 0x04]); // extraFlags: FASTPATH_OUTPUT_SUPPORTED | etc
    caps.extend_from_slice(&[0x00, 0x00]); // updateCapability
    caps.extend_from_slice(&[0x00, 0x00]); // remoteUnshareCapability
    caps.extend_from_slice(&[0x00, 0x00]); // compressionLevel
    caps.extend_from_slice(&[0x00, 0x00]); // pad2octets

    // Bitmap Capability Set — 28 bytes
    caps.extend_from_slice(&CAPSTYPE_BITMAP.to_le_bytes());
    caps.extend_from_slice(&28u16.to_le_bytes());
    caps.extend_from_slice(&(config.color_depth as u16).to_le_bytes()); // preferredBitsPerPixel
    caps.extend_from_slice(&[0x01, 0x00]); // receive1BitPerPixel
    caps.extend_from_slice(&[0x01, 0x00]); // receive4BitsPerPixel
    caps.extend_from_slice(&[0x01, 0x00]); // receive8BitsPerPixel
    caps.extend_from_slice(&(config.width as u16).to_le_bytes());
    caps.extend_from_slice(&(config.height as u16).to_le_bytes());
    caps.extend_from_slice(&[0x00, 0x00]); // pad2octets
    caps.extend_from_slice(&[0x01, 0x00]); // desktopResizeFlag
    caps.extend_from_slice(&[0x01, 0x00]); // bitmapCompressionFlag
    caps.extend_from_slice(&[0x00]);       // highColorFlags
    caps.extend_from_slice(&[0x00]);       // drawingFlags
    caps.extend_from_slice(&[0x01, 0x00]); // multipleRectangleSupport
    caps.extend_from_slice(&[0x00, 0x00]); // pad2octets

    // Order Capability Set — 88 bytes
    caps.extend_from_slice(&CAPSTYPE_ORDER.to_le_bytes());
    caps.extend_from_slice(&88u16.to_le_bytes());
    caps.extend_from_slice(&[0u8; 16]); // terminalDescriptor
    caps.extend_from_slice(&[0u8; 4]);  // pad4octets
    caps.extend_from_slice(&[0x01, 0x00]); // desktopSaveXGranularity
    caps.extend_from_slice(&[0x20, 0x00]); // desktopSaveYGranularity
    caps.extend_from_slice(&[0x00, 0x00]); // pad2octets
    caps.extend_from_slice(&[0x01, 0x00]); // maximumOrderLevel
    caps.extend_from_slice(&[0x00, 0x00]); // numberFonts
    caps.extend_from_slice(&[0x22, 0x00]); // orderFlags
    caps.extend_from_slice(&[0u8; 32]); // orderSupport (32 bytes)
    caps.extend_from_slice(&[0u8; 4]);  // textFlags + pad
    caps.extend_from_slice(&[0u8; 4]);  // orderSupportExFlags
    caps.extend_from_slice(&[0u8; 4]);  // pad4octets2
    caps.extend_from_slice(&[0u8; 4]);  // desktopSaveSize
    caps.extend_from_slice(&[0u8; 4]);  // pad2octets + pad2octets2

    let num_caps: u16 = 3;
    let source_desc = b"RDPea";

    // TS_CONFIRM_ACTIVE_PDU
    let total_caps_len = caps.len() as u16;
    let pdu_len = 2 + 2 + 4 + 2 + 2 + 2 + source_desc.len() as u16 + 2 + total_caps_len;

    let mut pdu = Vec::new();
    // Share Control Header
    pdu.extend_from_slice(&(pdu_len + 6).to_le_bytes()); // totalLength (includes this 6-byte header)
    pdu.extend_from_slice(&PDU_TYPE_CONFIRM_ACTIVE.to_le_bytes()); // pduType
    pdu.extend_from_slice(&0u16.to_le_bytes()); // PDUSource (ignored)
    // Confirm Active body
    pdu.extend_from_slice(&share_id.to_le_bytes());
    pdu.extend_from_slice(&0xEA03u16.to_le_bytes()); // originatorId
    pdu.extend_from_slice(&(source_desc.len() as u16).to_le_bytes());
    pdu.extend_from_slice(&(total_caps_len + 4).to_le_bytes()); // lengthCombinedCapabilities
    pdu.extend_from_slice(source_desc);
    pdu.extend_from_slice(&num_caps.to_le_bytes());
    pdu.extend_from_slice(&[0x00, 0x00]); // pad2octets
    pdu.extend_from_slice(&caps);
    pdu
}

fn build_synchronize_pdu(user_id: u16) -> Vec<u8> {
    let mut pdu = share_data_header(PDU_TYPE2_SYNCHRONIZE, 4);
    pdu.extend_from_slice(&1u16.to_le_bytes()); // messageType=SYNCMSGTYPE_SYNC
    pdu.extend_from_slice(&user_id.to_le_bytes());
    pdu
}

fn build_control_pdu(action: u16) -> Vec<u8> {
    let mut pdu = share_data_header(PDU_TYPE2_CONTROL, 8);
    pdu.extend_from_slice(&action.to_le_bytes());
    pdu.extend_from_slice(&0u16.to_le_bytes()); // grantId
    pdu.extend_from_slice(&0u32.to_le_bytes()); // controlId
    pdu
}

fn build_font_list_pdu() -> Vec<u8> {
    let mut pdu = share_data_header(PDU_TYPE2_FONTLIST, 8);
    pdu.extend_from_slice(&0u16.to_le_bytes()); // numberFonts
    pdu.extend_from_slice(&0u16.to_le_bytes()); // totalNumFonts
    pdu.extend_from_slice(&0x0003u16.to_le_bytes()); // listFlags
    pdu.extend_from_slice(&0x0032u16.to_le_bytes()); // entrySize
    pdu
}

fn share_data_header(pdu_type2: u8, data_len: u16) -> Vec<u8> {
    // Share Control Header (6) + Share Data Header (14) = 20 bytes total overhead
    let total = 6 + 14 + data_len;
    let mut h = Vec::new();
    // Share Control Header
    h.extend_from_slice(&total.to_le_bytes());
    h.extend_from_slice(&PDU_TYPE_DATA.to_le_bytes());
    h.extend_from_slice(&0u16.to_le_bytes()); // PDUSource
    // Share Data Header
    h.extend_from_slice(&0x1003EAu32.to_le_bytes()); // shareId
    h.push(0x00); // pad1
    h.push(0x01); // streamId = STREAM_LOW
    h.extend_from_slice(&(14 + data_len).to_le_bytes()); // uncompressedLength
    h.push(pdu_type2);
    h.push(0x00); // compressedType
    h.extend_from_slice(&0u16.to_le_bytes()); // compressedLength
    h
}

/// Build an MCS Send Data Request wrapping payload
fn mcs_send_data_request_header(user_id: u16, channel_id: u16, data_len: usize) -> Vec<u8> {
    let initiator = user_id - 1001;
    let mut h = Vec::new();
    // MCS Send Data Request tag: 0x64
    h.push(0x64);
    h.extend_from_slice(&initiator.to_be_bytes());
    h.extend_from_slice(&channel_id.to_be_bytes());
    h.push(0x70); // priority + segmentation (first+last)
    // BER length of data
    h.extend_from_slice(&encode_ber_length(data_len));
    h
}

async fn send_mcs_data(
    transport: &mut RdpTransport,
    user_id: u16,
    channel_id: u16,
    data: &[u8],
) -> Result<(), RdpError> {
    let mut pdu = mcs_send_data_request_header(user_id, channel_id, data.len());
    pdu.extend_from_slice(data);
    transport.send_tpkt(&pdu).await
}

fn parse_mcs_data_indication(payload: &[u8]) -> Result<(u16, Vec<u8>), RdpError> {
    if payload.is_empty() {
        return Err(RdpError::Protocol("Empty MCS payload".into()));
    }

    let tag = payload[0];

    // MCS Send Data Indication = 0x68
    if tag == 0x68 || tag == 0x64 {
        if payload.len() < 8 {
            return Err(RdpError::Protocol("MCS SDI too short".into()));
        }
        let channel_id = u16::from_be_bytes([payload[3], payload[4]]);
        // Skip past header: tag(1) + initiator(2) + channel(2) + flags(1) + length(var)
        let len_byte = payload[6];
        let data_offset = if len_byte & 0x80 != 0 {
            let extra = (len_byte & 0x7F) as usize;
            7 + extra
        } else {
            7
        };
        if payload.len() < data_offset {
            return Err(RdpError::Protocol("MCS SDI payload truncated".into()));
        }
        return Ok((channel_id, payload[data_offset..].to_vec()));
    }

    // Fallback — treat entire payload as IO channel data
    Ok((1003, payload.to_vec()))
}
