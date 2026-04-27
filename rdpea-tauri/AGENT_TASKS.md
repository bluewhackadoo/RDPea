# Agent Task Specifications

## How to Use These Tasks

1. Each agent picks one component from below
2. Run `cargo test phase1_foundation_tests::<component>` to verify work
3. Submit PR when all tests for that component pass
4. Integration tests at phase level verify inter-component compatibility

---

## Phase 1: Foundation

### Agent A: TCP Transport + TPKT Framing
**File**: `src-tauri/src/rdp/transport.rs`
**Estimated Time**: 4-5 hours

#### Your Task
Replace the stub `RdpTransport` with a full TCP + TLS implementation.

#### Required Types
```rust
pub struct RdpTransport {
    stream: Option<TlsStream<TcpStream>>,
    read_buffer: Vec<u8>,
}

pub struct TpktFrame {
    pub version: u8,
    pub length: u16,
    pub payload: Vec<u8>,
}
```

#### Methods to Implement
```rust
impl RdpTransport {
    pub async fn connect(host: &str, port: u16) -> Result<Self, RdpError>;
    pub async fn upgrade_tls(&mut self) -> Result<(), RdpError>;
    pub async fn send_tpkt(&mut self, data: &[u8]) -> Result<(), RdpError>;
    pub async fn recv_tpkt(&mut self) -> Result<TpktFrame, RdpError>;
    pub async fn close(&mut self) -> Result<(), RdpError>;
}

impl TpktFrame {
    pub fn new(payload: &[u8]) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}
```

#### Test Command
```bash
cargo test phase1_foundation_tests::test_tpkt_frame
cargo test phase1_foundation_tests::test_tcp_transport_mock
```

#### References
- `electron/rdp/transport.ts` - TypeScript implementation
- https://docs.rs/tokio-native-tls/latest/
- RFC 2126 (TPKT)

---

### Agent B: X.224 Connection Negotiation
**File**: `src-tauri/src/rdp/protocol.rs` (X.224 section)
**Estimated Time**: 3-4 hours

#### Your Task
Implement X.224 Connection Request/Confirm PDUs with protocol negotiation.

#### Required Types
```rust
pub struct X224ConnectionRequest {
    pub cookie: Option<String>,
    pub protocols: Vec<Protocol>,
}

pub struct X224ConnectionConfirm {
    pub negotiation_result: Option<Protocol>,
    pub connect_response: Vec<u8>, // MCS data
}

pub enum Protocol {
    Rdp,      // Standard RDP security
    Ssl,      // SSL/TLS
    Hybrid,   // CredSSP
    HybridEx, // Extended CredSSP
}
```

#### Methods to Implement
```rust
impl X224ConnectionRequest {
    pub fn new() -> Self;
    pub fn with_rdp_cookie(mut self, host: &str) -> Self;
    pub fn with_negotiation_protocols(mut self, protocols: &[Protocol]) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl X224ConnectionConfirm {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}

pub fn negotiate_protocol(client_prefs: &[Protocol], server_offers: &[Protocol]) -> Option<Protocol>;
```

#### Test Command
```bash
cargo test phase1_foundation_tests::test_x224_connection_request
cargo test phase1_foundation_tests::test_x224_connection_confirm
cargo test phase1_foundation_tests::test_protocol_negotiation
```

#### References
- `electron/rdp/protocol.ts` - TypeScript X.224 implementation
- X.224 / ISO 8073 specification

---

### Agent C: MCS Layer
**File**: `src-tauri/src/rdp/mcs.rs` (new file)
**Estimated Time**: 4-5 hours

#### Your Task
Implement T.125 MCS (Multipoint Communications Service) layer.

#### Required Types
```rust
pub struct McsLayer<'a> {
    transport: &'a mut RdpTransport,
}

pub struct McsConnectInitial {
    pub domain_params: DomainParameters,
    pub user_data: Vec<u8>, // GCC data
}

pub struct McsConnectResponse {
    pub result: u32,
    pub domain_params: DomainParameters,
    pub user_data: Vec<u8>,
}

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
```

#### Methods to Implement
```rust
impl McsLayer<'_> {
    pub fn new(transport: &mut RdpTransport) -> Self;
    pub async fn connect(&mut self, client_data: &ClientCoreData) -> Result<McsConnectResponse, RdpError>;
    pub async fn send_data(&mut self, data: &[u8]) -> Result<(), RdpError>;
    pub async fn recv_data(&mut self) -> Result<Vec<u8>, RdpError>;
}

impl McsConnectInitial {
    pub fn new(client_data: &ClientCoreData) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl McsConnectResponse {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}

// BER encoding helpers
pub fn encode_ber_length(len: usize) -> Vec<u8>;
pub fn decode_ber_length(cursor: &mut impl Read) -> Result<usize, std::io::Error>;
```

#### Test Command
```bash
cargo test phase1_foundation_tests::test_mcs_connect_initial
cargo test phase1_foundation_tests::test_mcs_connect_response
cargo test phase1_foundation_tests::test_ber_length_encoding
cargo test phase1_foundation_tests::test_ber_length_decoding
```

#### References
- ITU-T T.125 specification
- `electron/rdp/mcs.ts` - if exists

---

### Agent D: GCC Conference Data
**File**: `src-tauri/src/rdp/gcc.rs` (new file)
**Estimated Time**: 4-5 hours

#### Your Task
Implement T.124 GCC (Generic Conference Control) data blocks.

#### Required Types
```rust
pub struct ClientCoreData {
    pub version: RdpVersion,
    pub desktop_width: u16,
    pub desktop_height: u16,
    pub color_depth: u16,
    pub keyboard_layout: u32,
    pub client_build: u32,
    pub client_name: String,
    pub keyboard_type: u32,
    pub keyboard_subtype: u32,
    pub keyboard_function_key: u32,
}

pub struct ClientSecurityData {
    pub encryption_methods: EncryptionMethod,
    pub ext_encryption_methods: u32,
}

pub struct ClientNetworkData {
    pub channels: Vec<ChannelDef>,
}

pub struct ChannelDef {
    pub name: [u8; 8],
    pub options: ChannelOptions,
}

pub enum ServerDataBlock {
    Core(ServerCoreData),
    Security(ServerSecurityData),
    Network(ServerNetworkData),
}

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
```

#### Methods to Implement
```rust
impl ClientCoreData {
    pub fn to_bytes(&self) -> Vec<u8>;
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}

impl ClientSecurityData {
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl ClientNetworkData {
    pub fn new(channels: &[ChannelDef]) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl ServerDataBlock {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}
```

#### Test Command
```bash
cargo test phase1_foundation_tests::test_client_core_data
cargo test phase1_foundation_tests::test_client_security_data
cargo test phase1_foundation_tests::test_channel_definitions
cargo test phase1_foundation_tests::test_server_core_data
```

#### References
- ITU-T T.124 specification
- MS-RDPBCGR 2.2.1.3

---

### Agent E: RSA Encryption (Initial Handshake)
**File**: `src-tauri/src/rdp/security.rs` (initial RSA)
**Estimated Time**: 3-4 hours

#### Your Task
Implement RSA encryption for the initial security handshake.

#### Required Types
```rust
pub struct SecurityLayer {
    client_random: [u8; 32],
    server_public_key: Option<Vec<u8>>,
    encryption_level: EncryptionLevel,
}

pub enum EncryptionLevel {
    None,
    Low,
    ClientCompatible,
    High,
    Fips,
}

pub enum EncryptionMethod {
    None = 0,
    Fips = 1,
    FortyBit = 2,
    OneTwentyEightBit = 4,
    FiftySixBit = 8,
}
```

#### Methods to Implement
```rust
impl SecurityLayer {
    pub fn new() -> Self;
    pub fn generate_client_random(&mut self) -> &[u8; 32];
    pub fn set_server_public_key(&mut self, key: Vec<u8>);
    pub fn encrypt_client_random(&self) -> Result<Vec<u8>, RdpError>;
    pub fn derive_keys(&mut self) -> Result<(), RdpError>;
}

pub fn rsa_encrypt(public_key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, RdpError>;
pub fn generate_random_bytes(len: usize) -> Vec<u8>;
```

#### Test Command
```bash
cargo test phase1_foundation_tests::test_client_random_generation
cargo test phase1_foundation_tests::test_rsa_encryption_mock
```

#### References
- PKCS#1 v1.5 RSA encryption
- MS-RDPBCGR 5.3

---

## Phase 2: Authentication

### Agent F: NTLMv2 Authentication
**File**: `src-tauri/src/rdp/ntlm.rs` (full implementation)
**Estimated Time**: 6-8 hours

#### Your Task
Implement NTLMv2 authentication (complex - requires focus).

#### Required Types
```rust
pub struct NtlmAuth {
    domain: String,
    username: String,
    password: String,
    client_challenge: [u8; 8],
    session_key: Option<[u8; 16]>,
}

pub struct NtlmType1 {
    pub flags: u32,
    pub workstation: String,
    pub domain: String,
}

pub struct NtlmType2 {
    pub challenge: [u8; 8],
    pub target_info: Vec<u8>,
    pub flags: u32,
}

pub struct NtlmType3 {
    pub lm_response: Vec<u8>,
    pub nt_response: Vec<u8>,
    pub domain: String,
    pub username: String,
    pub workstation: String,
    pub session_key: Vec<u8>,
}
```

#### Methods to Implement
```rust
impl NtlmAuth {
    pub fn new(domain: &str, username: &str, password: &str) -> Self;
    pub fn build_type1(&self) -> Vec<u8>;
    pub fn process_type2(&mut self, type2: &NtlmType2) -> Result<(), RdpError>;
    pub fn build_type3(&self) -> Vec<u8>;
    pub fn derive_session_key(&self) -> [u8; 16];
}

impl NtlmType2 {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}

// Helper functions
pub fn nt_password_hash(password: &str) -> [u8; 16];
pub fn ntlmv2_response(nt_hash: &[u8; 16], username: &str, domain: &str, 
                      challenge: &[u8; 8], client_challenge: &[u8; 8]) -> [u8; 24];
pub fn hmac_md5(key: &[u8], data: &[u8]) -> [u8; 16];
pub fn parse_domain_user(input: &str) -> (String, String);
```

#### Test Command
```bash
cargo test phase2_authentication_tests::test_ntlm_type1
cargo test phase2_authentication_tests::test_ntlm_type2
cargo test phase2_authentication_tests::test_ntlmv2_response
cargo test phase2_authentication_tests::test_nt_password_hash
cargo test phase2_authentication_tests::test_session_key
cargo test phase2_authentication_tests::test_ntlm_unicode
```

#### References
- MS-NLMP specification
- MS-RDPBCGR 5.4
- `electron/rdp/ntlm.ts` - TypeScript implementation

---

### Agent G: CredSSP (SPNEGO Wrapper)
**File**: `src-tauri/src/rdp/credssp.rs` (new file)
**Estimated Time**: 4-5 hours

#### Your Task
Implement CredSSP (Credential Security Support Provider).

#### Required Types
```rust
pub struct CredSSP<'a> {
    transport: &'a mut RdpTransport,
    ntlm: NtlmAuth,
    server_public_key: Vec<u8>,
    state: CredSSPState,
}

pub enum CredSSPState {
    Initial,
    Negotiating,
    Authenticating,
    Complete,
}

pub struct TsRequest {
    pub version: u32,
    pub nego_tokens: Option<Vec<u8>>,
    pub auth_info: Option<Vec<u8>>,
    pub pub_key_auth: Option<Vec<u8>>,
    pub error_code: Option<u32>,
}

pub struct TSCredentials {
    pub domain: String,
    pub username: String,
    pub password: String,
}
```

#### Methods to Implement
```rust
impl CredSSP<'_> {
    pub fn new(transport: &mut RdpTransport, ntlm: NtlmAuth, 
               server_key: Vec<u8>) -> Self;
    pub async fn authenticate(&mut self, username: &str, password: &str, 
                              domain: &str) -> Result<(), RdpError>;
    fn compute_pub_key_auth(&self, server_key: &[u8], session_key: &[u8]) -> Vec<u8>;
}

impl TsRequest {
    pub fn to_asn1(&self) -> Result<Vec<u8>, RdpError>;
    pub fn from_asn1(bytes: &[u8]) -> Result<Self, RdpError>;
}

impl TSCredentials {
    pub fn to_bytes(&self) -> Vec<u8>;
}

pub fn encrypt_credentials(credentials: &[u8], server_key: &[u8]) -> Result<Vec<u8>, RdpError>;
```

#### Test Command
```bash
cargo test phase2_authentication_tests::test_tsrequest_encoding
cargo test phase2_authentication_tests::test_tsrequest_parsing
cargo test phase2_authentication_tests::test_credssp_encryption
cargo test phase2_authentication_tests::test_public_key_binding
cargo test phase2_authentication_tests::test_full_credssp_handshake
```

#### References
- MS-CSSP specification
- CredSSP ASN.1 schema

---

## Phase 3: Session & Rendering

### Agent H: Session Initialization
**File**: `src-tauri/src/rdp/session.rs` (new file)
**Estimated Time**: 4-5 hours

#### Your Task
Implement session initialization and capability exchange.

#### Required Types
```rust
pub struct Session<'a> {
    transport: &'a mut RdpTransport,
    capabilities: Vec<CapabilitySet>,
    share_id: u32,
}

pub struct DemandActivePdu {
    pub share_id: u32,
    pub originator_id: u16,
    pub capability_sets: Vec<CapabilitySet>,
}

pub struct ConfirmActivePdu {
    pub share_id: u32,
    pub capability_sets: Vec<CapabilitySet>,
}

pub enum CapabilitySet {
    General(GeneralCapability),
    Bitmap(BitmapCapability),
    Order(OrderCapability),
    BitmapCache(BitmapCacheCapability),
    Control(ControlCapability),
    Activation(ActivationCapability),
    Pointer(PointerCapability),
    Share(ShareCapability),
    ColorCache(ColorCacheCapability),
    // ... more
}

pub enum CtrlAction {
    RequestControl = 1,
    GrantedControl = 2,
    Detach = 3,
    Cooperate = 4,
}
```

#### Methods to Implement
```rust
impl Session<'_> {
    pub fn new(transport: &mut RdpTransport) -> Self;
    pub async fn establish(&mut self) -> Result<(), RdpError>;
    pub async fn send_confirm_active(&mut self) -> Result<(), RdpError>;
    pub async fn send_synchronize(&mut self) -> Result<(), RdpError>;
    pub async fn send_control(&mut self, action: CtrlAction) -> Result<(), RdpError>;
    pub fn add_capability(&mut self, cap: CapabilitySet);
}

impl DemandActivePdu {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}

impl ConfirmActivePdu {
    pub fn new(share_id: u32, caps: Vec<CapabilitySet>) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl CapabilitySet {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
    pub fn to_bytes(&self) -> Vec<u8>;
}
```

#### Test Command
```bash
cargo test phase3_session_tests::test_demand_active
cargo test phase3_session_tests::test_confirm_active
cargo test phase3_session_tests::test_capability_sets
cargo test phase3_session_tests::test_synchronize_pdu
```

#### References
- MS-RDPBCGR 2.2.1.13 (Demand Active PDU)
- MS-RDPBCGR 2.2.1.14 (Confirm Active PDU)

---

### Agent I: Bitmap Decompression
**File**: `src-tauri/src/rdp/bitmap.rs` (full implementation)
**Estimated Time**: 5-6 hours

#### Your Task
Implement RLE bitmap decompression for screen rendering.

#### Required Types
```rust
pub struct BitmapCache {
    entries: HashMap<(u8, u16), Vec<u8>>, // (cache_id, cache_index)
    max_size: usize,
    current_size: usize,
}

pub struct BitmapRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub bpp: u8,
    pub data: Vec<u8>, // Decompressed RGBA
}
```

#### Methods to Implement
```rust
impl BitmapCache {
    pub fn new(max_size: usize) -> Self;
    pub fn insert(&mut self, cache_id: u8, index: u16, data: Vec<u8>);
    pub fn get(&self, cache_id: u8, index: u16) -> Option<&Vec<u8>>;
}

// Decompression functions
pub fn decompress_bitmap_8bpp(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;
pub fn decompress_bitmap_16bpp(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;
pub fn decompress_bitmap_24bpp(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;
pub fn decompress_bitmap_32bpp(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;

// Format conversion
pub fn bgr24_to_rgba32(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;
pub fn bgra32_to_rgba32(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;
pub fn r565_to_rgba32(data: &[u8], width: u16, height: u16) -> Result<Vec<u8>, RdpError>;
```

#### Test Command
```bash
cargo test phase3_session_tests::test_8bpp_rle
cargo test phase3_session_tests::test_16bpp_r565
cargo test phase3_session_tests::test_24bpp_raw
cargo test phase3_session_tests::test_32bpp_rgba
cargo test phase3_session_tests::test_bitmap_cache
```

#### References
- MS-RDPBCGR 3.1.9 (Bitmap Updates)
- `electron/rdp/bitmap.ts` - TypeScript implementation

---

## Phase 4: Input & Channels

### Agent J: Input Handling (Fast-Path)
**File**: `src-tauri/src/rdp/input.rs` (full implementation)
**Estimated Time**: 3-4 hours

#### Your Task
Implement fast-path input encoding for keyboard and mouse.

#### Required Types
```rust
pub struct FastPathInput {
    pub flags: u8,
    pub events: Vec<InputEvent>,
}

pub enum InputEvent {
    Keyboard(KeyboardEvent),
    Mouse(MouseEvent),
    Unicode(UnicodeEvent),
}

pub struct KeyboardEvent {
    pub scan_code: u8,
    pub flags: u8, // Extended, down/up
}

pub struct MouseEvent {
    pub flags: u16,
    pub x: u16,
    pub y: u16,
}

pub struct UnicodeEvent {
    pub code: u16,
    pub flags: u16,
}

pub struct InputThrottle {
    last_send: Instant,
    min_interval: Duration,
}
```

#### Methods to Implement
```rust
impl FastPathInput {
    pub fn keyboard_down(scancode: u8, extended: bool) -> Self;
    pub fn keyboard_up(scancode: u8, extended: bool) -> Self;
    pub fn mouse(x: u16, y: u16, button: MouseButton, pressed: bool) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl InputThrottle {
    pub fn new(fps: u32) -> Self;
    pub fn should_send(&mut self, now: Instant) -> bool;
}

pub fn scancode_to_rdp(scancode: u16, extended: bool) -> u16;
```

#### Test Command
```bash
cargo test phase4_input_tests::test_fast_path_keyboard
cargo test phase4_input_tests::test_fast_path_mouse
cargo test phase4_input_tests::test_scancode_mapping
cargo test phase4_input_tests::test_input_throttling
```

#### References
- MS-RDPBCGR 2.2.8.1.2 (Fast-Path Input Event)
- `electron/rdp/input.ts` - TypeScript implementation

---

### Agent K: RDPSND (Audio Output)
**File**: `src-tauri/src/rdp/channels/rdpsnd.rs` (new file)
**Estimated Time**: 4-5 hours

#### Your Task
Implement RDPSND virtual channel for audio output.

#### Required Types
```rust
pub struct RdpsndChannel {
    formats: Vec<AudioFormat>,
    current_format: Option<AudioFormat>,
}

pub struct AudioFormat {
    pub w_format_tag: u16,
    pub n_channels: u16,
    pub n_samples_per_sec: u32,
    pub n_avg_bytes_per_sec: u32,
    pub n_block_align: u16,
    pub w_bits_per_sample: u16,
    pub cb_size: u16,
    pub data: Vec<u8>, // Extra format data
}

pub enum RdpsndPdu {
    ServerAudioVersion(u16, u16),
    ClientAudioVersion(u16, u16),
    Training { timestamp: u16, pack_size: u16 },
    TrainingConfirm { timestamp: u16, pack_size: u16 },
    WaveInfo { timestamp: u16, format: u16, block: u16, tick: u32 },
    Wave { data: Vec<u8> },
    Close,
}
```

#### Methods to Implement
```rust
impl RdpsndChannel {
    pub fn new() -> Self;
    pub fn process_pdu(&mut self, pdu: RdpsndPdu) -> Option<RdpsndPdu>;
    pub fn set_format_list(&mut self, formats: Vec<AudioFormat>);
}

impl AudioFormat {
    pub fn pcm(channels: u16, sample_rate: u32, bits_per_sample: u16) -> Self;
    pub fn to_bytes(&self) -> Vec<u8>;
}

impl RdpsndPdu {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
    pub fn to_bytes(&self) -> Vec<u8>;
}
```

#### Test Command
```bash
cargo test phase4_input_tests::test_rdpsnd_version
cargo test phase4_input_tests::test_rdpsnd_formats
cargo test phase4_input_tests::test_rdpsnd_wave
```

---

### Agent L: CLIPRDR (Clipboard)
**File**: `src-tauri/src/rdp/channels/cliprdr.rs` (new file)
**Estimated Time**: 4-5 hours

#### Your Task
Implement CLIPRDR virtual channel for clipboard sharing.

#### Required Types
```rust
pub struct CliprdrChannel {
    formats: Vec<ClipboardFormat>,
    local_data: Option<Vec<u8>>,
}

pub enum ClipboardFormat {
    Text = 1,
    Bitmap = 2,
    Metafile = 3,
    Sylk = 4,
    Dif = 5,
    Tiff = 6,
    OemText = 7,
    Dib = 8,
    Palette = 9,
    PenData = 10,
    Riff = 11,
    Wave = 12,
    UnicodeText = 13,
    Html = 0xD010,
    // ... more
}

pub enum CliprdrPdu {
    ClipboardCapabilities,
    MonitorReady,
    FormatList(Vec<ClipboardFormat>),
    FormatListResponse(bool),
    FormatDataRequest(ClipboardFormat),
    FormatDataResponse(Option<Vec<u8>>),
}
```

#### Methods to Implement
```rust
impl CliprdrChannel {
    pub fn new() -> Self;
    pub fn process_pdu(&mut self, pdu: CliprdrPdu) -> Option<CliprdrPdu>;
    pub fn set_local_text(&mut self, text: &str);
    pub fn get_remote_text(&self) -> Option<String>;
}

impl CliprdrPdu {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
    pub fn to_bytes(&self) -> Vec<u8>;
}
```

#### Test Command
```bash
cargo test phase4_input_tests::test_clipboard_format_list
cargo test phase4_input_tests::test_clipboard_data_request
cargo test phase4_input_tests::test_clipboard_data_response
cargo test phase4_input_tests::test_clipboard_roundtrip
```

---

## Phase 5: Integration

### Agent M: Update Processing + Wire-Up
**Files**: `src-tauri/src/rdp/update.rs`, `src-tauri/src/rdp/client.rs`
**Estimated Time**: 6-8 hours

#### Your Task
Implement update processing loop and wire up full client.

#### Required Types
```rust
pub struct UpdateProcessor<'a> {
    transport: &'a mut RdpTransport,
    bitmap_cache: BitmapCache,
}

pub enum UpdateType {
    Synchronize,
    Bitmap,
    Palette,
    Orders,
    // ...
}

pub struct BitmapUpdatePdu {
    pub rectangles: Vec<BitmapRectIpc>,
}

pub struct FastPathUpdate {
    pub update_type: UpdateType,
    pub data: Vec<u8>,
}
```

#### Methods to Implement
```rust
impl UpdateProcessor<'_> {
    pub fn new(transport: &mut RdpTransport) -> Self;
    pub async fn process_updates(&mut self, handler: &dyn Fn(RdpEvent)) -> Result<(), RdpError>;
    fn process_bitmap_update(&mut self, data: &[u8]) -> Result<Vec<BitmapRectIpc>, RdpError>;
    fn process_fast_path(&mut self, header: u8, data: &[u8]) -> Result<FastPathUpdate, RdpError>;
}

impl BitmapUpdatePdu {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}

impl FastPathUpdate {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError>;
}
```

#### Wire Up Client
Replace stub methods in `client.rs`:
```rust
impl RdpClient {
    pub async fn connect(&mut self) -> Result<(), RdpError> {
        // 1. TCP connect
        // 2. X.224 negotiate
        // 3. MCS connect
        // 4. CredSSP auth
        // 5. Session init
        // 6. Start update loop
    }
    
    pub async fn disconnect(&mut self) {
        // Clean shutdown
    }
    
    pub async fn send_keyboard(&self, event: &str, scancode: u16, extended: bool) {
        // Send fast-path input
    }
    
    pub async fn send_mouse(&self, event: &str, x: u16, y: u16, button: Option<&str>) {
        // Send fast-path input
    }
}
```

#### Test Command
```bash
# Phase-level integration tests
cargo test phase1_foundation_tests::test_phase1_connection_flow
cargo test phase2_authentication_tests::test_full_credssp_handshake
cargo test phase3_session_tests::test_session_handshake
cargo test phase4_input_tests::test_input_roundtrip
cargo test phase4_input_tests::test_clipboard_roundtrip
cargo test phase5_integration_tests::test_full_connection_flow
cargo test phase5_integration_tests::test_e2e_user_workflow
```

---

## Running All Tests

```bash
# Run all tests
cargo test

# Run specific phase
cargo test phase1_foundation_tests
cargo test phase2_authentication_tests
cargo test phase3_session_tests
cargo test phase4_input_tests
cargo test phase5_integration_tests

# Run specific component
cargo test phase1_foundation_tests::test_tpkt_frame
```

---

## Submission Checklist

Before submitting your component:

- [ ] All unit tests for your component pass
- [ ] No compiler warnings in your code
- [ ] Code follows Rust naming conventions (snake_case)
- [ ] Documentation comments on all public types and methods
- [ ] Error handling uses `RdpError` type appropriately
- [ ] Integration test for your phase passes (if applicable)
