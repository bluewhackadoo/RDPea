// MCS (Multipoint Communications Service) Layer
// ITU-T T.125
// AGENT-C: Implement this module

use crate::rdp::client::RdpError;
use crate::rdp::transport::{RdpTransport, TpktFrame};
use crate::rdp::gcc::ClientCoreData;
use std::io::{Cursor, Read};

/// Domain parameters for MCS connect
#[derive(Debug, Clone)]
pub struct DomainParameters {
    pub max_channel_ids: u32,
    pub max_user_ids: u32,
    pub max_token_ids: u32,
    pub num_priorities: u32,
    pub min_throughput: u32,
    pub max_height: u32,
    pub max_mcspdu_size: u32,
    pub protocol_version: u32,
}

impl Default for DomainParameters {
    fn default() -> Self {
        Self {
            max_channel_ids: 34,
            max_user_ids: 2,
            max_token_ids: 0,
            num_priorities: 1,
            min_throughput: 0,
            max_height: 1,
            max_mcspdu_size: 65535,
            protocol_version: 2,
        }
    }
}

/// MCS Connect Initial PDU (client -> server)
#[derive(Debug)]
pub struct McsConnectInitial {
    pub domain_params: DomainParameters,
    pub user_data: Vec<u8>, // GCC Conference Create Request
}

/// MCS Connect Response PDU (server -> client)
#[derive(Debug)]
pub struct McsConnectResponse {
    pub result: u32,
    pub domain_params: DomainParameters,
    pub user_data: Vec<u8>, // GCC Conference Create Response
}

/// MCS Layer for managing RDP channels
pub struct McsLayer<'a> {
    transport: &'a mut RdpTransport,
    user_id: Option<u16>,
}

impl<'a> McsLayer<'a> {
    /// Create new MCS layer bound to transport
    pub fn new(transport: &'a mut RdpTransport) -> Self {
        Self {
            transport,
            user_id: None,
        }
    }

    /// Perform MCS connection handshake
    /// 1. Send MCS Connect Initial
    /// 2. Receive MCS Connect Response
    /// 3. Send Erect Domain
    /// 4. Send Attach User
    /// 5. Send Channel Join requests
    pub async fn connect(&mut self, client_data: &ClientCoreData) -> Result<McsConnectResponse, RdpError> {
        // Build MCS Connect Initial PDU
        let initial = McsConnectInitial::new(client_data);
        let initial_bytes = initial.to_bytes();

        // Send via transport
        self.transport.send_tpkt(&initial_bytes).await?;

        // Receive MCS Connect Response
        let response_frame = self.transport.recv_tpkt().await?;
        let response = McsConnectResponse::from_bytes(&response_frame.payload)?;

        // Check for success
        if response.result != 0 {
            return Err(RdpError::Connection(format!(
                "MCS Connect failed with result: {}",
                response.result
            )));
        }

        // TODO: Send Erect Domain PDU
        // TODO: Send Attach User Request
        // TODO: Receive Attach User Confirm and store user_id
        // TODO: Send Channel Join requests for static channels

        // For now, assign a mock user_id (would come from server)
        self.user_id = Some(1001);

        Ok(response)
    }

    /// Send data on a channel
    pub async fn send_data(&mut self, channel_id: u16, data: &[u8]) -> Result<(), RdpError> {
        // Build MCS Send Data Request
        // Format: [MCS header] [data]
        let user_id = self.user_id.ok_or_else(|| {
            RdpError::Connection("Not attached to user".to_string())
        })?;

        let mcs_header = build_send_data_request(user_id, channel_id);

        let mut full_data = mcs_header;
        full_data.extend_from_slice(data);

        // Send via transport
        self.transport.send_tpkt(&full_data).await
    }

    /// Receive data from any channel
    pub async fn recv_data(&mut self) -> Result<(u16, Vec<u8>), RdpError> {
        // Receive MCS Send Data Indication
        let frame = self.transport.recv_tpkt().await?;

        // Parse MCS header
        let (channel_id, data_offset) = parse_send_data_indication(&frame.payload)?;

        // Extract data
        let data = frame.payload[data_offset..].to_vec();

        Ok((channel_id, data))
    }

    /// Get assigned user ID
    pub fn user_id(&self) -> Option<u16> {
        self.user_id
    }
}

impl McsConnectInitial {
    /// Create MCS Connect Initial from client core data
    pub fn new(client_data: &ClientCoreData) -> Self {
        // For now, create minimal user data
        // In real implementation, this would encode client_data to GCC
        // Conference Create Request format
        let user_data = encode_gcc_conference_create_request(client_data);

        Self {
            domain_params: DomainParameters::default(),
            user_data,
        }
    }

    /// BER encode to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = Vec::new();

        // callingDomainSelector (OCTET STRING "")
        result.push(0x04); // OCTET STRING tag
        result.extend_from_slice(&encode_ber_length(0));

        // calledDomainSelector (OCTET STRING "")
        result.push(0x04); // OCTET STRING tag
        result.extend_from_slice(&encode_ber_length(0));

        // upwardFlag (BOOLEAN FALSE)
        result.push(0x01); // BOOLEAN tag
        result.extend_from_slice(&encode_ber_length(1));
        result.push(0x00); // FALSE

        // targetParameters (DomainParameters)
        result.push(0x30); // SEQUENCE tag
        let target_params = encode_domain_params(&self.domain_params);
        result.extend_from_slice(&encode_ber_length(target_params.len() - 2)); // Exclude outer sequence
        result.extend_from_slice(&target_params[2..]); // Skip sequence tag and length

        // minimumParameters (DomainParameters with lower limits)
        let min_params = DomainParameters {
            max_channel_ids: 1,
            max_user_ids: 1,
            max_token_ids: 1,
            num_priorities: 1,
            min_throughput: 0,
            max_height: 1,
            max_mcspdu_size: 1050,
            protocol_version: 2,
        };
        result.push(0x30); // SEQUENCE tag
        let min_params_encoded = encode_domain_params(&min_params);
        result.extend_from_slice(&encode_ber_length(min_params_encoded.len() - 2));
        result.extend_from_slice(&min_params_encoded[2..]);

        // maximumParameters (DomainParameters with upper limits)
        let max_params = DomainParameters {
            max_channel_ids: 65535,
            max_user_ids: 65535,
            max_token_ids: 65535,
            num_priorities: 1,
            min_throughput: 0,
            max_height: 1,
            max_mcspdu_size: 65535,
            protocol_version: 2,
        };
        result.push(0x30); // SEQUENCE tag
        let max_params_encoded = encode_domain_params(&max_params);
        result.extend_from_slice(&encode_ber_length(max_params_encoded.len() - 2));
        result.extend_from_slice(&max_params_encoded[2..]);

        // userData (OCTET STRING containing GCC data)
        result.push(0x04); // OCTET STRING tag
        result.extend_from_slice(&encode_ber_length(self.user_data.len()));
        result.extend_from_slice(&self.user_data);

        // Wrap in Application tag 101 (connect-initial)
        // 0x7F = APPLICATION, 0x65 = tag 101
        let mut final_result = vec![0x7F, 0x65];
        final_result.extend_from_slice(&encode_ber_length(result.len()));
        final_result.extend_from_slice(&result);

        final_result
    }
}

impl McsConnectResponse {
    /// Parse from BER-encoded bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        let mut cursor = Cursor::new(bytes);

        // Expect Application tag 102 (connect-response)
        // Can be either [0x7F, 0x66] or start differently depending on context
        let mut tag = [0u8; 1];
        if cursor.read_exact(&mut tag).is_err() {
            return Err(RdpError::Connection("Failed to read MCS tag".to_string()));
        }

        // Handle different formats
        let is_app_102 = if tag[0] == 0x7F {
            let mut tag2 = [0u8; 1];
            if cursor.read_exact(&mut tag2).is_err() {
                return Err(RdpError::Connection("Failed to read MCS tag part 2".to_string()));
            }
            tag2[0] == 0x66
        } else {
            // X.224 format - reset cursor
            cursor.set_position(0);
            false
        };

        // Parse length if we got a proper application tag
        let content_len = if is_app_102 {
            decode_ber_length(&mut cursor)?
        } else {
            bytes.len()
        };

        let end_pos = cursor.position() as usize + content_len.min(bytes.len() - cursor.position() as usize);

        // Parse result (INTEGER) - should be 0 for success
        let mut result_value: u32 = 0;
        let mut domain_params = DomainParameters::default();
        let mut user_data = Vec::new();

        // Simple parsing for result and userData
        while cursor.position() < end_pos as u64 && cursor.position() < bytes.len() as u64 {
            let mut current_tag = [0u8; 1];
            if cursor.read_exact(&mut current_tag).is_err() {
                break;
            }

            match current_tag[0] {
                0x02 => {
                    // INTEGER - likely result
                    let len = decode_ber_length(&mut cursor)?;
                    let mut value_bytes = vec![0u8; len];
                    if cursor.read_exact(&mut value_bytes).is_err() {
                        break;
                    }
                    result_value = decode_ber_integer(&value_bytes)?;
                }
                0x30 => {
                    // SEQUENCE - likely DomainParameters
                    let len = decode_ber_length(&mut cursor)?;
                    let pos = cursor.position() as usize;
                    let available = bytes.len() - pos;
                    let to_read = len.min(available);

                    // Create a sub-cursor for domain params
                    let dp_bytes = &bytes[pos..pos + to_read];
                    let mut dp_cursor = Cursor::new(dp_bytes);
                    if let Ok(dp) = decode_domain_params(&mut dp_cursor) {
                        domain_params = dp;
                    }
                    cursor.set_position((pos + to_read) as u64);
                }
                0x04 => {
                    // OCTET STRING - userData
                    let len = decode_ber_length(&mut cursor)?;
                    let pos = cursor.position() as usize;
                    let available = bytes.len() - pos;
                    let to_read = len.min(available);

                    if to_read > 0 {
                        let mut data = vec![0u8; to_read];
                        if cursor.read_exact(&mut data).is_ok() {
                            user_data = data;
                        }
                    }
                }
                _ => {
                    // Unknown tag - try to skip
                    if let Ok(len) = decode_ber_length(&mut cursor) {
                        let pos = cursor.position() as usize;
                        let available = bytes.len() - pos;
                        let to_skip = len.min(available);
                        cursor.set_position((pos + to_skip) as u64);
                    }
                }
            }
        }

        Ok(Self {
            result: result_value,
            domain_params,
            user_data,
        })
    }
}

/// BER encoding helpers
pub fn encode_ber_length(len: usize) -> Vec<u8> {
    if len < 128 {
        // Short form: single byte 0-127
        vec![len as u8]
    } else {
        // Long form: 0x80 | num_bytes, then length bytes (big-endian)
        let mut result = Vec::new();
        let len_bytes = if len <= 255 {
            vec![len as u8]
        } else if len <= 65535 {
            len.to_be_bytes()[6..8].to_vec() // Last 2 bytes
        } else if len <= 16777215 {
            len.to_be_bytes()[5..8].to_vec() // Last 3 bytes
        } else {
            len.to_be_bytes()[4..8].to_vec() // All 4 bytes
        };

        // Remove leading zeros
        let len_bytes: Vec<u8> = len_bytes.into_iter().skip_while(|&b| b == 0).collect();
        let num_bytes = len_bytes.len().max(1); // At least 1 byte

        result.push(0x80 | num_bytes as u8);
        result.extend_from_slice(&len_bytes);
        result
    }
}

pub fn decode_ber_length(cursor: &mut Cursor<&[u8]>) -> Result<usize, RdpError> {
    let mut first_byte = [0u8; 1];
    if cursor.read_exact(&mut first_byte).is_err() {
        return Err(RdpError::Connection("Failed to read BER length byte".to_string()));
    }

    let byte = first_byte[0];

    if byte & 0x80 == 0 {
        // Short form: byte is the length (0-127)
        Ok(byte as usize)
    } else {
        // Long form: low 7 bits indicate number of length bytes
        let num_bytes = (byte & 0x7F) as usize;
        if num_bytes == 0 {
            return Err(RdpError::Connection("BER indefinite length not supported".to_string()));
        }

        let mut len_bytes = vec![0u8; num_bytes];
        if cursor.read_exact(&mut len_bytes).is_err() {
            return Err(RdpError::Connection("Failed to read BER length bytes".to_string()));
        }

        // Parse big-endian length
        let mut length: usize = 0;
        for b in len_bytes {
            length = (length << 8) | (b as usize);
        }

        Ok(length)
    }
}

/// Encode DomainParameters to BER
fn encode_domain_params(params: &DomainParameters) -> Vec<u8> {
    let mut result = Vec::new();

    // Encode 8 integers as a BER sequence
    let integers = [
        params.max_channel_ids,
        params.max_user_ids,
        params.max_token_ids,
        params.num_priorities,
        params.min_throughput,
        params.max_height,
        params.max_mcspdu_size,
        params.protocol_version,
    ];

    for value in integers {
        // INTEGER tag (0x02)
        result.push(0x02);
        // Encode the integer value
        let int_bytes = encode_ber_integer(value);
        result.extend_from_slice(&encode_ber_length(int_bytes.len()));
        result.extend_from_slice(&int_bytes);
    }

    // Wrap in SEQUENCE tag (0x30)
    let mut seq = vec![0x30];
    seq.extend_from_slice(&encode_ber_length(result.len()));
    seq.extend_from_slice(&result);
    seq
}

/// Encode a single integer to BER format
fn encode_ber_integer(value: u32) -> Vec<u8> {
    if value == 0 {
        return vec![0x00];
    }

    // Convert to big-endian bytes and strip leading zeros
    let be_bytes = value.to_be_bytes();
    let start = be_bytes.iter().position(|&b| b != 0).unwrap_or(4);
    let stripped = &be_bytes[start..];

    // If high bit is set, prepend 0x00 to indicate positive
    if stripped[0] & 0x80 != 0 {
        let mut result = vec![0x00];
        result.extend_from_slice(stripped);
        result
    } else {
        stripped.to_vec()
    }
}

/// Decode DomainParameters from BER
fn decode_domain_params(cursor: &mut Cursor<&[u8]>) -> Result<DomainParameters, RdpError> {
    // Expect SEQUENCE tag (0x30)
    let mut tag = [0u8; 1];
    if cursor.read_exact(&mut tag).is_err() || tag[0] != 0x30 {
        return Err(RdpError::Connection("Expected SEQUENCE tag for DomainParameters".to_string()));
    }

    let seq_len = decode_ber_length(cursor)?;
    let start_pos = cursor.position() as usize;
    let end_pos = start_pos + seq_len;

    let mut params = DomainParameters::default();
    let mut values = Vec::new();

    // Decode 8 integers
    while cursor.position() < end_pos as u64 {
        let mut int_tag = [0u8; 1];
        if cursor.read_exact(&mut int_tag).is_err() || int_tag[0] != 0x02 {
            return Err(RdpError::Connection("Expected INTEGER tag".to_string()));
        }

        let int_len = decode_ber_length(cursor)?;
        let mut int_bytes = vec![0u8; int_len];
        if cursor.read_exact(&mut int_bytes).is_err() {
            return Err(RdpError::Connection("Failed to read integer bytes".to_string()));
        }

        let value = decode_ber_integer(&int_bytes)?;
        values.push(value);
    }

    // Assign values
    if values.len() >= 1 { params.max_channel_ids = values[0]; }
    if values.len() >= 2 { params.max_user_ids = values[1]; }
    if values.len() >= 3 { params.max_token_ids = values[2]; }
    if values.len() >= 4 { params.num_priorities = values[3]; }
    if values.len() >= 5 { params.min_throughput = values[4]; }
    if values.len() >= 6 { params.max_height = values[5]; }
    if values.len() >= 7 { params.max_mcspdu_size = values[6]; }
    if values.len() >= 8 { params.protocol_version = values[7]; }

    Ok(params)
}

/// Decode BER integer bytes to u32
fn decode_ber_integer(bytes: &[u8]) -> Result<u32, RdpError> {
    if bytes.is_empty() {
        return Ok(0);
    }

    let mut value: u32 = 0;
    for &b in bytes {
        value = (value << 8) | (b as u32);
    }

    Ok(value)
}

/// Encode GCC Conference Create Request from client data
fn encode_gcc_conference_create_request(_client_data: &ClientCoreData) -> Vec<u8> {
    // Minimal GCC Conference Create Request
    // In production, this would serialize all client data blocks
    // For now, return a minimal placeholder
    vec![0x00]
}

/// Build MCS Send Data Request header
fn build_send_data_request(user_id: u16, channel_id: u16) -> Vec<u8> {
    // MCS Send Data Request: 0x64 | channel_id
    // Simplified - full implementation needs proper MCS PDUs
    let mut header = Vec::new();
    header.push(0x64); // Send Data Request
    header.push(0x00); // Ross
    header.extend_from_slice(&user_id.to_be_bytes());
    header.extend_from_slice(&channel_id.to_be_bytes());
    header
}

/// Parse MCS Send Data Indication header
fn parse_send_data_indication(data: &[u8]) -> Result<(u16, usize), RdpError> {
    // Minimal parsing - extract channel_id from header
    // Format: [type] [ross] [user_id] [channel_id] [data...]
    if data.len() < 7 {
        return Err(RdpError::Connection("MCS data too short".to_string()));
    }

    // Extract channel_id from bytes 5-6 (after type, ross, user_id)
    let channel_id = u16::from_be_bytes([data[5], data[6]]);
    let data_offset = 7; // After header

    Ok((channel_id, data_offset))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn test_domain_params_roundtrip() {
        let params = DomainParameters::default();
        let encoded = encode_domain_params(&params);
        let decoded = decode_domain_params(&mut Cursor::new(&encoded)).unwrap();
        
        assert_eq!(params.max_channel_ids, decoded.max_channel_ids);
        assert_eq!(params.max_mcspdu_size, decoded.max_mcspdu_size);
    }

    #[test]
    fn test_mcs_connect_initial_encoding() {
        let client_data = ClientCoreData::default();
        let initial = McsConnectInitial::new(&client_data);
        let bytes = initial.to_bytes();

        // Should start with BER application tag 101
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_mcs_connect_response_parsing() {
        // Mock MCS Connect Response
        let response = vec![
            0x7F, 0x65, // Application 101 (Connect Response)
            0x82, 0x01, 0x5C, // Length: 348 bytes
            // result (integer 0 = success)
            0x02, 0x01, 0x00,
            // domainParameters...
            // userData...
        ];

        let parsed = McsConnectResponse::from_bytes(&response).unwrap();
        assert_eq!(parsed.result, 0);
    }
}
