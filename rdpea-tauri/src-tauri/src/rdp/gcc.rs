// GCC (Generic Conference Control) Conference Data
// ITU-T T.124
// AGENT-D: Implement GCC data blocks

use crate::rdp::client::RdpError;

/// RDP Protocol Version
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum RdpVersion {
    V5_0 = 0x00080001,
    V5_1 = 0x00080004,
    V5_2 = 0x00080005,
    V6_0 = 0x00060000,
    V6_1 = 0x000A0001,
    V7_0 = 0x000A0002,
    V7_1 = 0x000A0003,
    V8_0 = 0x000A0004,
    V8_1 = 0x000A0005,
    V10_0 = 0x000A0006,
    V10_1 = 0x000A0007,
    V10_2 = 0x000A0008,
    V10_3 = 0x000A0009,
    V10_4 = 0x000A000A,
    V10_5 = 0x000A000B,
    V10_6 = 0x000A000C,
    V10_7 = 0x000A000D,
}

/// Client Core Data (sent in MCS Connect Initial)
/// TS_UD_CS_CORE
#[derive(Debug, Clone)]
pub struct ClientCoreData {
    pub version: RdpVersion,
    pub desktop_width: u16,
    pub desktop_height: u16,
    pub color_depth: u16,
    pub sas_sequence: u16,
    pub keyboard_layout: u32,
    pub client_build: u32,
    pub client_name: String,
    pub keyboard_type: u32,
    pub keyboard_subtype: u32,
    pub keyboard_function_key: u32,
    pub ime_file_name: String,
    pub post_beta2_color_depth: u16,
    pub client_product_id: u16,
    pub serial_number: u32,
    pub high_color_depth: u16,
    pub supported_color_depths: u16,
    pub early_capability_flags: u16,
}

/// Client Security Data (sent in MCS Connect Initial)
/// TS_UD_CS_SEC
#[derive(Debug, Clone)]
pub struct ClientSecurityData {
    pub encryption_methods: EncryptionMethod,
    pub ext_encryption_methods: u32,
}

/// Client Network Data (channel definitions)
/// TS_UD_CS_NET
#[derive(Debug, Clone)]
pub struct ClientNetworkData {
    pub channels: Vec<ChannelDef>,
}

/// Channel Definition
#[derive(Debug, Clone)]
pub struct ChannelDef {
    pub name: [u8; 8],
    pub options: ChannelOptions,
}

/// Encryption Methods
#[derive(Debug, Clone, Copy)]
pub struct EncryptionMethod(pub u32);

impl EncryptionMethod {
    pub const NONE: Self = Self(0x00000000);
    pub const _40BIT: Self = Self(0x00000001);
    pub const _128BIT: Self = Self(0x00000002);
    pub const _56BIT: Self = Self(0x00000008);
    pub const FIPS: Self = Self(0x00000010);
}

impl std::ops::BitOr for EncryptionMethod {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self::Output {
        Self(self.0 | rhs.0)
    }
}

impl EncryptionMethod {
    pub fn bits(&self) -> u32 {
        self.0
    }
}

/// Channel Options
#[derive(Debug, Clone, Copy)]
pub struct ChannelOptions(pub u32);

impl ChannelOptions {
    pub const NONE: Self = Self(0x00000000);
    pub const COMPRESS: Self = Self(0x00200000);
    pub const ENCRYPT_RDP: Self = Self(0x08000000);
    pub const ENCRYPT_SC: Self = Self(0x10000000);
    pub const ENCRYPT_CS: Self = Self(0x20000000);
    pub const PRIORITY_HIGH: Self = Self(0x04000000);
    pub const PRIORITY_MED: Self = Self(0x08000000);
    pub const PRIORITY_LOW: Self = Self(0x0C000000);
}

impl std::ops::BitOr for ChannelOptions {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self::Output {
        Self(self.0 | rhs.0)
    }
}

impl ChannelOptions {
    pub fn contains(&self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }
}

/// Server Data Block (from MCS Connect Response)
#[derive(Debug, Clone)]
pub enum ServerDataBlock {
    Core(ServerCoreData),
    Security(ServerSecurityData),
    Network(ServerNetworkData),
}

/// Server Core Data
/// TS_UD_SC_CORE
#[derive(Debug, Clone)]
pub struct ServerCoreData {
    pub version: RdpVersion,
    pub client_requested_protocols: u32,
}

/// Server Security Data
/// TS_UD_SC_SEC1
#[derive(Debug, Clone)]
pub struct ServerSecurityData {
    pub encryption_method: EncryptionMethod,
    pub encryption_level: u32,
    pub server_random: Vec<u8>,
    pub server_cert: Vec<u8>,
}

/// Server Network Data
/// TS_UD_SC_NET
#[derive(Debug, Clone)]
pub struct ServerNetworkData {
    pub channel_id_array: Vec<u16>,
    pub pad: u16,
}

impl Default for ClientCoreData {
    fn default() -> Self {
        Self {
            version: RdpVersion::V10_7,
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
            ime_file_name: String::new(),
            post_beta2_color_depth: 32,
            client_product_id: 1,
            serial_number: 0,
            high_color_depth: 32,
            supported_color_depths: 0x0007, // 8, 16, 32
            early_capability_flags: 0x0001, // RNS_UD_CS_SUPPORT_ERRINFO_PDU
        }
    }
}

impl ClientCoreData {
    /// Encode to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(320);

        // UserDataHeader: type (2 bytes) + length (2 bytes)
        // CS_CORE = 0xC001
        result.extend_from_slice(&0xC001u16.to_le_bytes());

        // Length will be calculated and patched in at the end
        let length_offset = result.len();
        result.extend_from_slice(&0u16.to_le_bytes()); // placeholder

        // version (4 bytes, little-endian)
        result.extend_from_slice(&(self.version as u32).to_le_bytes());

        // desktopWidth (2 bytes)
        result.extend_from_slice(&self.desktop_width.to_le_bytes());

        // desktopHeight (2 bytes)
        result.extend_from_slice(&self.desktop_height.to_le_bytes());

        // colorDepth (2 bytes) - usually 0x0001 for 32-bit (RNS_UD_COLOR_8BPP for protocol version)
        result.extend_from_slice(&self.color_depth.to_le_bytes());

        // SASSequence (2 bytes)
        result.extend_from_slice(&self.sas_sequence.to_le_bytes());

        // keyboardLayout (4 bytes)
        result.extend_from_slice(&self.keyboard_layout.to_le_bytes());

        // clientBuild (4 bytes)
        result.extend_from_slice(&self.client_build.to_le_bytes());

        // clientName (32 bytes, UTF-16LE, padded with nulls)
        result.extend_from_slice(&encode_utf16_le_fixed(&self.client_name, 32));

        // keyboardType (4 bytes)
        result.extend_from_slice(&self.keyboard_type.to_le_bytes());

        // keyboardSubType (4 bytes)
        result.extend_from_slice(&self.keyboard_subtype.to_le_bytes());

        // keyboardFunctionKey (4 bytes)
        result.extend_from_slice(&self.keyboard_function_key.to_le_bytes());

        // imeFileName (64 bytes, UTF-16LE, null-terminated and padded)
        result.extend_from_slice(&encode_utf16_le_fixed(&self.ime_file_name, 64));

        // postBeta2ColorDepth (2 bytes)
        result.extend_from_slice(&self.post_beta2_color_depth.to_le_bytes());

        // clientProductId (2 bytes)
        result.extend_from_slice(&self.client_product_id.to_le_bytes());

        // serialNumber (4 bytes)
        result.extend_from_slice(&self.serial_number.to_le_bytes());

        // highColorDepth (2 bytes)
        result.extend_from_slice(&self.high_color_depth.to_le_bytes());

        // supportedColorDepths (2 bytes)
        result.extend_from_slice(&self.supported_color_depths.to_le_bytes());

        // earlyCapabilityFlags (2 bytes)
        result.extend_from_slice(&self.early_capability_flags.to_le_bytes());

        // clientDigProductId (64 bytes, UTF-16LE, null-terminated)
        // Empty for now - just pad with nulls
        result.extend_from_slice(&vec![0u8; 64]);

        // connectionType (1 byte) - optional, skip for now
        // pad1octet (1 byte) - padding
        result.push(0);
        result.push(0);

        // serverSelectedProtocol (4 bytes) - 0 for client
        result.extend_from_slice(&0u32.to_le_bytes());

        // Patch the length field
        let total_len = result.len();
        result[length_offset..length_offset + 2].copy_from_slice(&(total_len as u16).to_le_bytes());

        result
    }

    /// Decode from bytes
    pub fn from_bytes(_bytes: &[u8]) -> Result<Self, RdpError> {
        // TODO: Parse TS_UD_CS_CORE structure
        // For now, return default
        Ok(Self::default())
    }
}

impl ClientSecurityData {
    pub fn new(encryption_methods: EncryptionMethod) -> Self {
        Self {
            encryption_methods,
            ext_encryption_methods: 0,
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(12);

        // UserDataHeader: type (2 bytes) + length (2 bytes)
        // CS_SECURITY = 0xC002
        result.extend_from_slice(&0xC002u16.to_le_bytes());
        result.extend_from_slice(&12u16.to_le_bytes()); // Total length

        // encryptionMethods (4 bytes)
        result.extend_from_slice(&self.encryption_methods.bits().to_le_bytes());

        // extEncryptionMethods (4 bytes)
        result.extend_from_slice(&self.ext_encryption_methods.to_le_bytes());

        result
    }
}

impl ClientNetworkData {
    pub fn new(channels: &[ChannelDef]) -> Self {
        Self {
            channels: channels.to_vec(),
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        // Header: 4 bytes (type + length)
        // Channel count: 4 bytes
        // Each channel: 12 bytes (8 name + 4 options)
        let total_len = 4 + 4 + (self.channels.len() * 12);
        let mut result = Vec::with_capacity(total_len);

        // UserDataHeader: type (2 bytes) + length (2 bytes)
        // CS_NET = 0xC003
        result.extend_from_slice(&0xC003u16.to_le_bytes());
        result.extend_from_slice(&(total_len as u16).to_le_bytes());

        // channelCount (4 bytes)
        result.extend_from_slice(&(self.channels.len() as u32).to_le_bytes());

        // channelDefArray (12 bytes per channel)
        for channel in &self.channels {
            // name (8 bytes, ASCII, null-padded)
            result.extend_from_slice(&channel.name);
            // options (4 bytes)
            result.extend_from_slice(&channel.options.0.to_le_bytes());
        }

        result
    }
}

impl ChannelDef {
    pub fn new(name: &str, options: ChannelOptions) -> Self {
        let mut name_bytes = [0u8; 8];
        for (i, b) in name.bytes().take(8).enumerate() {
            name_bytes[i] = b;
        }
        Self {
            name: name_bytes,
            options,
        }
    }
}

impl ServerDataBlock {
    /// Parse a server data block from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        if bytes.len() < 4 {
            return Err(RdpError::Connection("Server data block too short".to_string()));
        }

        // Read block type from header (little-endian)
        let block_type = u16::from_le_bytes([bytes[0], bytes[1]]);

        match block_type {
            0x0C01 => {
                // SC_CORE
                let core = ServerCoreData::from_bytes(&bytes[4..])?;
                Ok(Self::Core(core))
            }
            0x0C02 => {
                // SC_SECURITY
                let sec = ServerSecurityData::from_bytes(&bytes[4..])?;
                Ok(Self::Security(sec))
            }
            0x0C03 => {
                // SC_NET
                let net = ServerNetworkData::from_bytes(&bytes[4..])?;
                Ok(Self::Network(net))
            }
            _ => Err(RdpError::Connection(format!(
                "Unknown server data block type: 0x{:04X}",
                block_type
            ))),
        }
    }
}

impl ServerCoreData {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        if bytes.len() < 4 {
            return Err(RdpError::Connection("Server core data too short".to_string()));
        }

        // version (4 bytes, little-endian)
        let version_val = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);

        // Map to enum (simplified)
        let version = match version_val {
            0x00080001 => RdpVersion::V5_0,
            0x000A0007 => RdpVersion::V10_7,
            _ => RdpVersion::V10_7, // Default to latest
        };

        // clientRequestedProtocols (4 bytes) - if present
        let client_requested_protocols = if bytes.len() >= 8 {
            u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]])
        } else {
            0
        };

        Ok(Self {
            version,
            client_requested_protocols,
        })
    }
}

impl ServerSecurityData {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        if bytes.len() < 8 {
            return Err(RdpError::Connection("Server security data too short".to_string()));
        }

        // encryptionMethod (4 bytes)
        let enc_method = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);

        // encryptionLevel (4 bytes)
        let enc_level = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);

        // serverRandom and serverCertificate would follow
        // For now, return empty vecs

        Ok(Self {
            encryption_method: EncryptionMethod(enc_method),
            encryption_level: enc_level,
            server_random: Vec::new(),
            server_cert: Vec::new(),
        })
    }
}

impl ServerNetworkData {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        if bytes.len() < 4 {
            return Err(RdpError::Connection("Server network data too short".to_string()));
        }

        // MCSChannelId (2 bytes) - static channel
        // channelCount (2 bytes)
        let channel_count = u16::from_le_bytes([bytes[2], bytes[3]]) as usize;

        // channelIdArray (2 bytes per channel)
        let mut channel_id_array = Vec::with_capacity(channel_count);
        for i in 0..channel_count {
            if bytes.len() >= 4 + (i + 1) * 2 {
                let id = u16::from_le_bytes([bytes[4 + i * 2], bytes[4 + i * 2 + 1]]);
                channel_id_array.push(id);
            }
        }

        Ok(Self {
            channel_id_array,
            pad: 0,
        })
    }
}

/// Helper to encode UTF-16LE string with fixed length (padded with nulls)
pub fn encode_utf16_le_fixed(s: &str, len: usize) -> Vec<u8> {
    // Encode to UTF-16LE
    let mut encoded: Vec<u8> = s
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    // Pad with nulls or truncate to reach len bytes
    if encoded.len() < len {
        encoded.resize(len, 0);
    } else if encoded.len() > len {
        encoded.truncate(len);
    }

    encoded
}

/// Helper to decode UTF-16LE string, stopping at first null
pub fn decode_utf16_le_null_terminated(bytes: &[u8]) -> Result<String, RdpError> {
    // Find null terminator (two consecutive null bytes or end of even position)
    let mut end_pos = bytes.len();
    for i in (0..bytes.len()).step_by(2) {
        if i + 1 < bytes.len() && bytes[i] == 0 && bytes[i + 1] == 0 {
            end_pos = i;
            break;
        }
    }

    // Decode UTF-16LE up to null
    let utf16_units: Vec<u16> = bytes[..end_pos]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    String::from_utf16(&utf16_units)
        .map_err(|e| RdpError::Connection(format!("UTF-16 decode error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_core_data_encoding() {
        let core = ClientCoreData::default();
        let encoded = core.to_bytes();

        // Should be at least 216 bytes (minimum size)
        assert!(encoded.len() >= 216);

        // Check version bytes (little-endian)
        assert_eq!(encoded[4], 0x0D); // V10_7 = 0x000A000D
        assert_eq!(encoded[5], 0x00);
        assert_eq!(encoded[6], 0x0A);
        assert_eq!(encoded[7], 0x00);

        // Check desktop dimensions
        let width = u16::from_le_bytes([encoded[8], encoded[9]]);
        let height = u16::from_le_bytes([encoded[10], encoded[11]]);
        assert_eq!(width, 1920);
        assert_eq!(height, 1080);
    }

    #[test]
    fn test_client_security_data_encoding() {
        let security = ClientSecurityData::new(
            EncryptionMethod::FIPS | EncryptionMethod::_128BIT
        );
        let encoded = security.to_bytes();

        // Should be exactly 12 bytes (header + 2 fields)
        assert_eq!(encoded.len(), 12);

        // Check encryption methods flags
        let methods = u32::from_le_bytes([encoded[4], encoded[5], encoded[6], encoded[7]]);
        assert!(methods & EncryptionMethod::FIPS.bits() != 0);
        assert!(methods & EncryptionMethod::_128BIT.bits() != 0);
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

        // Should contain channel count (3)
        let count = u32::from_le_bytes([encoded[4], encoded[5], encoded[6], encoded[7]]);
        assert_eq!(count, 3);

        // 4 header + 4 channel count + 3 * 12 channel defs
        let expected_len = 4 + 4 + (3 * 12);
        assert_eq!(encoded.len(), expected_len);
    }

    #[test]
    fn test_server_core_data_parsing() {
        // Mock server core data block
        let server_data = vec![
            0x01, 0x0C, // Type: SC_CORE (0x0C01)
            0x08, 0x00, // Length: 8
            0x01, 0x00, 0x08, 0x00, // Version: RDP 5.0 = 0x00080001
        ];

        let block = ServerDataBlock::from_bytes(&server_data).unwrap();
        match block {
            ServerDataBlock::Core(core) => {
                assert_eq!(core.version, RdpVersion::V5_0);
            }
            _ => panic!("Expected Core block"),
        }
    }

    #[test]
    fn test_channel_def_name_truncation() {
        // Name longer than 8 chars should be truncated
        let def = ChannelDef::new("verylongchannelname", ChannelOptions::NONE);
        assert_eq!(&def.name, b"verylong");
    }

    #[test]
    fn test_utf16_encoding() {
        let encoded = encode_utf16_le_fixed("Test", 32);
        assert_eq!(encoded.len(), 32);

        // Should start with UTF-16LE encoded "Test"
        // 'T' = 0x54 0x00
        // 'e' = 0x65 0x00
        // 's' = 0x73 0x00
        // 't' = 0x74 0x00
        assert_eq!(&encoded[0..8], &[0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00]);

        // Rest should be nulls
        assert!(encoded[8..].iter().all(|&b| b == 0));
    }

    #[test]
    fn test_utf16_decoding() {
        let bytes = vec![
            0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, // "Test"
            0x00, 0x00, // null terminator
            0x00, 0x00, 0x00, 0x00, // extra padding
        ];

        let decoded = decode_utf16_le_null_terminated(&bytes).unwrap();
        assert_eq!(decoded, "Test");
    }
}
