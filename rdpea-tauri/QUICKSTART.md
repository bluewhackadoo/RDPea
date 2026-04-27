# 🚀 Agent Quickstart Guide

## ✅ SYSTEM IS READY!

All Phase 1 starter templates are compiled and ready for agents!

---

## 🎯 For Agents: 30-Second Start

### Step 1: Claim Your Task
Open `AGENT_COORDINATION.md` and update the STATUS BOARD:
```markdown
| A: Transport | **Agent-A** | 🟡 In Progress | 10:30 | 4 hrs | Starting now |
```

### Step 2: Find Your File

| Agent | File | # TODOs | Run This Test |
|-------|------|---------|---------------|
| **A** | `src-tauri/src/rdp/transport.rs` | 6 | `cargo test phase1_foundation_tests::test_tpkt_frame` |
| **B** | `src-tauri/src/rdp/protocol.rs` | 4 | `cargo test phase1_foundation_tests::test_x224_connection_request` |
| **C** | `src-tauri/src/rdp/mcs.rs` | 8 | `cargo test phase1_foundation_tests::test_mcs_connect_initial` |
| **D** | `src-tauri/src/rdp/gcc.rs` | 7 | `cargo test phase1_foundation_tests::test_client_core_data` |
| **E** | `src-tauri/src/rdp/security.rs` | 8 | `cargo test phase1_foundation_tests::test_client_random` |

### Step 3: Implement
Replace `todo!("...")` with actual code. Each TODO has detailed comments explaining what to do.

### Step 4: Test
```bash
cd rdpea-tauri/src-tauri
cargo test phase1_foundation_tests::<your_test>
```

### Step 5: Celebrate!
Update `AGENT_COORDINATION.md`:
```markdown
[2024-04-26 14:00] Agent-A completed TRANSPORT:
  ✅ All 6 TODOs implemented
  ✅ All tests passing
  🎉 Great work Agent-B, X.224 is all yours!
```

---

## 🏃 Quick Commands

```bash
# Check compilation (should pass now)
cargo check --lib

# Run all Phase 1 tests (will fail until you implement)
cargo test phase1_foundation_tests

# Run just your component's tests
cargo test test_tpkt_frame
cargo test test_x224_connection_request
cargo test test_mcs_connect_initial
cargo test test_client_core_data
cargo test test_client_random

# Run specific test with output
cargo test test_tpkt_frame -- --nocapture
```

---

## 🎓 Implementation Tips

### Agent-A: Transport (TCP/TLS/TPKT)
- Start with `TpktFrame::new()` and `to_bytes()` - easiest!
- Then `from_bytes()` - parsing is trickier
- Then `connect()` - use `tokio::net::TcpStream`
- Finally `upgrade_tls()` - use `tokio_native_tls`

### Agent-B: X.224 (Connection Negotiation)
- Reference: `electron/rdp/protocol.ts`
- Key spec: X.224 CR-TPDU = `0xE0`, CC-TPDU = `0xD0`
- RDP cookie format: `"Cookie: mstshash=<hostname>\r\n"`
- Protocol negotiation: RDP_NEG_REQ structure

### Agent-C: MCS (T.125)
- This is the hardest - BER encoding is complex!
- Short BER length: 0-127 = single byte
- Long BER length: 128+ = `0x80 | num_bytes, then length bytes`
- Application tag 101 = Connect Initial
- Application tag 102 = Connect Response

### Agent-D: GCC (T.124)
- Mostly struct → bytes serialization
- Use `byteorder` crate for endianness
- UTF-16LE encoding for strings
- Watch out for padding requirements

### Agent-E: RSA Security
- Use `rand` crate for random bytes
- PKCS#1 v1.5 padding: `0x00 0x02 <random> 0x00 <data>`
- RSA public key from X.509 cert
- Reference: MS-RDPBCGR section 5.3

---

## 🤝 Congratulation Template

When you complete your task, add this to the **COMPLETION_NOTES** section in `AGENT_COORDINATION.md`:

```markdown
[YYYY-MM-DD HH:MM UTC] Agent-X completed TASK:
  ✅ Implemented: <list key functions>
  ✅ Tests: <X>/<Y> passing
  🎉 Shout-outs: 
    - Thanks to Agent-<prev> for solid foundation!
    - Agent-<next>: You're up! The <component> is ready!
  💡 Notes: <any tips for next agent>
```

---

## 📊 Phase 1 Dependency Graph

```
Agent-A (Transport) ──┐
                      ├──→ Agent-F/G (Auth - Phase 2)
Agent-B (X.224) ──────┤
                      │
Agent-C (MCS) ────────┤
                      │
Agent-D (GCC) ────────┘
                      │
Agent-E (RSA) ────────┘
```

**Can work in parallel:** Agents A, B, C, D, E (all independent for unit tests)

**Integration:** Phase 1 integration test needs all 5 complete

---

## 🐛 Common Issues

### "Cannot find type X"
- Make sure to `use crate::rdp::types::X;` or similar
- Check if type is in another module (gcc, types, etc.)

### "Binary operation != cannot be applied"
- Add `PartialEq, Eq` to derive macro: `#[derive(..., PartialEq, Eq)]`

### "Name defined multiple times"
- Check for duplicate imports
- Don't `pub use` if the type is already `pub struct` in the module

### Test panics with `todo!`
- That's expected! Replace `todo!()` with actual implementation.

---

## 📚 References

- **MS-RDPBCGR**: Microsoft RDP Basic Connectivity and Graphics Remoting
- **X.224**: ISO Transport Protocol ( Connection oriented)
- **T.125**: Multipoint Communication Service (MCS)
- **T.124**: Generic Conference Control (GCC)
- **PKCS#1**: RSA Cryptography Standard

---

## 💬 Team Chat

See `AGENT_COORDINATION.md` → **TEAM CHAT** section to:
- Announce you're starting
- Ask questions
- Share progress
- Congratulate others

---

**Let's build this RDP client! 🚀**

Remember: Replace one `todo!()` at a time, run tests often, and celebrate every win!
