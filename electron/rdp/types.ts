// RDP Protocol Constants and Types (MS-RDPBCGR)

// ===== X.224 =====
export const X224_TPDU_CONNECTION_REQUEST = 0xE0;
export const X224_TPDU_CONNECTION_CONFIRM = 0xD0;
export const X224_TPDU_DATA = 0xF0;
export const X224_TPDU_DISCONNECT_REQUEST = 0x80;

// Negotiation types
export const TYPE_RDP_NEG_REQ = 0x01;
export const TYPE_RDP_NEG_RSP = 0x02;
export const TYPE_RDP_NEG_FAILURE = 0x03;

// Security protocols
export const PROTOCOL_RDP = 0x00000000;
export const PROTOCOL_SSL = 0x00000001;
export const PROTOCOL_HYBRID = 0x00000002; // NLA (CredSSP + TLS)
export const PROTOCOL_RDSTLS = 0x00000004;
export const PROTOCOL_HYBRID_EX = 0x00000008;

// ===== MCS (T.125) =====
export enum MCSPDUType {
  CONNECT_INITIAL = 101,
  CONNECT_RESPONSE = 102,
  ERECT_DOMAIN_REQUEST = 1,
  ATTACH_USER_REQUEST = 10,
  ATTACH_USER_CONFIRM = 11,
  CHANNEL_JOIN_REQUEST = 14,
  CHANNEL_JOIN_CONFIRM = 15,
  SEND_DATA_REQUEST = 25,
  SEND_DATA_INDICATION = 26,
  DISCONNECT_PROVIDER_ULTIMATUM = 8,
}

// ===== GCC =====
export const GCC_CREATE_REQUEST_TAG = 0x0001;

// Client core data types
export const CS_CORE = 0xC001;
export const CS_SECURITY = 0xC002;
export const CS_NET = 0xC003;
export const CS_CLUSTER = 0xC004;
export const CS_MONITOR = 0xC005;

export const SC_CORE = 0x0C01;
export const SC_SECURITY = 0x0C02;
export const SC_NET = 0x0C03;

// Color depths
export const RNS_UD_COLOR_8BPP = 0xCA01;
export const RNS_UD_COLOR_16BPP_555 = 0xCA02;
export const RNS_UD_COLOR_16BPP_565 = 0xCA03;
export const RNS_UD_COLOR_24BPP = 0xCA04;

export const HIGH_COLOR_24BPP = 0x0018;
export const HIGH_COLOR_16BPP = 0x0010;
export const HIGH_COLOR_15BPP = 0x000F;

// Encryption methods
export const ENCRYPTION_FLAG_NONE = 0x00000000;
export const ENCRYPTION_FLAG_40BIT = 0x00000001;
export const ENCRYPTION_FLAG_128BIT = 0x00000002;
export const ENCRYPTION_FLAG_56BIT = 0x00000008;
export const ENCRYPTION_FLAG_FIPS = 0x00000010;

// ===== RDP Security =====
export const SEC_EXCHANGE_PKT = 0x0001;
export const SEC_ENCRYPT = 0x0008;
export const SEC_RESET_SEQNO = 0x0010;
export const SEC_IGNORE_SEQNO = 0x0020;
export const SEC_INFO_PKT = 0x0040;
export const SEC_LICENSE_PKT = 0x0080;
export const SEC_LICENSE_ENCRYPT_CS = 0x0200;
export const SEC_LICENSE_ENCRYPT_SC = 0x0200;
export const SEC_REDIRECTION_PKT = 0x0400;
export const SEC_SECURE_CHECKSUM = 0x0800;
export const SEC_AUTODETECT_REQ = 0x1000;
export const SEC_AUTODETECT_RSP = 0x2000;
export const SEC_HEARTBEAT = 0x4000;
export const SEC_FLAGSHI_VALID = 0x8000;

// ===== RDP Share Data =====
export enum PDUType {
  DEMAND_ACTIVE = 0x11,
  CONFIRM_ACTIVE = 0x13,
  DEACTIVATE_ALL = 0x16,
  DATA = 0x17,
  SERVER_REDIR = 0x1A,
}

export enum PDUType2 {
  UPDATE = 2,
  CONTROL = 20,
  POINTER = 27,
  INPUT = 28,
  SYNCHRONIZE = 31,
  REFRESH_RECT = 33,
  PLAY_SOUND = 34,
  SUPPRESS_OUTPUT = 35,
  SHUTDOWN_REQ = 36,
  SHUTDOWN_DENIED = 37,
  SAVE_SESSION_INFO = 38,
  FONTLIST = 39,
  FONTMAP = 40,
  SET_KEYBOARD_INDICATORS = 41,
  SET_KEYBOARD_IME_STATUS = 45,
  SET_ERROR_INFO = 47,
  DRAW_NINEGRID_ERROR = 48,
  DRAW_GDIPLUS_ERROR = 49,
  ARC_STATUS = 50,
  STATUS_INFO = 54,
  MONITOR_LAYOUT = 55,
}

// Update types
export enum UpdateType {
  ORDERS = 0,
  BITMAP = 1,
  PALETTE = 2,
  SYNCHRONIZE = 3,
}

// ===== Input Events =====
export enum InputEventType {
  SYNC = 0x0000,
  SCANCODE = 0x0004,
  UNICODE = 0x0005,
  MOUSE = 0x8001,
  MOUSEX = 0x8002,
}

// Keyboard flags
export const KBDFLAGS_EXTENDED = 0x0100;
export const KBDFLAGS_EXTENDED1 = 0x0200;
export const KBDFLAGS_DOWN = 0x4000;
export const KBDFLAGS_RELEASE = 0x8000;

// Mouse flags
export const PTRFLAGS_HWHEEL = 0x0400;
export const PTRFLAGS_WHEEL = 0x0200;
export const PTRFLAGS_WHEEL_NEGATIVE = 0x0100;
export const PTRFLAGS_MOVE = 0x0800;
export const PTRFLAGS_DOWN = 0x8000;
export const PTRFLAGS_BUTTON1 = 0x1000; // left
export const PTRFLAGS_BUTTON2 = 0x2000; // right
export const PTRFLAGS_BUTTON3 = 0x4000; // middle

// ===== Capabilities =====
export enum CapabilitySetType {
  GENERAL = 0x0001,
  BITMAP = 0x0002,
  ORDER = 0x0003,
  BITMAP_CACHE = 0x0004,
  CONTROL = 0x0005,
  ACTIVATION = 0x0007,
  POINTER = 0x0008,
  SHARE = 0x0009,
  COLOR_CACHE = 0x000A,
  SOUND = 0x000C,
  INPUT = 0x000D,
  FONT = 0x000E,
  BRUSH = 0x000F,
  GLYPH_CACHE = 0x0010,
  OFFSCREEN_BITMAP_CACHE = 0x0011,
  BITMAP_CACHE_V2 = 0x0013,
  VIRTUAL_CHANNEL = 0x0014,
  DRAW_NINEGRID_CACHE = 0x0015,
  DRAW_GDIPLUS_CACHE = 0x0016,
  RAIL = 0x0017,
  WINDOW = 0x0018,
  COMP_DESK = 0x0019,
  MULTIFRAGMENT_UPDATE = 0x001A,
  LARGE_POINTER = 0x001B,
  SURFACE_COMMANDS = 0x001C,
  BITMAP_CODECS = 0x001D,
  FRAME_ACKNOWLEDGE = 0x001E,
}

// Control actions
export const CTRLACTION_REQUEST_CONTROL = 0x0001;
export const CTRLACTION_GRANTED_CONTROL = 0x0002;
export const CTRLACTION_DETACH = 0x0003;
export const CTRLACTION_COOPERATE = 0x0004;

// ===== Virtual Channels =====
export const CHANNEL_FLAG_FIRST = 0x00000001;
export const CHANNEL_FLAG_LAST = 0x00000002;
export const CHANNEL_FLAG_SHOW_PROTOCOL = 0x00000010;

// RDPSND (Audio Output)
export const RDPSND_CHANNEL_NAME = 'rdpsnd';
export const CLIPRDR_CHANNEL_NAME = 'cliprdr';
export const RDPDR_CHANNEL_NAME = 'rdpdr';

export enum RdpSndPDUType {
  CLOSE = 0x01,
  WAVE_INFO = 0x02,
  SET_VOLUME = 0x03,
  WAVE_CONFIRM = 0x05,
  TRAINING = 0x06,
  TRAINING_CONFIRM = 0x06,
  SERVER_AUDIO_VERSION_AND_FORMATS = 0x07,
  CLIENT_AUDIO_VERSION_AND_FORMATS = 0x07,
  WAVE2 = 0x0D,
}

// Audio format tags
export const WAVE_FORMAT_PCM = 0x0001;
export const WAVE_FORMAT_ADPCM = 0x0002;
export const WAVE_FORMAT_ALAW = 0x0006;
export const WAVE_FORMAT_MULAW = 0x0007;

// ===== CLIPRDR (Clipboard Redirection) — MS-RDPECLIP =====
export enum ClipPDUType {
  CB_MONITOR_READY = 0x0001,
  CB_FORMAT_LIST = 0x0002,
  CB_FORMAT_LIST_RESPONSE = 0x0003,
  CB_FORMAT_DATA_REQUEST = 0x0004,
  CB_FORMAT_DATA_RESPONSE = 0x0005,
  CB_TEMP_DIRECTORY = 0x0006,
  CB_CLIP_CAPS = 0x0007,
  CB_FILECONTENTS_REQUEST = 0x0008,
  CB_FILECONTENTS_RESPONSE = 0x0009,
  CB_LOCK_CLIPDATA = 0x000A,
  CB_UNLOCK_CLIPDATA = 0x000B,
}

// CLIPRDR message flags
export const CB_RESPONSE_OK = 0x0001;
export const CB_RESPONSE_FAIL = 0x0002;
export const CB_ASCII_NAMES = 0x0004;

// CLIPRDR capability constants
export const CB_CAPSTYPE_GENERAL = 0x0001;
export const CB_CAPS_VERSION_2 = 0x00000002;
export const CB_USE_LONG_FORMAT_NAMES = 0x00000002;
export const CB_STREAM_FILECLIP_ENABLED = 0x00000004;
export const CB_FILECLIP_NO_FILE_PATHS = 0x00000008;
export const CB_CAN_LOCK_CLIPDATA = 0x00000010;

// Standard Windows clipboard format IDs
export const CF_TEXT = 1;
export const CF_UNICODETEXT = 13;

// ===== Interfaces =====
export interface RdpClientConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  domain: string;
  width: number;
  height: number;
  colorDepth: 15 | 16 | 24 | 32;
  enableAudio: boolean;
  enableClipboard: boolean;
  security: 'any' | 'nla' | 'tls' | 'rdp';
}

export interface BitmapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  bitmapWidth: number;
  bitmapHeight: number;
  bitsPerPixel: number;
  isCompressed: boolean;
  data: Buffer;
}

export interface FrameUpdate {
  rects: BitmapRect[];
}

export interface ServerCoreData {
  rdpVersion: number;
  clientRequestedProtocols: number;
  earlyCapabilityFlags: number;
}

export interface ServerSecurityData {
  encryptionMethod: number;
  encryptionLevel: number;
  serverRandom?: Buffer;
  serverCertificate?: Buffer;
  serverPublicKey?: {
    modulus: Buffer;
    exponent: number;
  };
}

export interface ServerNetworkData {
  MCSChannelId: number;
  channelIds: number[];
}

export interface ChannelDef {
  name: string;
  options: number;
  id?: number;
}

export interface AudioFormat {
  formatTag: number;
  nChannels: number;
  nSamplesPerSec: number;
  nAvgBytesPerSec: number;
  nBlockAlign: number;
  wBitsPerSample: number;
  extraData?: Buffer;
}
