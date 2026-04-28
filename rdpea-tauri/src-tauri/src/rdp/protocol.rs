// RDP Protocol — X.224, MCS, GCC PDU building/parsing
// AGENT-B: Implement X.224 Connection Negotiation

use crate::rdp::client::RdpError;

/// Protocol negotiation options
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    /// Standard RDP security (legacy)
    Rdp = 0x00000000,
    /// SSL/TLS
    Ssl = 0x00000001,
    /// CredSSP (NLA)
    Hybrid = 0x00000002,
    /// Extended CredSSP
    HybridEx = 0x00000008,
}

/// X.224 Connection Request PDU (CR-TPDU)
#[derive(Debug)]
pub struct X224ConnectionRequest {
    /// RDP cookie with client identifier (usually "mstshash=<hostname>")
    pub cookie: Option<String>,
    /// Requested protocol options (RDP, SSL, HYBRID, HYBRID_EX)
    pub protocols: Vec<Protocol>,
    /// Requested protocol class (always 0 for RDP)
    pub class: u8,
}

/// X.224 Connection Confirm PDU (CC-TPDU)
#[derive(Debug)]
pub struct X224ConnectionConfirm {
    /// Selected protocol (only present if negotiation requested)
    pub selected_protocol: Option<Protocol>,
    /// Negotiation result flags
    pub negotiation_result: Option<u8>,
    /// Response data (MCS Connect Response)
    pub response_data: Vec<u8>,
}

impl X224ConnectionRequest {
    /// Create a new X.224 Connection Request
    pub fn new() -> Self {
        Self {
            cookie: None,
            protocols: vec![],
            class: 0,
        }
    }

    /// Add RDP cookie with hostname
    pub fn with_rdp_cookie(mut self, hostname: &str) -> Self {
        self.cookie = Some(format!("Cookie: mstshash={}\r\n", hostname));
        self
    }

    /// Add requested protocols for negotiation
    pub fn with_negotiation_protocols(mut self, protocols: &[Protocol]) -> Self {
        self.protocols = protocols.to_vec();
        self
    }

    /// Encode to bytes
    /// Format: [Length(1)] [CR-TPDU(1)] [Dst-Ref(2)] [Src-Ref(2)] [Class(1)] [Variable...]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = Vec::new();

        // X.224 CR-TPDU header starts at offset 1 in the length calculation
        // The length byte itself is calculated later

        // CR-TPDU type (0xE0 = Connection Request + class 0)
        result.push(0xE0);

        // Destination reference (2 bytes, 0x0000 for new connection)
        result.extend_from_slice(&[0x00, 0x00]);

        // Source reference (2 bytes, 0x0000 for new connection)
        result.extend_from_slice(&[0x00, 0x00]);

        // Class and options (1 byte, 0x00 for class 0)
        result.push(self.class);

        // RDP cookie if present
        if let Some(ref cookie) = self.cookie {
            result.extend_from_slice(cookie.as_bytes());
        }

        // RDP_NEG_REQ if protocols specified
        if !self.protocols.is_empty() {
            // RDP_NEG_REQ structure:
            // Type (1): 0x01 = TYPE_RDP_NEG_REQ
            // Flags (1): 0x00
            // Length (2): 0x0008 (8 bytes total)
            // RequestedProtocols (4): OR of protocol flags
            result.push(0x01); // TYPE_RDP_NEG_REQ
            result.push(0x00); // Flags
            result.extend_from_slice(&0x0008u16.to_le_bytes()); // Length

            // Calculate requested protocols
            let mut requested: u32 = 0;
            for protocol in &self.protocols {
                requested |= *protocol as u32;
            }
            result.extend_from_slice(&requested.to_le_bytes());
        }

        // LI (Length Indicator) = number of bytes after the LI byte itself
        // i.e., result.len() (does NOT count the LI byte)
        let li = result.len() as u8;
        let mut final_result = vec![li];
        final_result.extend_from_slice(&result);

        final_result
    }
}

impl Default for X224ConnectionRequest {
    fn default() -> Self {
        Self::new()
    }
}

impl X224ConnectionConfirm {
    /// Parse from bytes (TPKT payload = X.224 CC-TPDU, without TPKT header)
    /// Layout: [LI(1)] [0xD0 CC code(1)] [DST-REF(2)] [SRC-REF(2)] [class(1)] [NEG_RSP(8, optional)]
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        if bytes.len() < 7 {
            return Err(RdpError::Connection(format!(
                "X.224 CC-TPDU too short: {} bytes",
                bytes.len()
            )));
        }

        // bytes[0] = LI (length indicator, does not count itself)
        // bytes[1] = TPDU code: 0xD0 = CC (Connection Confirm)
        let tpdu_code = bytes[1];
        if tpdu_code != 0xD0 {
            return Err(RdpError::Connection(format!(
                "Expected X.224 CC (0xD0), got 0x{:02X}", tpdu_code
            )));
        }

        // Skip: LI(1) + code(1) + DST-REF(2) + SRC-REF(2) + class(1) = 7 bytes
        let mut offset = 7;

        let mut selected_protocol = None;
        let mut negotiation_result = None;

        // Optional RDP_NEG_RSP or RDP_NEG_FAILURE (8 bytes each)
        if bytes.len() >= offset + 8 {
            let neg_type = bytes[offset];
            let neg_flags = bytes[offset + 1];
            // length at offset+2..+4 (LE u16), should be 8
            let protocol_val = u32::from_le_bytes([
                bytes[offset + 4],
                bytes[offset + 5],
                bytes[offset + 6],
                bytes[offset + 7],
            ]);

            match neg_type {
                0x02 => {
                    // TYPE_RDP_NEG_RSP
                    selected_protocol = Some(match protocol_val {
                        0x00000000 => Protocol::Rdp,
                        0x00000001 => Protocol::Ssl,
                        0x00000002 => Protocol::Hybrid,
                        0x00000008 => Protocol::HybridEx,
                        v => return Err(RdpError::Protocol(format!("Unknown negotiated protocol: 0x{:08X}", v))),
                    });
                    negotiation_result = Some(neg_flags);
                }
                0x03 => {
                    // TYPE_RDP_NEG_FAILURE
                    return Err(RdpError::Connection(format!(
                        "RDP negotiation failed: code 0x{:08X}", protocol_val
                    )));
                }
                _ => {} // no negotiation response, legacy server
            }
        }

        Ok(Self {
            selected_protocol,
            negotiation_result,
            response_data: vec![],
        })
    }

    /// Check if connection was successful
    pub fn is_success(&self) -> bool {
        // Check if we got a selected protocol (means negotiation succeeded)
        // or if there's response data (legacy connection without negotiation)
        self.selected_protocol.is_some() || !self.response_data.is_empty()
    }
}

/// Negotiate protocol between client preferences and server offer
pub fn negotiate_protocol(
    client_prefs: &[Protocol],
    server_offers: &[Protocol],
) -> Option<Protocol> {
    // Priority order: HybridEx (0x08) > Hybrid (0x02) > Ssl (0x01) > Rdp (0x00)
    // Client prefs are already in priority order
    // Return first match from client_prefs that server also offers

    for client_pref in client_prefs {
        if server_offers.contains(client_pref) {
            return Some(*client_pref);
        }
    }

    None
}

/// Check if protocol uses TLS/CredSSP
pub fn protocol_requires_tls(protocol: Protocol) -> bool {
    matches!(protocol, Protocol::Ssl | Protocol::Hybrid | Protocol::HybridEx)
}

/// Check if protocol uses Network Level Authentication (NLA)
pub fn protocol_requires_nla(protocol: Protocol) -> bool {
    matches!(protocol, Protocol::Hybrid | Protocol::HybridEx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_x224_connection_request_building() {
        let request = X224ConnectionRequest::new()
            .with_rdp_cookie("192.168.1.10")
            .with_negotiation_protocols(&[Protocol::Rdp, Protocol::Ssl, Protocol::Hybrid]);

        let bytes = request.to_bytes();

        // bytes[0] is the TPDU length byte; bytes[1] is CR-TPDU code 0xE0
        assert_eq!(bytes[1] & 0xF0, 0xE0);
        assert_eq!(bytes[1] & 0x0F, 0x00);
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("mstshash=192.168.1.10"));
    }

    #[test]
    fn test_x224_connection_confirm_parsing() {
        // Mock X.224 Connection Confirm with RDP_NEG_RSP
        // After 0x02 0xF0 0x80 header (offset jumps to 3), then MCS tag (2 bytes, offset=5)
        // Then RDP_NEG_RSP: type(2LE) flags(1) length(2LE) protocol(4LE)
        let response = vec![
            0x02, 0xF0, 0x80, // Extended CC-TPDU header
            0x7F, 0x65,       // MCS tag (2 bytes, advance offset to 5)
            // RDP_NEG_RSP at offset 5:
            0x02, 0x00,       // Type: TYPE_RDP_NEG_RSP = 0x0002 (little-endian)
            0x00,             // Flags
            0x08, 0x00,       // Length: 8 (little-endian)
            0x02, 0x00, 0x00, 0x00, // Selected protocol: HYBRID = 0x00000002
        ];

        let confirm = X224ConnectionConfirm::from_bytes(&response).unwrap();
        assert_eq!(confirm.selected_protocol, Some(Protocol::Hybrid));
        assert!(confirm.is_success());
    }

    #[test]
    fn test_protocol_negotiation() {
        let client_prefs = &[Protocol::HybridEx, Protocol::Hybrid, Protocol::Ssl];
        let server_offers = &[Protocol::Hybrid, Protocol::Ssl];

        let negotiated = negotiate_protocol(client_prefs, server_offers);
        assert_eq!(negotiated, Some(Protocol::Hybrid));
    }

    #[test]
    fn test_protocol_negotiation_no_match() {
        let client_prefs = &[Protocol::HybridEx];
        let server_offers = &[Protocol::Rdp];

        let negotiated = negotiate_protocol(client_prefs, server_offers);
        assert_eq!(negotiated, None);
    }

    #[test]
    fn test_protocol_tls_detection() {
        assert!(protocol_requires_tls(Protocol::Ssl));
        assert!(protocol_requires_tls(Protocol::Hybrid));
        assert!(protocol_requires_tls(Protocol::HybridEx));
        assert!(!protocol_requires_tls(Protocol::Rdp));
    }

    #[test]
    fn test_protocol_nla_detection() {
        assert!(protocol_requires_nla(Protocol::Hybrid));
        assert!(protocol_requires_nla(Protocol::HybridEx));
        assert!(!protocol_requires_nla(Protocol::Ssl));
        assert!(!protocol_requires_nla(Protocol::Rdp));
    }
}
