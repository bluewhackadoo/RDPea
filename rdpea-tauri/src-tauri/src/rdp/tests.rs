#[cfg(test)]
mod phase1_foundation_tests {
    // Phase 1: Transport + X.224 + MCS + GCC + RSA

    use super::*;
    use std::io::Cursor;

    // === Component 1: Transport Layer Tests ===

    #[test]
    fn test_tpkt_frame_encoding() {
        let data = vec![0x01, 0x02, 0x03, 0x04];
        let tpkt = TpktFrame::new(&data);
        let encoded = tpkt.to_bytes();

        assert_eq!(encoded[0], 0x03); // version
        assert_eq!(encoded[1], 0x00); // reserved
        assert_eq!(&encoded[4..], &data); // payload
        assert_eq!(encoded.len(), 4 + data.len()); // 4-byte header + payload
    }

    #[test]
    fn test_tpkt_frame_decoding() {
        let raw = vec![0x03, 0x00, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04];
        let tpkt = TpktFrame::from_bytes(&raw).unwrap();

        assert_eq!(tpkt.version, 0x03);
        assert_eq!(tpkt.length, 8);
        assert_eq!(tpkt.payload, vec![0x01, 0x02, 0x03, 0x04]);
    }

    #[tokio::test]
    async fn test_tcp_transport_mock() {
        // Mock transport that reads from/writes to buffers
        let mut transport = MockTransport::new();
        
        // Simulate server response
        transport.push_read(vec![0x03, 0x00, 0x00, 0x06, 0x01, 0x02]);

        // Test send
        transport.send_tpkt(&[0x01, 0x02]).await.unwrap();

        // Test receive
        let response = transport.recv_tpkt().await.unwrap();
        assert_eq!(response.payload, vec![0x01, 0x02]);
    }

    #[test]
    fn test_tpkt_invalid_version() {
        let raw = vec![0x02, 0x00, 0x00, 0x04]; // version 2 is invalid
        assert!(TpktFrame::from_bytes(&raw).is_err());
    }

    // === Component 2: X.224 Tests ===

    #[test]
    fn test_x224_connection_request_building() {
        let request = X224ConnectionRequest::new()
            .with_rdp_cookie("192.168.1.10")
            .with_negotiation_protocols(&[Protocol::Rdp, Protocol::Ssl, Protocol::Hybrid]);

        let bytes = request.to_bytes();

        // Check CR-TPDU type (0xE0)
        assert_eq!(bytes[0] & 0xF0, 0xE0);
        // Check class 0
        assert_eq!(bytes[0] & 0x0F, 0x00);
        // Check RDP cookie is present
        assert!(String::from_utf8_lossy(&bytes).contains("Cookie: mstshash=192.168.1.10"));
    }

    #[test]
    fn test_x224_connection_confirm_parsing() {
        let response = vec![
            0x02, 0xF0, 0x80, // CC-TPDU header
            0x7F, 0x65, // T.125 MCS Connect Response tag
            // ... truncated for brevity, real test would have full response
        ];

        let confirm = X224ConnectionConfirm::from_bytes(&response).unwrap();
        assert!(confirm.negotiation_result.is_some());
    }

    #[test]
    fn test_protocol_negotiation() {
        let client_prefs = &[Protocol::HybridEx, Protocol::Hybrid, Protocol::Ssl];
        let server_offers = &[Protocol::Hybrid, Protocol::Ssl];

        let negotiated = negotiate_protocol(client_prefs, server_offers);
        assert_eq!(negotiated, Some(Protocol::Hybrid));
    }

    // === Component 3: MCS Tests ===

    #[test]
    fn test_mcs_connect_initial_encoding() {
        let client_data = ClientCoreData {
            version: RdpVersion::V10_7,
            desktop_width: 1920,
            desktop_height: 1080,
            color_depth: 32,
            // ... other fields
        };

        let mcs = McsConnectInitial::new(&client_data);
        let bytes = mcs.to_bytes();

        // Check MCS Connect Initial tag (101)
        assert!(bytes[0] == 0x7f || bytes[0] == 101);
        // BER encoded length should be present
        assert!(bytes.len() > 10);
    }

    #[test]
    fn test_mcs_connect_response_parsing() {
        // Mock MCS Connect Response from server
        let response = vec![
            0x7F, 0x65, // Connect Response tag
            0x82, 0x01, 0x5C, // Length: 348 bytes
            // ... domain params + user data
        ];

        let parsed = McsConnectResponse::from_bytes(&response).unwrap();
        assert!(parsed.domain_params.is_some());
        assert!(!parsed.user_data.is_empty());
    }

    #[test]
    fn test_ber_length_encoding() {
        // Short form: 0-127
        assert_eq!(encode_ber_length(0), vec![0x00]);
        assert_eq!(encode_ber_length(127), vec![0x7F]);

        // Long form: 128+
        assert_eq!(encode_ber_length(128), vec![0x81, 0x80]);
        assert_eq!(encode_ber_length(256), vec![0x82, 0x01, 0x00]);
    }

    #[test]
    fn test_ber_length_decoding() {
        let short = [0x7Fu8];
        assert_eq!(decode_ber_length(&mut Cursor::new(&short)).unwrap(), 127);

        let long = [0x82u8, 0x01, 0x00];
        assert_eq!(decode_ber_length(&mut Cursor::new(&long)).unwrap(), 256);
    }

    // === Component 4: GCC Tests ===

    #[test]
    fn test_client_core_data_encoding() {
        let core = ClientCoreData {
            version: RdpVersion::V10_7, // 0x000A0007
            desktop_width: 1920,
            desktop_height: 1080,
            color_depth: 32,
            sas_sequence: 0xAA03,
            keyboard_layout: 0x00000409, // US English
            client_build: 2600,
            client_name: "RDPea-Client".to_string(),
            keyboard_type: 4,
            keyboard_subtype: 0,
            keyboard_function_key: 12,
            ime_file_name: "".to_string(),
            post_beta2_color_depth: 32,
            client_product_id: 1,
            serial_number: 0,
            high_color_depth: 32,
            supported_color_depths: 0x0007, // 8, 16, 32
            early_capability_flags: 0x0001, // RNS_UD_CS_SUPPORT_ERRINFO_PDU
        };

        let encoded = core.to_bytes();
        
        // Check version bytes (little-endian)
        assert_eq!(encoded[0], 0x07);
        assert_eq!(encoded[1], 0x00);
        assert_eq!(encoded[2], 0x0A);
        assert_eq!(encoded[3], 0x00);
        
        // Check desktop dimensions
        assert_eq!(u16::from_le_bytes([encoded[4], encoded[5]]), 1920);
        assert_eq!(u16::from_le_bytes([encoded[6], encoded[7]]), 1080);
    }

    #[test]
    fn test_client_security_data_encoding() {
        let security = ClientSecurityData {
            encryption_methods: EncryptionMethod::FIPS | EncryptionMethod::128BIT,
            ext_encryption_methods: 0,
        };

        let encoded = security.to_bytes();
        assert_eq!(encoded.len(), 8);
        
        // Check encryption methods flags
        let methods = u32::from_le_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]);
        assert!(methods & EncryptionMethod::FIPS.bits() != 0);
    }

    #[test]
    fn test_channel_definitions_encoding() {
        let channels = vec![
            ChannelDef::new("rdpdr", ChannelOptions::COMPRESS),
            ChannelDef::new("rdpsnd", ChannelOptions::NONE),
            ChannelDef::new("cliprdr", ChannelOptions::ENCRYPT_RDP),
        ];

        let net_data = ClientNetworkData::new(&channels);
        let encoded = net_data.to_bytes();

        // Should contain channel count
        assert!(encoded.len() >= 4);
        let count = u32::from_le_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]);
        assert_eq!(count, 3);
    }

    #[test]
    fn test_server_core_data_parsing() {
        // Mock server core data
        let server_data = vec![
            0x0C, 0x00, // Type: SC_CORE (0x0C01)
            0x08, 0x00, // Length: 8
            0x08, 0x00, 0x00, 0x00, // Version: RDP 5.0
        ];

        let block = ServerDataBlock::from_bytes(&server_data).unwrap();
        match block {
            ServerDataBlock::Core(core) => {
                assert_eq!(core.version, RdpVersion::V5_0);
            }
            _ => panic!("Expected Core block"),
        }
    }

    // === Component 5: RSA Security Tests ===

    #[test]
    fn test_client_random_generation() {
        let security = SecurityLayer::new();
        let random = security.generate_client_random();
        
        assert_eq!(random.len(), 32); // 256-bit random
    }

    #[test]
    fn test_rsa_encryption_mock() {
        // Use test RSA key
        let rsa = test_rsa_key();
        let plaintext = b"Hello, World!";
        
        let encrypted = rsa_encrypt(&rsa, plaintext).unwrap();
        assert!(encrypted.len() > plaintext.len()); // Padding makes it larger
    }

    #[test]
    fn test_premaster_secret_generation() {
        let security = SecurityLayer::new();
        security.generate_client_random();
        
        let secret = security.derive_premaster_secret();
        assert_eq!(secret.len(), 48); // 384-bit premaster
    }

    // === Phase 1 Integration Test ===

    #[tokio::test]
    async fn test_phase1_connection_flow() {
        // This test verifies all Phase 1 components work together
        let mut mock = MockRdpServer::new();
        
        // Server expects X.224 CR then responds with CC
        mock.expect_x224_cr().await;
        mock.send_x224_cc(Protocol::Hybrid).await;
        
        // Server expects MCS CI then responds with CR
        mock.expect_mcs_ci().await;
        mock.send_mcs_cr().await;
        
        // Client connects
        let transport = RdpTransport::connect("127.0.0.1", mock.port()).await.unwrap();
        
        // X.224
        let x224 = X224Layer::new(&transport);
        let negotiated = x224.negotiate().await.unwrap();
        assert_eq!(negotiated, Protocol::Hybrid);
        
        // MCS
        let client_data = ClientCoreData::default();
        let mcs = McsLayer::new(&transport);
        mcs.connect(&client_data).await.unwrap();
        
        // Verify full handshake completed
        assert!(mock.handshake_complete());
    }
}

#[cfg(test)]
mod phase2_authentication_tests {
    // Phase 2: NTLMv2 + CredSSP

    use super::*;

    // === Component 6: NTLMv2 Tests ===

    #[test]
    fn test_ntlm_type1_message_generation() {
        let ntlm = NtlmAuth::new("DOMAIN", "username", "password");
        let type1 = ntlm.build_type1();

        // Check NTLMSSP signature
        assert_eq!(&type1[0..7], b"NTLMSSP");
        assert_eq!(type1[7], 0x00);
        
        // Check message type (1 = Negotiate)
        let msg_type = u32::from_le_bytes([type1[8], type1[9], type1[10], type1[11]]);
        assert_eq!(msg_type, 1);
    }

    #[test]
    fn test_ntlm_type2_parsing() {
        // Mock Type 2 challenge from server
        let type2 = vec![
            0x4E, 0x54, 0x4C, 0x4D, 0x53, 0x53, 0x50, 0x00, // NTLMSSP\0
            0x02, 0x00, 0x00, 0x00, // Type 2
            // Target name, flags, challenge, etc.
            0x00, 0x00, 0x00, 0x00, // Flags
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // Challenge
        ];

        let challenge = NtlmType2::from_bytes(&type2).unwrap();
        assert_eq!(challenge.challenge, [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    }

    #[test]
    fn test_ntlmv2_response_calculation() {
        let password = "Password123";
        let username = "user";
        let domain = "DOMAIN";
        let challenge = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];

        // Known test vector
        let nt_hash = nt_password_hash(password);
        let response = ntlmv2_response(&nt_hash, username, domain, &challenge);

        // Response should be 24 bytes (NTLMv2 uses HMAC-MD5)
        assert_eq!(response.len(), 24);
    }

    #[test]
    fn test_nt_password_hash() {
        let hash = nt_password_hash("password");
        
        // MD4 hash of UTF-16LE "password"
        // Known value: 8846F7EAEE8FB117AD06BDD830B7586C
        assert_eq!(hash, [
            0x88, 0x46, 0xF7, 0xEA, 0xEE, 0x8F, 0xB1, 0x17,
            0xAD, 0x06, 0xBD, 0xD8, 0x30, 0xB7, 0x58, 0x6C
        ]);
    }

    #[test]
    fn test_ntlm_type3_message_generation() {
        let ntlm = NtlmAuth::new("DOMAIN", "user", "Password123");
        let type2 = NtlmType2 {
            challenge: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            target_info: vec![],
            flags: 0x00088207,
        };

        ntlm.process_type2(&type2).unwrap();
        let type3 = ntlm.build_type3();

        // Check message type (3 = Authenticate)
        let msg_type = u32::from_le_bytes([type3[8], type3[9], type3[10], type3[11]]);
        assert_eq!(msg_type, 3);

        // Should contain LmResponse, NtResponse, domain, user, workstation
        assert!(type3.len() > 64);
    }

    #[test]
    fn test_session_key_derivation() {
        let ntlm = NtlmAuth::new("DOMAIN", "user", "password");
        let type2 = NtlmType2 {
            challenge: [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08],
            target_info: vec![],
            flags: 0x00088207,
        };

        ntlm.process_type2(&type2).unwrap();
        let session_key = ntlm.derive_session_key();
        
        assert_eq!(session_key.len(), 16); // 128-bit session key
    }

    // === Component 7: CredSSP Tests ===

    #[test]
    fn test_tsrequest_encoding() {
        let ts_req = TsRequest {
            version: 2,
            nego_tokens: Some(vec![0x01, 0x02, 0x03, 0x04]),
            auth_info: None,
            pub_key_auth: None,
            error_code: None,
        };

        let encoded = ts_req.to_asn1().unwrap();
        
        // Should start with SEQUENCE tag (0x30)
        assert_eq!(encoded[0], 0x30);
        // Should contain version (INTEGER 2)
        assert!(encoded.windows(3).any(|w| w == [0x02, 0x01, 0x02]));
    }

    #[test]
    fn test_tsrequest_parsing() {
        let asn1 = vec![
            0x30, 0x82, 0x00, 0x10, // SEQUENCE, length 16
            0x02, 0x01, 0x02, // INTEGER 2 (version)
            0xA0, 0x82, 0x00, 0x09, // negoTokens [0]
            0x04, 0x07, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, // OCTET STRING
        ];

        let ts_req = TsRequest::from_asn1(&asn1).unwrap();
        assert_eq!(ts_req.version, 2);
        assert_eq!(ts_req.nego_tokens, Some(vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
    }

    #[test]
    fn test_credssp_credential_encryption() {
        let server_key = vec![0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let credentials = b"username\0password\0domain\0";

        let encrypted = encrypt_credentials(credentials, &server_key).unwrap();
        
        // Should be encrypted and different from plaintext
        assert_ne!(encrypted, credentials.to_vec());
    }

    #[test]
    fn test_public_key_binding_verification() {
        let server_key = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
        let session_key = [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18];

        let binding = CredSSP::compute_pub_key_auth(&server_key, &session_key);
        
        // Should produce 32-byte binding
        assert_eq!(binding.len(), 32);
    }

    // === Phase 2 Integration Test ===

    #[tokio::test]
    async fn test_full_credssp_handshake() {
        let mut mock = MockCredSSP::new();
        
        // Simulate server sending initial TSRequest
        mock.send_tsrequest(TsRequest {
            version: 2,
            nego_tokens: None,
            auth_info: None,
            pub_key_auth: None,
            error_code: None,
        }).await;

        let credssp = CredSSP::new(&mock.transport(), &mock.server_pubkey());
        
        // Perform handshake
        let result = credssp.authenticate("user", "password", "DOMAIN").await;
        assert!(result.is_ok());
        
        // Verify server received all expected tokens
        assert_eq!(mock.received_negotiate_count(), 1);
        assert_eq!(mock.received_authenticate_count(), 1);
        assert!(mock.pub_key_verified());
    }

    #[test]
    fn test_ntlm_unicode_handling() {
        // Test unicode domain\user parsing
        let (domain, user) = parse_domain_user("DOMAIN\\username");
        assert_eq!(domain, "DOMAIN");
        assert_eq!(user, "username");

        let (domain, user) = parse_domain_user("username@domain.com");
        assert_eq!(domain, "domain.com");
        assert_eq!(user, "username");

        let (domain, user) = parse_domain_user("justuser");
        assert_eq!(domain, "");
        assert_eq!(user, "justuser");
    }
}

#[cfg(test)]
mod phase3_session_tests {
    // Phase 3: Session Init + Capabilities + Bitmap

    use super::*;

    // === Component 8: Session Init Tests ===

    #[test]
    fn test_demand_active_pdu_parsing() {
        let pdu = vec![
            0xF0, 0x15, // Share Control Header (PDUTYPE_DEMANDACTIVEPDU)
            // Share ID, originator ID, length
            0x00, 0x00, 0x00, 0x01, // Share ID
            0x00, 0x03, // Length
            // Capability sets
        ];

        let demand = DemandActivePdu::from_bytes(&pdu).unwrap();
        assert_eq!(demand.share_id, 1);
    }

    #[test]
    fn test_confirm_active_pdu_generation() {
        let capabilities = vec![
            CapabilitySet::General(GeneralCapability::default()),
            CapabilitySet::Bitmap(BitmapCapability::default()),
        ];

        let confirm = ConfirmActivePdu::new(1, capabilities);
        let bytes = confirm.to_bytes();

        // Check PDU type (0x13 = Confirm Active)
        assert_eq!(bytes[1], 0x13);
    }

    #[test]
    fn test_capability_set_encoding() {
        let general = GeneralCapability {
            os_major: 0x0001,
            os_minor: 0x0001,
            protocol_version: 0x0200,
            pad2octets_a: 0,
            compression_flags: 0,
            pad2octets_b: 0,
            update_capability: 0,
            remote_unshare_capability: 0,
            compression_level: 0,
            pad2octets_c: 0,
        };

        let encoded = general.to_bytes();
        assert_eq!(encoded.len(), 24); // General capability is 24 bytes

        let decoded = GeneralCapability::from_bytes(&encoded).unwrap();
        assert_eq!(decoded.protocol_version, 0x0200);
    }

    #[test]
    fn test_bitmap_capability_encoding() {
        let bitmap = BitmapCapability {
            preferred_bits_per_pixel: 32,
            receive1_bit_per_pixel: 0,
            receive4_bits_per_pixel: 0,
            receive8_bits_per_pixel: 1,
            desktop_width: 1920,
            desktop_height: 1080,
            desktop_resize_flag: 1,
            bitmap_compression_flag: 1,
            high_color_flags: 0,
            drawing_flags: 0,
            multiple_rect_support: 1,
            pad2octets_b: 0,
        };

        let encoded = bitmap.to_bytes();
        assert_eq!(encoded.len(), 28); // Bitmap capability is 28 bytes

        // Check dimensions
        let width = u16::from_le_bytes([encoded[10], encoded[11]]);
        let height = u16::from_le_bytes([encoded[12], encoded[13]]);
        assert_eq!(width, 1920);
        assert_eq!(height, 1080);
    }

    #[test]
    fn test_order_capability_encoding() {
        let order = OrderCapability {
            terminal_descriptor: [0; 16],
            width: 1920,
            height: 1080,
            desktop_cache_size: 0,
            number_of_fci: 0,
            number_of_cache_entries: 0,
            support_level: 0,
            text_ansi_support: 0,
            text_support_level: 0,
            pad2octets_c: 0,
            pad2octets_d: 0,
            pad2octets_e: 0,
            pad2octets_f: 0,
            pad2octets_g: 0,
        };

        let encoded = order.to_bytes();
        assert_eq!(encoded.len(), 88); // Order capability is 88 bytes
    }

    #[test]
    fn test_synchronize_pdu() {
        let sync = SynchronizePdu::new(1); // Target user = 1
        let bytes = sync.to_bytes();

        // PDUTYPE2_SYNCHRONIZE = 0x1F
        assert!(bytes.windows(2).any(|w| w == [0xF0, 0x1F]));
    }

    // === Component 9: Bitmap Tests ===

    #[test]
    fn test_8bpp_rle_decompression() {
        // 4x4 image, all white (0xFF) with RLE encoding
        let compressed = vec![
            0x0D, 0xFF, 0x10, // Run of 16 white pixels (0x0D = run, 0xFF = color, 0x10 = count)
        ];

        let decompressed = decompress_bitmap_8bpp(&compressed, 4, 4).unwrap();
        assert_eq!(decompressed.len(), 64); // 4x4 * 4 bytes (RGBA)
        
        // All pixels should be white
        for i in (0..64).step_by(4) {
            assert_eq!(decompressed[i], 0xFF);     // R
            assert_eq!(decompressed[i + 1], 0xFF); // G
            assert_eq!(decompressed[i + 2], 0xFF); // B
            assert_eq!(decompressed[i + 3], 0xFF); // A
        }
    }

    #[test]
    fn test_16bpp_r565_decompression() {
        // Simple 2x2 16bpp R565 image
        let compressed = vec![
            // RLE header or raw data depending on format
            0x00, 0xF8, // Red pixel (R5=31, G6=0, B5=0)
            0x00, 0x07, // Green pixel (R5=0, G6=63, B5=0)
            0x00, 0xE0, // Blue pixel (R5=0, G6=0, B5=31)
            0x00, 0xFF, // White pixel
        ];

        let decompressed = decompress_bitmap_16bpp(&compressed, 2, 2).unwrap();
        assert_eq!(decompressed.len(), 16); // 2x2 * 4 bytes

        // Check first pixel is red
        assert!(decompressed[0] > 0xF0); // R high
        assert!(decompressed[1] < 0x10); // G low
        assert!(decompressed[2] < 0x10); // B low
    }

    #[test]
    fn test_24bpp_raw_conversion() {
        // 2x2 BGR image (RDP uses BGR order)
        let raw = vec![
            0x00, 0x00, 0xFF, // Red (BGR)
            0x00, 0xFF, 0x00, // Green
            0xFF, 0x00, 0x00, // Blue
            0xFF, 0xFF, 0xFF, // White
        ];

        let rgba = bgr24_to_rgba32(&raw, 2, 2).unwrap();
        
        // First pixel should be red in RGBA
        assert_eq!(rgba[0], 0xFF); // R
        assert_eq!(rgba[1], 0x00); // G
        assert_eq!(rgba[2], 0x00); // B
        assert_eq!(rgba[3], 0xFF); // A
    }

    #[test]
    fn test_32bpp_rgba_conversion() {
        // 32bpp is already RGBA, just needs byte order fix if necessary
        let raw = vec![
            0x00, 0x00, 0xFF, 0xFF, // BGRA Red (ABGR in little-endian)
            0x00, 0xFF, 0x00, 0xFF, // Green
        ];

        let rgba = bgra32_to_rgba32(&raw, 1, 2).unwrap();
        assert_eq!(rgba.len(), 8); // 1x2 * 4

        // Check conversion to RGBA order
        assert_eq!(rgba[0], 0xFF); // R
        assert_eq!(rgba[1], 0x00); // G
        assert_eq!(rgba[2], 0x00); // B
        assert_eq!(rgba[3], 0xFF); // A
    }

    #[test]
    fn test_bitmap_cache_management() {
        let mut cache = BitmapCache::new(64 * 1024); // 64KB cache
        
        let bitmap1 = vec![0xFF; 1000]; // 1KB bitmap
        let id1 = cache.insert(0, 1, bitmap1.clone());
        
        assert!(cache.get(0, 1).is_some());
        assert_eq!(cache.get(0, 1).unwrap(), &bitmap1);
        
        // Insert more bitmaps to test eviction
        for i in 2..=70 {
            cache.insert(0, i, vec![0xAA; 1000]);
        }
        
        // First bitmap should still be there (recently accessed)
        assert!(cache.get(0, 1).is_some());
    }

    // === Phase 3 Integration ===

    #[tokio::test]
    async fn test_session_handshake() {
        let mut mock = MockRdpServer::new();
        
        // Server sends Demand Active PDU
        mock.send_demand_active(DemandActivePdu {
            share_id: 1,
            originator_id: 0,
            capability_sets: vec![
                CapabilitySet::General(GeneralCapability::default()),
            ],
        }).await;

        let session = Session::new(&mock.transport());
        session.establish().await.unwrap();

        // Should have sent Confirm Active + Synchronize
        assert!(mock.received_confirm_active());
        assert!(mock.received_synchronize());
        assert!(mock.received_control(CtrlAction::Cooperate));
        assert!(mock.received_control(CtrlAction::RequestControl));
    }
}

#[cfg(test)]
mod phase4_input_tests {
    // Phase 4: Input + Channels

    use super::*;

    // === Component 10: Input Tests ===

    #[test]
    fn test_fast_path_keyboard_input() {
        let input = FastPathInput::keyboard_down(0x1E, false); // 'a' key, non-extended
        let bytes = input.to_bytes();

        // Check fast-path header
        assert_eq!(bytes[0] & 0xC0, 0x00); // Fast-path input header
    }

    #[test]
    fn test_fast_path_mouse_input() {
        let input = FastPathInput::mouse(100, 200, MouseButton::Left, true);
        let bytes = input.to_bytes();

        // Should contain flags, x, y
        assert!(bytes.len() >= 7);
        
        // Check X coordinate (100)
        let x = u16::from_le_bytes([bytes[1], bytes[2]]);
        assert_eq!(x, 100);
        
        // Check Y coordinate (200)
        let y = u16::from_le_bytes([bytes[3], bytes[4]]);
        assert_eq!(y, 200);
    }

    #[test]
    fn test_input_scancode_mapping() {
        assert_eq!(scancode_to_rdp(0x1E, false), 0x1E); // 'a' key
        assert_eq!(scancode_to_rdp(0x1E, true), 0x1E | 0x100); // Extended flag
        
        assert_eq!(scancode_to_rdp(0x1D, true), 0x1D | 0x100); // Right Ctrl
        assert_eq!(scancode_to_rdp(0x38, true), 0x38 | 0x100); // Right Alt
    }

    #[test]
    fn test_input_synchronize_event() {
        // Ctrl+Alt+Del
        let sync = SynchronizeEvent::new(SyncFlags::EMPTY, ToggleFlags::SCROLL_LOCK);
        let bytes = sync.to_bytes();
        
        assert_eq!(bytes[0], 0x00); // Input type: Synchronize
    }

    #[test]
    fn test_unicode_input() {
        let unicode = UnicodeInput::new('A', true);
        let bytes = unicode.to_bytes();
        
        // Unicode input has different structure
        assert_eq!(bytes[0] & 0x0F, 0x05); // Type 5 = Unicode
    }

    #[test]
    fn test_input_throttling() {
        let mut throttle = InputThrottle::new(60); // 60 FPS max
        
        let now = Instant::now();
        assert!(throttle.should_send(now)); // First input always sends
        
        let next = now + Duration::from_millis(10); // 10ms later
        assert!(!throttle.should_send(next)); // Too soon
        
        let later = now + Duration::from_millis(20); // 20ms later (16.6ms is 60fps)
        assert!(throttle.should_send(later)); // OK now
    }

    // === Component 11: Virtual Channel Tests ===

    #[test]
    fn test_channel_header_encoding() {
        let header = ChannelHeader {
            total_length: 100,
            flags: ChannelFlags::FIRST | ChannelFlags::LAST,
        };
        let bytes = header.to_bytes();
        
        assert_eq!(bytes.len(), 8);
        assert_eq!(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]), 100);
    }

    #[test]
    fn test_channel_data_chunking() {
        let large_data = vec![0xAA; 5000]; // 5KB
        let chunks = chunk_channel_data(&large_data, 1600); // Max chunk size
        
        assert!(chunks.len() > 3); // Should be split into multiple chunks
        
        // First chunk should have FIRST flag
        assert!(chunks[0].flags.contains(ChannelFlags::FIRST));
        // Last chunk should have LAST flag
        assert!(chunks.last().unwrap().flags.contains(ChannelFlags::LAST));
    }

    // RDPSND Tests
    #[test]
    fn test_rdpsnd_version_pdu() {
        let version = ServerAudioVersionPdu::new(6, 0); // Version 6.0
        let bytes = version.to_bytes();
        
        // Check version numbers
        assert_eq!(bytes[0], 0x06); // Major
        assert_eq!(bytes[1], 0x00); // Minor
    }

    #[test]
    fn test_rdpsnd_formats_response() {
        let formats = vec![
            AudioFormat::pcm(2, 44100, 16), // Stereo, 44.1kHz, 16-bit
        ];
        let response = ClientAudioFormatsPdu::new(&formats);
        let bytes = response.to_bytes();
        
        assert!(bytes.len() > 10);
    }

    // CLIPRDR Tests
    #[test]
    fn test_clipboard_format_list() {
        let formats = vec![
            ClipboardFormat::UnicodeText,
            ClipboardFormat::Text,
        ];
        let list = FormatListPdu::new(&formats);
        let bytes = list.to_bytes();
        
        // Should contain format IDs
        assert!(bytes.windows(4).any(|w| w == [0x0D, 0x00, 0x00, 0x00])); // CF_UNICODETEXT
    }

    #[test]
    fn test_clipboard_format_data_request() {
        let request = FormatDataRequestPdu::new(ClipboardFormat::UnicodeText);
        let bytes = request.to_bytes();
        
        // Should be 4 bytes: format ID
        assert_eq!(bytes.len(), 4);
        assert_eq!(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]), 13);
    }

    #[test]
    fn test_clipboard_format_data_response() {
        let text = "Hello, World!";
        let data = text.encode_utf16().collect::<Vec<_>>();
        let response = FormatDataResponsePdu::new(&data);
        let bytes = response.to_bytes();
        
        // Data should be in UTF-16LE
        assert_eq!(bytes.len(), text.len() * 2); // 2 bytes per char
    }

    // === Phase 4 Integration ===

    #[tokio::test]
    async fn test_input_roundtrip() {
        let mut mock = MockRdpServer::new();
        
        // Client sends keyboard input
        let input = FastPathInput::keyboard_down(0x1E, false);
        mock.send_fastpath(&input.to_bytes()).await;
        
        // Server should receive and acknowledge
        let received = mock.receive_fastpath().await.unwrap();
        assert_eq!(received[0] & 0x3F, 0x00); // Keyboard event type
        
        // Send mouse input
        let mouse = FastPathInput::mouse(100, 200, MouseButton::Left, true);
        mock.send_fastpath(&mouse.to_bytes()).await;
        
        let mouse_received = mock.receive_fastpath().await.unwrap();
        assert_eq!(mouse_received[0] & 0x3F, 0x01); // Mouse event type
    }

    #[tokio::test]
    async fn test_clipboard_copy_paste() {
        let mut mock = MockRdpServer::new();
        
        // Simulate server announcing clipboard content
        let formats = FormatListPdu::new(&[ClipboardFormat::UnicodeText]);
        mock.send_channel("cliprdr", &formats.to_bytes()).await;

        // Client requests the data
        let request = FormatDataRequestPdu::new(ClipboardFormat::UnicodeText);
        mock.send_channel("cliprdr", &request.to_bytes()).await;

        // Server responds with data
        let text = "Test clipboard data";
        let data = text.encode_utf16().collect::<Vec<_>>();
        let response = FormatDataResponsePdu::new(&data);
        mock.send_channel("cliprdr", &response.to_bytes()).await;

        // Verify data was received and decoded correctly
        let received_text = mock.last_clipboard_text();
        assert_eq!(received_text, text);
    }
}

#[cfg(test)]
mod phase5_integration_tests {
    // Phase 5: Full client + Update loop

    use super::*;

    // === Component 12: Update Processing Tests ===

    #[test]
    fn test_share_control_header_parsing() {
        let header = vec![0xF0, 0x15, 0x00, 0x00]; // PDUTYPE_DEMANDACTIVEPDU
        let parsed = ShareControlHeader::from_bytes(&header).unwrap();
        
        assert_eq!(parsed.pdu_type, PduType::DemandActive);
    }

    #[test]
    fn test_bitmap_update_pdu_parsing() {
        // Mock bitmap update with 1 rectangle
        let pdu = vec![
            0x01, 0x00, // Number of rectangles: 1
            // Rectangle header (14 bytes)
            0x00, 0x00, 0x00, 0x00, // Dest left
            0x00, 0x00, 0x00, 0x00, // Dest top
            0x40, 0x00, // Width: 64
            0x40, 0x00, // Height: 64
            0x04, 0x00, // Bits per pixel: 32
            0x01, 0x00, // Flags: COMPRESSED
            0x00, 0x04, // Bitmap length: 1024
            // Compressed bitmap data...
        ];

        let update = BitmapUpdatePdu::from_bytes(&pdu).unwrap();
        assert_eq!(update.rectangles.len(), 1);
        assert_eq!(update.rectangles[0].width, 64);
        assert_eq!(update.rectangles[0].height, 64);
    }

    #[test]
    fn test_fast_path_update_parsing() {
        // Fast-path update header
        let fp = vec![
            0xC0 | 0x01, // Fast-path output, 1 update
            0x01, // Update type: Bitmap
            // Length (variable)
            // Bitmap update data...
        ];

        let update = FastPathUpdate::from_bytes(&fp).unwrap();
        assert_eq!(update.update_type, UpdateType::Bitmap);
    }

    // TODO: Implement UpdateData type first
    // #[test]
    // fn test_synchronize_update_parsing() {
    //     let sync = vec![0x00]; // Synchronize update
    //     let update = UpdateData::from_bytes(&sync).unwrap();
    //     
    //     match update {
    //         UpdateData::Synchronize => (),
    //         _ => panic!("Expected Synchronize update"),
    //     }
    // }

    // === Component 13: Full Client Tests ===

    #[tokio::test]
    async fn test_full_connection_flow() {
        let mock = MockRdpServer::new()
            .with_version(RdpVersion::V10_7)
            .with_capabilities(vec![
                CapabilitySet::General(GeneralCapability::default()),
                CapabilitySet::Bitmap(BitmapCapability::default()),
            ]);

        let client = RdpClient::new(RdpClientConfig {
            host: "127.0.0.1".to_string(),
            port: mock.port(),
            username: "test".to_string(),
            password: "password".to_string(),
            domain: "".to_string(),
            width: 1920,
            height: 1080,
            color_depth: 32,
        });

        // Events collector
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        client.set_event_handler(move |event| {
            events_clone.lock().unwrap().push(event);
        });

        // Connect
        client.connect().await.unwrap();

        // Verify connection events
        let collected = events.lock().unwrap();
        assert!(collected.iter().any(|e| matches!(e, RdpEvent::Connected { .. })));

        // Simulate a bitmap update
        mock.send_bitmap_update(BitmapUpdatePdu {
            rectangles: vec![BitmapRectIpc {
                x: 0, y: 0, width: 64, height: 64,
                data: vec![0xFF; 64 * 64 * 4],
            }],
        }).await;

        // Give client time to process
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Verify frame received
        let collected = events.lock().unwrap();
        assert!(collected.iter().any(|e| matches!(e, RdpEvent::Bitmap { .. })));

        // Disconnect
        client.disconnect().await;
        
        let collected = events.lock().unwrap();
        assert!(collected.iter().any(|e| matches!(e, RdpEvent::Disconnected)));
    }

    #[tokio::test]
    async fn test_reconnection_after_disconnect() {
        let mut mock = MockRdpServer::new();
        
        let client = RdpClient::new(RdpClientConfig {
            host: "127.0.0.1".to_string(),
            port: mock.port(),
            // ... other fields
            ..Default::default()
        });

        // First connection
        client.connect().await.unwrap();
        client.disconnect().await;

        // Reconnect
        mock.reset();
        client.connect().await.unwrap();
        
        assert!(client.is_connected());
    }

    #[tokio::test]
    async fn test_error_handling_auth_failure() {
        let mock = MockRdpServer::new()
            .fail_auth(true); // Simulate auth failure

        let client = RdpClient::new(RdpClientConfig {
            host: "127.0.0.1".to_string(),
            port: mock.port(),
            username: "wrong".to_string(),
            password: "wrong".to_string(),
            ..Default::default()
        });

        let result = client.connect().await;
        assert!(result.is_err());
        
        match result.unwrap_err() {
            RdpError::Auth(msg) => {
                assert!(msg.contains("authentication") || msg.contains("failed"));
            }
            _ => panic!("Expected Auth error"),
        }
    }

    #[tokio::test]
    async fn test_error_handling_connection_refused() {
        // Try to connect to port with no server
        let client = RdpClient::new(RdpClientConfig {
            host: "127.0.0.1".to_string(),
            port: 9999, // No server here
            ..Default::default()
        });

        let result = client.connect().await;
        assert!(result.is_err());
        
        match result.unwrap_err() {
            RdpError::Connection(_) | RdpError::Io(_) => (), // Expected
            _ => panic!("Expected Connection error"),
        }
    }

    // === End-to-End Test ===

    #[tokio::test]
    async fn test_e2e_user_workflow() {
        // Simulates a real user session:
        // 1. Connect
        // 2. Receive initial desktop
        // 3. Send some keyboard/mouse input
        // 4. Receive screen updates
        // 5. Disconnect

        let mock = MockRdpServer::new()
            .with_screen(1920, 1080, 32)
            .with_capabilities(vec![
                CapabilitySet::Input(InputCapability::default()),
                CapabilitySet::Bitmap(BitmapCapability::default()),
            ]);

        let client = RdpClient::new(RdpClientConfig {
            host: "127.0.0.1".to_string(),
            port: mock.port(),
            username: "user".to_string(),
            password: "pass".to_string(),
            width: 1920,
            height: 1080,
            ..Default::default()
        });

        // Connect
        client.connect().await.unwrap();
        
        // Wait for initial screen
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Send some input
        client.send_keyboard("keydown", 0x1E, false).await.unwrap(); // 'a' key
        client.send_mouse("move", 100, 200, None, None).await.unwrap();
        client.send_keyboard("keyup", 0x1E, false).await.unwrap();
        
        // Wait for updates
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Disconnect
        client.disconnect().await;
        
        // Verify mock recorded expected interactions
        assert!(mock.connection_established());
        assert!(mock.received_keyboard_input());
        assert!(mock.received_mouse_input());
        assert!(mock.sent_bitmap_updates());
    }
}

// === Mock Implementations for Testing ===

pub struct MockTransport {
    read_buffer: Vec<u8>,
    write_buffer: Vec<u8>,
    connected: bool,
}

impl MockTransport {
    pub fn new() -> Self {
        Self {
            read_buffer: Vec::new(),
            write_buffer: Vec::new(),
            connected: true,
        }
    }

    pub fn push_read(&mut self, data: Vec<u8>) {
        self.read_buffer.extend(data);
    }

    pub async fn send_tpkt(&mut self, data: &[u8]) -> Result<(), RdpError> {
        // Write length-prefixed TPKT frame
        let len = 4 + data.len() as u16;
        self.write_buffer.push(0x03); // version
        self.write_buffer.push(0x00); // reserved
        self.write_buffer.extend(&len.to_be_bytes());
        self.write_buffer.extend(data);
        Ok(())
    }

    pub async fn recv_tpkt(&mut self) -> Result<TpktFrame, RdpError> {
        if self.read_buffer.len() < 4 {
            return Err(RdpError::Connection("No data".to_string()));
        }
        
        let version = self.read_buffer[0];
        let len = u16::from_be_bytes([self.read_buffer[2], self.read_buffer[3]]) as usize;
        
        if self.read_buffer.len() < len {
            return Err(RdpError::Connection("Incomplete frame".to_string()));
        }
        
        let payload = self.read_buffer[4..len].to_vec();
        self.read_buffer.drain(0..len);
        
        Ok(TpktFrame { version, length: len as u16, payload })
    }
}

pub struct MockRdpServer {
    // Test harness that simulates RDP server responses
    // Implementation depends on how complex we want the mocking
}

impl MockRdpServer {
    pub fn new() -> Self {
        Self {}
    }

    pub fn port(&self) -> u16 {
        3389
    }

    pub async fn expect_x224_cr(&mut self) {
        // Wait for X.224 Connection Request
    }

    pub async fn send_x224_cc(&mut self, protocol: Protocol) {
        // Send X.224 Connection Confirm with negotiated protocol
    }

    pub fn handshake_complete(&self) -> bool {
        true
    }

    // ... other mock methods
}

// === Test Utilities ===

pub fn test_rsa_key() -> Vec<u8> {
    // Return a test RSA public key for encryption tests
    vec![0x00; 270] // Placeholder
}

pub fn encode_ber_length(len: usize) -> Vec<u8> {
    if len <= 127 {
        vec![len as u8]
    } else {
        let bytes = len.to_be_bytes();
        let leading_zeros = bytes.iter().take_while(|&&b| b == 0).count();
        let significant = &bytes[leading_zeros..];
        
        let mut result = vec![0x80 | significant.len() as u8];
        result.extend(significant);
        result
    }
}

pub fn decode_ber_length(cursor: &mut impl std::io::Read) -> Result<usize, std::io::Error> {
    let mut first = [0u8; 1];
    cursor.read_exact(&mut first)?;
    
    if first[0] & 0x80 == 0 {
        Ok(first[0] as usize)
    } else {
        let num_bytes = (first[0] & 0x7F) as usize;
        let mut len_bytes = vec![0u8; num_bytes];
        cursor.read_exact(&mut len_bytes)?;
        
        let mut len = 0usize;
        for b in len_bytes {
            len = (len << 8) | b as usize;
        }
        Ok(len)
    }
}

// Add all types, constants, and helper functions referenced in tests
// These are the interfaces agents must implement

pub struct TpktFrame {
    pub version: u8,
    pub length: u16,
    pub payload: Vec<u8>,
}

impl TpktFrame {
    pub fn new(data: &[u8]) -> Self {
        Self {
            version: 0x03,
            length: (4 + data.len()) as u16,
            payload: data.to_vec(),
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = vec![self.version, 0x00];
        result.extend(&self.length.to_be_bytes());
        result.extend(&self.payload);
        result
    }

    pub fn from_bytes(data: &[u8]) -> Result<Self, RdpError> {
        if data.len() < 4 {
            return Err(RdpError::Protocol("TPKT too short".to_string()));
        }
        Ok(Self {
            version: data[0],
            length: u16::from_be_bytes([data[2], data[3]]),
            payload: data[4..].to_vec(),
        })
    }
}

// ... other types referenced in tests (Protocol, RdpError, etc.)
// These serve as the specification for what agents must implement
