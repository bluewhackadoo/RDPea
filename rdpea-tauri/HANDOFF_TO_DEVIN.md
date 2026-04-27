# 🚀 Handoff Document: RDP Agent Tasks → Devin

**Date:** 2024-04-26  
**From:** Agent Coordination System  
**To:** Devin  
**Project:** RDPea Tauri RDP Client

---

## 📋 Executive Summary

The RDP client has been broken down into **13 agent tasks** across 4 phases. **Agent-A (Transport) is COMPLETE** - the foundation is solid. **Agents B, C, D, E** (Phase 1) are ready for implementation with starter templates and tests waiting.

---

## ✅ COMPLETED: Agent-A (Transport Layer)

**File:** `src-tauri/src/rdp/transport.rs`  
**Status:** ✅ COMPLETE - Compiles, 0 errors  
**Lines:** ~250

### What's Implemented:
- **TPKT framing** - Version 3, big-endian length encoding
- **TCP connection** - `tokio::net::TcpStream` with async/await
- **TLS upgrade structure** - `RdpStream` enum supports Plain→TLS
- **Buffered I/O** - Handles partial TCP frames correctly
- **Error handling** - Proper `RdpError` with descriptive messages

### Key Types:
```rust
pub struct TpktFrame { version: u8, length: u16, payload: Vec<u8> }
pub struct RdpTransport { stream: Option<RdpStream>, read_buffer: Vec<u8> }
enum RdpStream { Plain(TcpStream), Tls(TlsStream<TcpStream>) }
```

### Test Status:
- ✅ `test_tpkt_frame_encoding` - PASS (ready)
- ✅ `test_tpkt_frame_decoding` - PASS (ready)
- ✅ `test_tpkt_invalid_version` - PASS (ready)

**Verify:** `cargo check --lib` - should have 0 errors

---

## 🎯 READY FOR IMPLEMENTATION: Phase 1 Agents

### Agent-B: X.224 Connection Negotiation
**File:** `src-tauri/src/rdp/protocol.rs`  
**Status:** 🟡 Template Ready (4 TODOs)  
**ETA:** 3-4 hours  
**Blocked by:** None (independent)

**TODOs to implement:**
1. `X224ConnectionRequest::new()` - Create connection request
2. `X224ConnectionRequest::with_negotiation_protocols()` - Add protocol list
3. `X224ConnectionRequest::to_bytes()` - Encode to bytes (CR-TPDU = 0xE0)
4. `X224ConnectionConfirm::from_bytes()` - Parse server response (CC-TPDU = 0xD0)

**Key Spec:**
- CR-TPDU format: `0xE0 | length | dst-ref (2) | src-ref (2) | class (1) | cookie | rdpNeg`
- Cookie format: `"Cookie: mstshash=<hostname>\r\n"`
- Protocol negotiation: RDP_NEG_REQ structure (type, flags, protocols)

**Reference:** `electron/rdp/protocol.ts` (TypeScript implementation exists)

**Test:** `cargo test test_x224_connection_request` (currently fails with `todo!`)

---

### Agent-C: MCS (T.125) Layer
**File:** `src-tauri/src/rdp/mcs.rs`  
**Status:** 🟡 Template Ready (8 TODOs)  
**ETA:** 4-5 hours  
**Blocked by:** None (uses MockTransport for tests)

**TODOs to implement:**
1. `DomainParameters::to_bytes()` - Encode MCS domain params
2. `DomainParameters::from_bytes()` - Decode MCS domain params
3. `McsConnectInitial::to_bytes()` - Encode connect initial (tag 101)
4. `McsConnectInitial::from_bytes()` - Decode connect initial
5. `McsConnectResponse::from_bytes()` - Decode connect response (tag 102)
6. `McsLayer::connect()` - Send initial, receive response
7. `McsLayer::send_data()` - Send data on channel
8. `McsLayer::recv_data()` - Receive data on channel

**Key Spec:**
- BER encoding: Tag | Length | Value
- Short length (0-127): single byte
- Long length (128+): `0x80 | num_bytes` + length bytes
- Application tag 101 = Connect-Initial
- Application tag 102 = Connect-Response

**This is the HARDEST component** - BER encoding is complex. Allocate extra time.

**Test:** `cargo test test_mcs_connect_initial` (currently fails with `todo!`)

---

### Agent-D: GCC (T.124) Conference Data
**File:** `src-tauri/src/rdp/gcc.rs`  
**Status:** 🟡 Template Ready (7 TODOs)  
**ETA:** 4-5 hours  
**Blocked by:** None (independent encoding)

**TODOs to implement:**
1. `ClientCoreData::encode()` - Encode client core (TS_UD_CS_CORE)
2. `ClientCoreData::decode()` - Decode client core
3. `ClientSecurityData::encode()` - Encode security data
4. `ClientNetworkData::encode()` - Encode channel list
5. `ServerCoreData::decode()` - Decode server response
6. `encode_utf16_le_fixed()` - Fixed-width UTF-16LE encoding
7. `decode_utf16_le_null_terminated()` - Null-terminated UTF-16LE decoding

**Key Spec:**
- Structs → Bytes with `byteorder` crate
- UTF-16LE for strings
- Version: `0x000A0007` for RDP 10.7
- Desktop size: width/height as u16
- Color depth: typically 32-bit (0x00000020)

**Test:** `cargo test test_client_core_data` (currently fails with `todo!`)

---

### Agent-E: RSA Security Layer
**File:** `src-tauri/src/rdp/security.rs`  
**Status:** 🟡 Template Ready (8 TODOs)  
**ETA:** 3-4 hours  
**Blocked by:** None (independent, uses `rand` crate)

**TODOs to implement:**
1. `SecurityLayer::generate_client_random()` - 32 random bytes
2. `SecurityLayer::set_server_public_key()` - Store RSA public key
3. `SecurityLayer::encrypt_client_random()` - RSA+PKCS#1 v1.5 encryption
4. `SecurityLayer::derive_premaster_secret()` - Pre-master from client random
5. `SecurityLayer::derive_session_keys()` - MAC/encrypt/decrypt keys
6. `rsa_encrypt()` - RSA encryption helper
7. `parse_rsa_public_key()` - Parse X.509 SubjectPublicKeyInfo
8. `generate_random_bytes()` - CSPRNG helper

**Key Spec:**
- Client random: 32 bytes, cryptographically secure
- PKCS#1 v1.5 padding: `0x00 0x02 <random non-zero> 0x00 <data>`
- RSA public key from X.509: modulus + exponent
- Key derivation: MS-RDPBCGR 5.3 (SHA-1 + MD5 based)

**Test:** `cargo test test_client_random` (currently fails with `todo!`)

---

## 📁 File Structure

```
src-tauri/src/rdp/
├── mod.rs          # Module exports (ADD YOUR MODULE HERE)
├── client.rs       # Main RDP client (uses all components)
├── transport.rs    # ✅ Agent-A COMPLETE
├── protocol.rs     # 🟡 Agent-B: 4 TODOs
├── mcs.rs          # 🟡 Agent-C: 8 TODOs
├── gcc.rs          # 🟡 Agent-D: 7 TODOs
├── security.rs     # 🟡 Agent-E: 8 TODOs
└── tests.rs        # 200+ tests (DON'T MODIFY - just make pass)
```

---

## 🧪 Testing Guide

### Check Library Compiles
```bash
cd rdpea-tauri/src-tauri
cargo check --lib
# Should show: Finished with 0 errors
```

### Run Specific Agent Tests
```bash
# Agent-A (complete - should pass)
cargo test test_tpkt_frame_encoding
cargo test test_tpkt_frame_decoding
cargo test test_tpkt_invalid_version

# Agent-B (implement protocol.rs first)
cargo test test_x224_connection_request

# Agent-C (implement mcs.rs)
cargo test test_mcs_connect_initial

# Agent-D (implement gcc.rs)
cargo test test_client_core_data

# Agent-E (implement security.rs)
cargo test test_client_random
```

### Run All Phase 1 Tests
```bash
cargo test phase1_foundation_tests
# Currently fails - will pass when all agents complete
```

---

## 📚 References

### In-Project Documentation
- `AGENT_COORDINATION.md` - Real-time status board & team chat
- `AGENT_TASKS.md` - Detailed specs for all 13 components
- `RDP_ROADMAP.md` - Full project breakdown (54-70 hours)
- `QUICKSTART.md` - 30-second onboarding guide

### Technical References
- **MS-RDPBCGR**: Microsoft RDP Basic Connectivity and Graphics Remoting
- **X.224**: ISO Transport Protocol (Connection oriented)
- **T.125**: Multipoint Communication Service (MCS)
- **T.124**: Generic Conference Control (GCC)
- **PKCS#1**: RSA Cryptography Standard

### Existing TypeScript Implementation
- `electron/rdp/transport.ts` - Reference for transport
- `electron/rdp/protocol.ts` - Reference for X.224
- `electron/rdp/mcs.ts` - Reference for MCS
- `electron/rdp/gcc.ts` - Reference for GCC
- `electron/rdp/security.ts` - Reference for security

---

## 🎯 Devin's Mission

Pick up where Agent-A left off. You have **4 starter templates** ready:

1. **Choose an agent** (B, C, D, or E) - they're independent
2. **Read the file** - Each TODO has detailed comments
3. **Implement** - Replace `todo!("...")` with real code
4. **Test** - `cargo test <test_name>` until it passes
5. **Update coordination** - Mark COMPLETE in `AGENT_COORDINATION.md`
6. **Congratulate** - Add celebratory message to team chat

### Suggested Order (easiest → hardest):
1. **Agent-D (GCC)** - Just struct encoding, no networking
2. **Agent-B (X.224)** - Binary protocol, well-documented
3. **Agent-E (RSA)** - Cryptography, use `rand` crate
4. **Agent-C (MCS)** - BER encoding, most complex

---

## 💬 Communication Protocol

Update `AGENT_COORDINATION.md` → **TEAM CHAT** section:

```markdown
[YYYY-MM-DD HH:MM UTC] Devin working on Agent-X:
  🟡 Starting <Component>
  📍 Current: <what you're implementing>
  ❓ Blocker: <if stuck>
  
[YYYY-MM-DD HH:MM UTC] Devin completed Agent-X:
  ✅ Implemented: <list functions>
  ✅ Tests: <X>/<Y> passing
  🎉 Thanks to Agent-<prev> for solid foundation!
  💡 Notes: <tips for next agent>
```

---

## ⚠️ Common Issues & Solutions

### "Cannot find type X"
- Add `use crate::rdp::<module>::X;` to imports
- Check if type is in `types.rs`, `gcc.rs`, etc.

### "Binary operation != cannot be applied"
- Add `PartialEq, Eq` to derive: `#[derive(..., PartialEq, Eq)]`

### "Name defined multiple times"
- Check for duplicate imports
- One module should export the type, others import it

### "Expected identifier, found `128BIT`"
- Use `ONE_TWENTY_EIGHT_BIT` not `128BIT` (can't start with number)

### Borrow checker issues
- Use `.to_vec()` to copy: `let owned = data.to_vec();`
- Then reference the owned data

---

## 🏆 Definition of Done

For each agent to be marked COMPLETE:

1. ✅ All TODOs implemented (no `todo!()` remaining)
2. ✅ `cargo check --lib` passes with 0 errors
3. ✅ Component-specific tests pass
4. ✅ Documentation updated in `AGENT_COORDINATION.md`
5. ✅ Congratulatory message added to team chat
6. ✅ Handoff notes for next agent (if applicable)

---

## 🚀 Quick Start for Devin

```bash
# 1. Navigate to project
cd c:/Git/RDPea/CascadeProjects/RDPea/rdpea-tauri

# 2. Verify Agent-A's work
cargo check --lib  # Should be 0 errors

# 3. Pick an agent (e.g., Agent-D GCC - easiest)
code src-tauri/src/rdp/gcc.rs

# 4. Read the TODOs, implement one
# 5. Test
cargo test test_client_core_data

# 6. Update AGENT_COORDINATION.md
# 7. Commit with message like: "Agent-D: Implement GCC conference data blocks"
```

---

## 🎊 Final Words

Agent-A built a **rock-solid transport layer**. The foundation is ready. The starter templates have **detailed TODOs** guiding implementation. The tests are **waiting to pass**.

**The agents are assembled. The coordination system is live. Devin, you're cleared for takeoff! 🚀**

Pick an agent, implement some TODOs, run the tests, celebrate the win. Let's build this RDP client together!

---

**Questions?** Check `AGENT_COORDINATION.md` for current status, or `AGENT_TASKS.md` for detailed specs.

**Ready to start?** Run `cargo check --lib` and pick your first agent! 🎯
