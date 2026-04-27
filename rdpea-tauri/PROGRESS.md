# Tauri Port Progress

## Summary

Created initial scaffolding for a Rust/Tauri port of RDPea with the goal of achieving full feature and UX parity with the Electron version.

## What's Been Built

### Project Structure ✅
```
rdpea-tauri/
├── package.json          # Node dependencies (React, Tauri API, etc.)
├── vite.config.ts        # Vite bundler config
├── tsconfig.json         # TypeScript config
├── tailwind.config.js    # TailwindCSS (same as Electron version)
├── index.html            # Entry HTML
├── src-tauri/            # Rust backend
│   ├── Cargo.toml        # Rust dependencies
│   ├── tauri.conf.json   # Tauri app config
│   ├── build.rs          # Build script
│   └── src/
│       ├── main.rs       # Entry point
│       ├── lib.rs        # Tauri app setup
│       ├── commands.rs   # IPC command handlers (mirrors Electron IPC)
│       ├── storage.rs    # Encrypted connection storage
│       └── rdp/          # RDP protocol modules
│           ├── mod.rs
│           ├── types.rs      # Protocol constants
│           ├── buffer.rs     # Binary I/O utilities
│           ├── client.rs     # Main RDP client (stub)
│           ├── transport.rs  # TCP/TLS (stub)
│           ├── protocol.rs   # X.224/MCS/GCC (stub)
│           ├── security.rs   # Encryption/certs (stub)
│           ├── ntlm.rs       # NTLM auth (stub)
│           ├── bitmap.rs     # RLE decompression (stub)
│           ├── audio.rs      # RDPSND (stub)
│           ├── clipboard.rs  # CLIPRDR (stub)
│           └── input.rs      # Keyboard/mouse (stub)
└── src/                  # React frontend (to be copied from ../src/)
    └── lib/
        └── tauri.ts      # Tauri IPC bridge
```

### Rust Backend Components ✅

1. **`commands.rs`** — Complete Tauri command handlers:
   - Window controls (minimize, maximize, close, pin)
   - Connection CRUD (load/save with encryption)
   - RDP session management (connect, disconnect, status, keyboard, mouse)
   - Debug controls (per-connection and global)
   - Hyper-V integration (test, install module, start VM) — Windows only
   - Session window management
   - Event forwarding (RDP events → frontend via Tauri events)

2. **`storage.rs`** — Encrypted connection storage:
   - AES-256-GCM encryption
   - Machine-derived key (SHA-256 with 10k iterations)
   - Stores at `%APPDATA%/com.rdpea.app/connections.enc`
   - JSON serialization

3. **`rdp/client.rs`** — RDP client stub:
   - Event system (Connected, Bitmap, Audio, Clipboard, Disconnected, Error, Log)
   - Stub `connect()` that simulates connection
   - Input methods (keyboard, mouse) that log for now

4. **`rdp/types.rs`** — Full RDP protocol constants:
   - X.224, MCS, GCC constants
   - Security flags, PDU types
   - Virtual channel constants (RDPSND, CLIPRDR, RDPDR)
   - Data structures (RdpClientConfig, BitmapRect, AudioFormat, etc.)

5. **`rdp/buffer.rs`** — Binary I/O utilities:
   - BufferReader (read u8/u16/u32 LE/BE, BER/PER length decoding)
   - BufferWriter (write u8/u16/u32 LE/BE, BER encoding)
   - Direct port from TypeScript BufferReader/BufferWriter

### Frontend Bridge ✅

**`src/lib/tauri.ts`** — Complete Tauri IPC bridge that mirrors the Electron `window.rdpea` API:
- All connection CRUD methods
- All RDP session methods
- All event listeners (onFrame, onAudio, onConnected, etc.)
- Window controls
- Hyper-V integration
- Auto-updater stubs (not implemented yet)

## What's Next

### Immediate (to get a working build)

1. **Copy React components** from `../src/`:
   - Copy all components, hooks, styles
   - Replace `window.rdpea` with `import { tauri } from './lib/tauri'`
   - Update imports

2. **Test compilation**:
   ```bash
   cd rdpea-tauri
   npm install  # or bun install
   npm run tauri dev
   ```

### Short-term (to get basic RDP working)

3. **Implement RDP transport** (`rdp/transport.rs`):
   - TCP connection with tokio
   - TLS upgrade with native-tls
   - TPKT framing
   - Happy Eyeballs connection logic

4. **Implement RDP protocol** (`rdp/protocol.rs`):
   - X.224 connection request/confirm
   - MCS Connect Initial/Response
   - GCC client/server data parsing
   - MCS channel join
   - MCS Send Data Request/Indication

5. **Implement security layer** (`rdp/security.rs`):
   - Server certificate parsing
   - RSA encryption for client random
   - RC4 session key generation
   - Encryption/decryption PDUs

6. **Implement NTLM** (`rdp/ntlm.rs`):
   - NTLMv2 hash generation
   - Negotiate/Challenge/Authenticate messages
   - CredSSP TSRequest encoding/decoding
   - MIC (Message Integrity Check)

7. **Wire up client lifecycle** (`rdp/client.rs`):
   - Connect: X.224 → NLA → MCS → Security → Licensing → Active
   - Handle Demand Active → send Confirm Active
   - Handle bitmap updates → emit to frontend
   - Handle input → send to server

### Medium-term (full feature parity)

8. **Implement bitmap handling** (`rdp/bitmap.rs`):
   - RLE decompression (16/24/32 bpp)
   - RGBA conversion
   - Fast-path bitmap updates

9. **Implement audio** (`rdp/audio.rs`):
   - RDPSND virtual channel
   - Server Audio Formats parsing
   - Client Audio Formats response
   - Wave2 PDU handling
   - PCM audio output

10. **Implement clipboard** (`rdp/clipboard.rs`):
    - CLIPRDR virtual channel
    - Format List exchange
    - Format Data Request/Response
    - System clipboard integration (arboard crate)

11. **Implement input** (`rdp/input.rs`):
    - Keyboard scancode encoding
    - Mouse event encoding
    - Fast-path input PDUs

12. **Add auto-updater**:
    - Tauri updater plugin
    - GitHub releases integration
    - Channel support (alpha/beta/stable)

### Long-term (polish & distribution)

13. **Testing**:
    - Test against Windows Server, Windows 10/11
    - Test audio, clipboard, input
    - Performance profiling
    - Memory leak testing

14. **Packaging**:
    - Windows: NSIS installer, portable exe
    - macOS: DMG, app bundle
    - Linux: AppImage, deb, snap

15. **CI/CD**:
    - GitHub Actions for cross-platform builds
    - Code signing (Windows, macOS)
    - Auto-publish to GitHub Releases

## Key Decisions

- **Keep TailwindCSS**: No Pretext integration (no obvious use case)
- **Stub implementations first**: Get the project compiling, then fill in RDP protocol
- **Event-driven architecture**: RDP client emits events → commands.rs forwards to frontend via Tauri events
- **Same IPC API**: Frontend code changes should be minimal (just import path changes)

## Estimated Effort

- **Scaffolding**: ✅ Done (2-3 hours)
- **RDP protocol port**: 🚧 In progress (20-30 hours remaining)
- **Frontend adaptation**: ⏳ Pending (4-6 hours)
- **Testing & polish**: ⏳ Pending (10-15 hours)

**Total**: ~35-55 hours for full feature parity
