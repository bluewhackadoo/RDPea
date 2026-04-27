# RDP Protocol Implementation Roadmap

## Token & Effort Estimates

**20-30 hours of human development ≈ 50K-100K tokens generated**
- Includes code, tests, documentation, and iterative fixes
- Complex binary protocol work requires careful verification
- Each component needs: implementation + unit tests + integration

---

## Feature Components (Taskable to Agents)

### 1. TCP Transport Layer ⏱️ 3-4 hrs (~8K tokens)
**File**: `src-tauri/src/rdp/transport.rs`

**Tasks**:
- [ ] TCP socket connection with tokio::net::TcpStream
- [ ] TLS upgrade using native-tls with certificate validation
- [ ] TPKT (RFC 2126) frame encoding/decoding
- [ ] Connection timeout and error handling
- [ ] Async read/write loops with proper buffering

**Acceptance Criteria**:
```rust
let transport = RdpTransport::connect("192.168.1.10", 3389).await?;
transport.upgrade_tls().await?;
transport.send_tpkt(&data).await?;
let response = transport.recv_tpkt().await?;
```

---

### 2. X.224 Connection Negotiation ⏱️ 3-4 hrs (~8K tokens)
**File**: `src-tauri/src/rdp/protocol.rs` (initial module)

**Tasks**:
- [ ] X.224 Connection Request PDU builder
- [ ] X.224 Connection Confirm parser (with negotiation flags)
- [ ] Protocol version negotiation (RDP 5.x, 10.x)
- [ ] Security layer selection (None, SSL, Hybrid)
- [ ] Cookie/mcs channel ID handling

**Acceptance Criteria**:
- Parse flags: EXTENDED_CLIENT_DATA_SUPPORTED, DYNVC_GFX_PROTOCOL_SUPPORTED
- Negotiate encryption level: ENCRYPTION_NONE → HYBRID
- Return negotiated protocol version to caller

---

### 3. MCS Layer (Multipoint Communications Service) ⏱️ 4-5 hrs (~10K tokens)
**File**: `src-tauri/src/rdp/mcs.rs` (new module)

**Tasks**:
- [ ] MCS Connect Initial encoding (client→server)
- [ ] MCS Connect Response decoding (server→client)
- [ ] Domain parameters (max_channels, max_pdu_size) handling
- [ ] BER encoding helpers for MCS structures
- [ ] Channel attach/join user

**Acceptance Criteria**:
```rust
let mcs = McsLayer::new(&transport);
mcs.connect_initial(&client_data).await?;
let response = mcs.connect_response().await?;
assert!(response.result == 0); // Success
```

---

### 4. GCC Conference Data ⏱️ 4-5 hrs (~10K tokens)
**File**: `src-tauri/src/rdp/gcc.rs` (new module)

**Tasks**:
- [ ] Client Core Data block (version, desktop dims, color depth)
- [ ] Client Security Data block (encryption methods, random)
- [ ] Client Network Data block (channel definitions)
- [ ] Server data blocks parsing (Core, Security, Network)
- [ ] User Data encoding/decoding helpers

**Acceptance Criteria**:
- Generate valid Client Core Data matching user's connection settings
- Parse Server Core Data for session key
- Handle channel definitions (RDPSND, CLIPRDR, RDPDR)

---

### 5. RSA Encryption (Initial Handshake) ⏱️ 3-4 hrs (~8K tokens)
**File**: `src-tauri/src/rdp/security.rs` (initial implementation)

**Tasks**:
- [ ] RSA public key import from server certificate
- [ ] RSA-OAEP encryption with SHA-1 (for RDP 5.x compatibility)
- [ ] Random premaster secret generation
- [ ] Client random generation and storage

**Acceptance Criteria**:
```rust
let security = SecurityLayer::new();
security.generate_client_random();
let encrypted = security.encrypt_client_random(&server_pubkey)?;
```

---

### 6. NTLMv2 Authentication ⏱️ 6-8 hrs (~15K tokens)
**File**: `src-tauri/src/rdp/ntlm.rs` (full implementation)

**Tasks**:
- [ ] NTLM Type 1 (Negotiate) message generation
- [ ] NTLM Type 2 (Challenge) message parsing
- [ ] NTLMv2 response calculation (HMAC-MD5, NT hash)
- [ ] NTLM Type 3 (Authenticate) message generation
- [ ] Session key derivation from NTLMv2 hash
- [ ] MIC calculation and verification

**Acceptance Criteria**:
- Compatible with Windows NLA (Network Level Authentication)
- Handle unicode usernames and passwords
- Support domain\user format
- Pass NTLMSSP negotiation with Windows 10/11 RDP server

---

### 7. CredSSP (Credential Security Support Provider) ⏱️ 4-5 hrs (~10K tokens)
**File**: `src-tauri/src/rdp/credssp.rs` (new module)

**Tasks**:
- [ ] TSRequest ASN.1 structure encoding/decoding
- [ ] TLS-encrypted NTLM over CredSSP tunnel
- [ ] Server public key binding verification
- [ ] Client credentials encryption with server public key
- [ ] Error handling for authentication failures

**Acceptance Criteria**:
```rust
let credssp = CredSSP::new(&transport, &ntlm, &server_pubkey);
credssp.authenticate(&username, &password, &domain).await?;
```

---

### 8. Session Initialization & Capabilities ⏱️ 4-5 hrs (~10K tokens)
**File**: `src-tauri/src/rdp/session.rs` (new module)

**Tasks**:
- [ ] Demand Active PDU parsing
- [ ] Confirm Active PDU generation
- [ ] Capability sets (General, Bitmap, Order, BitmapCache, etc.)
- [ ] Virtual channel establishment
- [ ] Synchronize PDU and control PDUs

**Acceptance Criteria**:
- Exchange capability sets with server
- Confirm support for 32bpp color, 1920x1080 resolution
- Synchronize input/output control

---

### 9. Bitmap Decompression (RLE & Raw) ⏱️ 5-6 hrs (~12K tokens)
**File**: `src-tauri/src/rdp/bitmap.rs` (full implementation)

**Tasks**:
- [ ] 8bpp RLE decompression
- [ ] 16bpp R565 decompression
- [ ] 24bpp raw bitmap handling
- [ ] 32bpp bitmap with alpha
- [ ] Convert to RGBA format for rendering
- [ ] Bitmap cache management

**Acceptance Criteria**:
```rust
let rgba = decompress_bitmap(&compressed_data, width, height, bpp)?;
assert!(rgba.len() == width * height * 4);
```

---

### 10. Input Handling (Fast-Path) ⏱️ 3-4 hrs (~8K tokens)
**File**: `src-tauri/src/rdp/input.rs` (full implementation)

**Tasks**:
- [ ] Fast-Path input encoding for keyboard
- [ ] Fast-Path input encoding for mouse
- [ ] Synchronize events (Ctrl+Alt+Del, etc.)
- [ ] Unicode input support
- [ ] Input throttling and batching

**Acceptance Criteria**:
```rust
input.send_scancode(0x1E, true, false).await?;  // 'a' down
input.send_mouse(100, 200, MouseButton::Left, true).await?;
```

---

### 11. Virtual Channels ⏱️ 4-5 hrs each (~10K tokens each)
**Files**: `src-tauri/src/rdp/channels/*.rs`

#### 11a. RDPSND (Audio Output)
- [ ] Client capability advertisement
- [ ] Wave format negotiation (PCM)
- [ ] Wave data reception and buffering
- [ ] Audio playback integration

#### 11b. CLIPRDR (Clipboard)
- [ ] Format list exchange (CF_TEXT, CF_UNICODETEXT)
- [ ] Format data request/response
- [ ] System clipboard integration (arboard crate)

#### 11c. RDPDR (Drive Redirection) - Optional v2
- [ ] Device announce
- [ ] IRP handling for file operations
- [ ] Async I/O completion

---

### 12. Update Processing Loop ⏱️ 4-5 hrs (~10K tokens)
**File**: `src-tauri/src/rdp/update.rs` (new module)

**Tasks**:
- [ ] Share Control Header parsing
- [ ] Share Data Header parsing
- [ ] Update types: Bitmap, Palette, Sync, Orders
- [ ] Fast-Path update parsing
- [ ] Event dispatch to frontend

**Acceptance Criteria**:
- Continuous read loop from server
- Parse bitmap updates and emit `rdp:frame` events
- Handle disconnect gracefully

---

### 13. Wire Up Full Client ⏱️ 3-4 hrs (~8K tokens)
**File**: `src-tauri/src/rdp/client.rs` (replace stubs)

**Tasks**:
- [ ] Orchestrate connection phases in order:
  1. TCP connect → TLS upgrade
  2. X.224 negotiation
  3. MCS Connect
  4. GCC data exchange
  5. CredSSP/NTLM auth
  6. Session init & capabilities
  7. Update loop
- [ ] Error propagation to frontend
- [ ] Clean disconnect handling
- [ ] Reconnection support (basic)

---

## Integration & Testing ⏱️ 4-6 hrs (~10K tokens)

**Tasks**:
- [ ] End-to-end connection test with Windows RDP
- [ ] Automated tests with stub server
- [ ] Performance benchmarks (frame rate, latency)
- [ ] Memory leak detection
- [ ] Error recovery scenarios

---

## Total Summary

| Component | Hours | Tokens (est) |
|-----------|-------|--------------|
| Transport + X.224 | 6-8 | 16K |
| MCS + GCC | 8-10 | 20K |
| Security + Auth | 9-12 | 23K |
| Session + Bitmap | 9-11 | 22K |
| Input + Channels | 11-14 | 28K |
| Update Loop + Wire-up | 7-9 | 18K |
| **Testing & Polish** | 4-6 | 10K |
| **TOTAL** | **54-70 hrs** | **~137K tokens** |

**Note**: The 20-30 hour estimate was optimistic for a *minimal* RDP client. Full feature parity with audio, clipboard, multiple color depths, and robust error handling requires 50+ hours.

---

## Recommended Agent Tasking Strategy

### Phase 1: Foundation (2-3 agents)
- Agent A: Transport + X.224
- Agent B: MCS + GCC
- Agent C: RSA Security (initial)

### Phase 2: Authentication (1-2 agents)
- Agent D: NTLMv2 (complex, needs focus)
- Agent E: CredSSP integration

### Phase 3: Session & Rendering (2 agents)
- Agent F: Session init + Capabilities
- Agent G: Bitmap decompression

### Phase 4: Input & Channels (2 agents)
- Agent H: Input handling
- Agent I: Virtual channels (pick one: audio or clipboard)

### Phase 5: Integration (1 senior agent)
- Agent J: Wire up client + Update loop + Testing

---

## Priority Order for Minimum Viable RDP

If you want *just enough* to connect and see a desktop:

1. ✅ **TCP Transport** (connect to port 3389)
2. ✅ **X.224** (negotiate protocol)
3. ✅ **MCS** (establish session)
4. ✅ **GCC** (exchange capabilities)
5. ✅ **CredSSP + NTLM** (authenticate)
6. ✅ **Session Init** (initialize session)
7. ✅ **Bitmap Decompression** (render screen)
8. ✅ **Update Loop** (receive updates)
9. ✅ **Input** (mouse/keyboard)

**Channels (audio, clipboard) are v2 features.**

---

## Quick Start for Next Agent

```bash
# Agent picks up component #1 (Transport):
cd rdpea-tauri/src-tauri/src/rdp
# Edit: transport.rs (currently stub)
# Reference: electron/rdp/transport.ts for TypeScript logic
# Reference: https://docs.rs/tokio-native-tls/latest/

# Test:
cargo test --lib transport::tests
```
