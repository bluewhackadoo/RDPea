// RDP Protocol Constants and Types (MS-RDPBCGR) — direct port from TypeScript
use serde::{Deserialize, Serialize};

// ===== X.224 =====
pub const X224_TPDU_CONNECTION_REQUEST: u8 = 0xE0;
pub const X224_TPDU_CONNECTION_CONFIRM: u8 = 0xD0;
pub const X224_TPDU_DATA: u8 = 0xF0;

pub const TYPE_RDP_NEG_REQ: u8 = 0x01;

// Security protocols
pub const PROTOCOL_RDP: u32 = 0x00000000;
pub const PROTOCOL_SSL: u32 = 0x00000001;
pub const PROTOCOL_HYBRID: u32 = 0x00000002;

// ===== MCS (T.125) =====
pub const MCS_ERECT_DOMAIN_REQUEST: u8 = 1;
pub const MCS_ATTACH_USER_REQUEST: u8 = 10;
pub const MCS_ATTACH_USER_CONFIRM: u8 = 11;
pub const MCS_CHANNEL_JOIN_REQUEST: u8 = 14;
pub const MCS_CHANNEL_JOIN_CONFIRM: u8 = 15;
pub const MCS_SEND_DATA_REQUEST: u8 = 25;
pub const MCS_SEND_DATA_INDICATION: u8 = 26;
pub const MCS_DISCONNECT_PROVIDER_ULTIMATUM: u8 = 8;

// ===== GCC =====
pub const CS_CORE: u16 = 0xC001;
pub const CS_SECURITY: u16 = 0xC002;
pub const CS_NET: u16 = 0xC003;
pub const SC_CORE: u16 = 0x0C01;
pub const SC_SECURITY: u16 = 0x0C02;
pub const SC_NET: u16 = 0x0C03;

pub const RNS_UD_COLOR_8BPP: u16 = 0xCA01;
pub const HIGH_COLOR_24BPP: u16 = 0x0018;
pub const HIGH_COLOR_16BPP: u16 = 0x0010;
pub const HIGH_COLOR_15BPP: u16 = 0x000F;

// Encryption methods
pub const ENCRYPTION_FLAG_NONE: u32 = 0x00000000;
pub const ENCRYPTION_FLAG_40BIT: u32 = 0x00000001;
pub const ENCRYPTION_FLAG_128BIT: u32 = 0x00000002;
pub const ENCRYPTION_FLAG_56BIT: u32 = 0x00000008;

// ===== RDP Security Flags =====
pub const SEC_EXCHANGE_PKT: u32 = 0x0001;
pub const SEC_ENCRYPT: u32 = 0x0008;
pub const SEC_INFO_PKT: u32 = 0x0040;
pub const SEC_LICENSE_PKT: u32 = 0x0080;

// ===== Share Control PDU Types =====
pub const PDU_TYPE_DEMAND_ACTIVE: u16 = 0x11;
pub const PDU_TYPE_CONFIRM_ACTIVE: u16 = 0x13;
pub const PDU_TYPE_DEACTIVATE_ALL: u16 = 0x16;
pub const PDU_TYPE_DATA: u16 = 0x17;

// Share Data PDU Types (PDUType2)
pub const PDU_TYPE2_UPDATE: u8 = 2;
pub const PDU_TYPE2_CONTROL: u8 = 20;
pub const PDU_TYPE2_INPUT: u8 = 28;
pub const PDU_TYPE2_SYNCHRONIZE: u8 = 31;
pub const PDU_TYPE2_SAVE_SESSION_INFO: u8 = 38;
pub const PDU_TYPE2_FONTLIST: u8 = 39;
pub const PDU_TYPE2_FONTMAP: u8 = 40;
pub const PDU_TYPE2_SET_ERROR_INFO: u8 = 47;

// Update types
pub const UPDATE_TYPE_BITMAP: u16 = 1;

// Control actions
pub const CTRLACTION_COOPERATE: u16 = 0x0004;
pub const CTRLACTION_REQUEST_CONTROL: u16 = 0x0001;

// ===== Input Events =====
pub const INPUT_EVENT_SCANCODE: u16 = 0x0004;
pub const INPUT_EVENT_MOUSE: u16 = 0x8001;

pub const KBDFLAGS_EXTENDED: u16 = 0x0100;
pub const KBDFLAGS_RELEASE: u16 = 0x8000;

pub const PTRFLAGS_WHEEL: u16 = 0x0200;
pub const PTRFLAGS_WHEEL_NEGATIVE: u16 = 0x0100;
pub const PTRFLAGS_MOVE: u16 = 0x0800;
pub const PTRFLAGS_DOWN: u16 = 0x8000;
pub const PTRFLAGS_BUTTON1: u16 = 0x1000;
pub const PTRFLAGS_BUTTON2: u16 = 0x2000;
pub const PTRFLAGS_BUTTON3: u16 = 0x4000;

// ===== Capability Set Types =====
pub const CAPSTYPE_GENERAL: u16 = 0x0001;
pub const CAPSTYPE_BITMAP: u16 = 0x0002;
pub const CAPSTYPE_ORDER: u16 = 0x0003;
pub const CAPSTYPE_INPUT: u16 = 0x000D;
pub const CAPSTYPE_SOUND: u16 = 0x000C;
pub const CAPSTYPE_VIRTUAL_CHANNEL: u16 = 0x0014;

// ===== Virtual Channels =====
pub const CHANNEL_FLAG_FIRST: u32 = 0x00000001;
pub const CHANNEL_FLAG_LAST: u32 = 0x00000002;
pub const CHANNEL_FLAG_SHOW_PROTOCOL: u32 = 0x00000010;

pub const RDPSND_CHANNEL_NAME: &str = "rdpsnd";
pub const CLIPRDR_CHANNEL_NAME: &str = "cliprdr";
pub const RDPDR_CHANNEL_NAME: &str = "rdpdr";

// RDPSND PDU types
pub const RDPSND_CLOSE: u8 = 0x01;
pub const RDPSND_WAVE_INFO: u8 = 0x02;
pub const RDPSND_WAVE_CONFIRM: u8 = 0x05;
pub const RDPSND_TRAINING: u8 = 0x06;
pub const RDPSND_SERVER_AUDIO_FORMATS: u8 = 0x07;
pub const RDPSND_WAVE2: u8 = 0x0D;

pub const WAVE_FORMAT_PCM: u16 = 0x0001;

// CLIPRDR PDU types
pub const CB_MONITOR_READY: u16 = 0x0001;
pub const CB_FORMAT_LIST: u16 = 0x0002;
pub const CB_FORMAT_LIST_RESPONSE: u16 = 0x0003;
pub const CB_FORMAT_DATA_REQUEST: u16 = 0x0004;
pub const CB_FORMAT_DATA_RESPONSE: u16 = 0x0005;
pub const CB_CLIP_CAPS: u16 = 0x0007;

pub const CB_RESPONSE_OK: u16 = 0x0001;
pub const CB_RESPONSE_FAIL: u16 = 0x0002;
pub const CB_CAPSTYPE_GENERAL: u16 = 0x0001;
pub const CB_CAPS_VERSION_2: u32 = 0x00000002;
pub const CB_USE_LONG_FORMAT_NAMES: u32 = 0x00000002;

pub const CF_TEXT: u32 = 1;
pub const CF_UNICODETEXT: u32 = 13;

// ===== Interfaces =====

#[derive(Debug, Clone)]
pub struct RdpClientConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub domain: String,
    pub width: u32,
    pub height: u32,
    pub color_depth: u16,
    pub enable_audio: bool,
    pub enable_clipboard: bool,
    pub security: String,
}

#[derive(Debug, Clone)]
pub struct ChannelDef {
    pub name: String,
    pub options: u32,
    pub id: Option<u16>,
}

#[derive(Debug, Clone)]
pub struct BitmapRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub bitmap_width: u16,
    pub bitmap_height: u16,
    pub bits_per_pixel: u16,
    pub is_compressed: bool,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitmapRectIpc {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub data: Vec<u8>, // RGBA pixels
}

#[derive(Debug, Clone)]
pub struct AudioFormat {
    pub format_tag: u16,
    pub n_channels: u16,
    pub n_samples_per_sec: u32,
    pub n_avg_bytes_per_sec: u32,
    pub n_block_align: u16,
    pub w_bits_per_sample: u16,
    pub extra_data: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct ServerCoreData {
    pub rdp_version: u32,
    pub client_requested_protocols: u32,
    pub early_capability_flags: u32,
}

#[derive(Debug)]
pub struct ServerSecurityData {
    pub encryption_method: u32,
    pub encryption_level: u32,
    pub server_random: Option<Vec<u8>>,
    pub server_certificate: Option<Vec<u8>>,
}

#[derive(Debug)]
pub struct ServerNetworkData {
    pub mcs_channel_id: u16,
    pub channel_ids: Vec<u16>,
}

#[derive(Debug)]
pub struct ServerGccData {
    pub core: ServerCoreData,
    pub security: ServerSecurityData,
    pub network: ServerNetworkData,
}

// Connection phases
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConnectionPhase {
    X224,
    Nla,
    Mcs,
    Security,
    Licensing,
    Active,
    Data,
}
