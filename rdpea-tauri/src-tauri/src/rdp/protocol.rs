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
        self.cookie = Some(format!("mstshash={}\r\n", hostname));
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

        // Calculate and prepend length
        // The length includes the length byte itself
        let length = result.len() + 1; // +1 for the length byte we're about to add
        let mut final_result = vec![length as u8];
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
    /// Parse from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        if bytes.len() < 7 {
            return Err(RdpError::Connection(format!(
                "X.224 CC-TPDU too short: {} bytes",
                bytes.len()
            )));
        }

        let mut offset = 0;

        // Check for X.224 CC-TPDU (0xD0 = Connection Confirm + class 0)
        // Or the extended format 0x02 0xF0 0x80 used by RDP
        let cc_type = bytes[offset];

        if cc_type == 0x02 {
            // Extended TPDU format: 0x02 0xF0 0x80
            if bytes.len() < 3 || bytes[offset + 1] != 0xF0 || bytes[offset + 2] != 0x80 {
                return Err(RdpError::Connection(
                    "Invalid extended CC-TPDU format".to_string()
                ));
            }
            offset += 3;
        } else if cc_type == 0xD0 {
            // Standard CC-TPDU: skip length byte and CC type
            offset += 1;
            // Skip destination reference (2 bytes)
            offset += 2;
            // Skip source reference (2 bytes)
            offset += 2;
            // Skip class (1 byte)
            offset += 1;
        } else {
            return Err(RdpError::Connection(format!(
                "Invalid CC-TPDU type: 0x{:02X} (expected 0xD0 or 0x02)",
                cc_type
            )));
        }

        // Check for RDP_NEG_RSP or RDP_NEG_FAILURE
        let mut selected_protocol = None;
        let mut negotiation_result = None;

        if bytes.len() >= offset + 8 {
            // Check for RDP negotiation structure
            let neg_type = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);

            if neg_type == 0x0002 {
                // TYPE_RDP_NEG_RSP
                let flags = bytes[offset + 2];
                let length = u16::from_le_bytes([bytes[offset + 3], bytes[offset + 4]]);

                if length == 8 && bytes.len() >= offset + 8 {
                    let protocol_val = u32::from_le_bytes([
                        bytes[offset + 5],
                        bytes[offset + 6],
                        bytes[offset + 7],
                        bytes[offset + 8],
                    ]);

                    selected_protocol = match protocol_val {
                        0x00000000 => Some(Protocol::Rdp),
                        0x00000001 => Some(Protocol::Ssl),
                        0x00000002 => Some(Protocol::Hybrid),
                        0x00000008 => Some(Protocol::HybridEx),
                        _ => None,
                    };

                    negotiation_result = Some(flags);
                    offset += length as usize;
                }
            } else if neg_type == 0x0003 {
                // TYPE_RDP_NEG_FAILURE - negotiation failed
                let failure_code = u32::from_le_bytes([
                    bytes[offset + 5],
                    bytes[offset + 6],
                    bytes[offset + 7],
                    bytes[offset + 8],
                ]);

                return Err(RdpError::Connection(format!(
                    "RDP negotiation failed: code 0x{:08X}",
                    failure_code
                )));
            }
        }

        // Remaining data is the MCS Connect Response
        let response_data = bytes[offset..].to_vec();

        Ok(Self {
            selected_protocol,
            negotiation_result,
            response_data,
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

        // Check CR-TPDU type (0xE0 = CR + class 0)
        assert_eq!(bytes[0], 0xE0);
        // Check class 0
        assert_eq!(bytes[0] & 0x0F, 0x00);
        // Check RDP cookie is present
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("Cookie: mstshash=192.168.1.10"));
    }

    #[test]
    fn test_x224_connection_confirm_parsing() {
        // Mock X.224 Connection Confirm with RDP_NEG_RSP
        let response = vec![
            0x02, 0xF0, 0x80, // Connect Response TPDU header
            0x7F, 0x65,       // T.125 MCS Connect Response tag
            // RDP_NEG_RSP:
            0x01, 0x00,       // Type: TYPE_RDP_NEG_RSP (0x0001)
            0x00, 0x00,       // Flags
            0x08, 0x00, 0x00, 0x00, // Length: 8
            0x02, 0x00, 0x00, 0x00, // Selected protocol: HYBRID (0x00000002)
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
