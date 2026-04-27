# RDPea Tauri Port

This is a Rust/Tauri port of the RDPea Electron application, aiming for full feature and UX parity.

## Status

🚧 **Work in Progress** — This is an early-stage port with stub implementations.

### Completed
- ✅ Project scaffolding (Tauri config, Cargo.toml, package.json)
- ✅ Rust backend structure (commands, storage, RDP modules)
- ✅ Encrypted connection storage (AES-256-GCM)
- ✅ Window management commands
- ✅ Hyper-V integration (Windows only)
- ✅ Tauri IPC bridge for React frontend

### In Progress
- 🚧 RDP protocol implementation (types, buffer utils created; transport/protocol/security/NTLM/bitmap/audio/clipboard/input pending)
- 🚧 React frontend adaptation (Tauri IPC bridge created; components need to be copied and adapted)

### Pending
- ⏳ Full RDP client lifecycle (X.224, MCS, NLA, bitmap rendering, input handling)
- ⏳ Audio output (RDPSND virtual channel)
- ⏳ Clipboard redirection (CLIPRDR virtual channel)
- ⏳ Auto-updater (Tauri updater plugin)
- ⏳ Testing and feature parity verification

## Prerequisites

- **Rust** (latest stable): https://rustup.rs/
- **Node.js** 18+ or **Bun**: https://bun.sh/
- **Tauri CLI**: Will be installed via npm/bun

### Platform-specific
- **Windows**: Visual Studio Build Tools with C++ workload
- **macOS**: Xcode Command Line Tools
- **Linux**: See https://tauri.app/v2/guides/prerequisites/#linux

## Development

```bash
# Install dependencies
npm install
# or
bun install

# Run in development mode
npm run tauri dev
# or
bun tauri dev

# Build for production
npm run tauri build
# or
bun tauri build
```

## Architecture

### Rust Backend (`src-tauri/src/`)
- **`main.rs`**: Entry point
- **`lib.rs`**: Tauri app setup and command registration
- **`commands.rs`**: Tauri IPC command handlers (mirrors Electron IPC)
- **`storage.rs`**: Encrypted connection storage (AES-256-GCM)
- **`rdp/`**: RDP protocol implementation
  - `client.rs`: Main RDP client orchestrator
  - `types.rs`: Protocol constants and data structures
  - `buffer.rs`: Binary read/write utilities
  - `transport.rs`: TCP/TLS connection handling
  - `protocol.rs`: X.224, MCS, GCC PDU building/parsing
  - `security.rs`: Encryption, session keys, certificates
  - `ntlm.rs`: NTLM authentication for CredSSP/NLA
  - `bitmap.rs`: RLE decompression and RGBA conversion
  - `audio.rs`: RDPSND virtual channel
  - `clipboard.rs`: CLIPRDR virtual channel
  - `input.rs`: Keyboard/mouse input encoding

### React Frontend (`src/`)
- **`lib/tauri.ts`**: Tauri IPC bridge (replaces `window.rdpea` from Electron)
- **Components**: To be copied and adapted from `../src/components/`
- **Hooks**: To be copied from `../src/hooks/`
- **Styles**: TailwindCSS (same as Electron version)

## Differences from Electron Version

1. **IPC**: Uses Tauri's `invoke()` and `listen()` instead of Electron's `ipcRenderer`
2. **Auto-updater**: Will use Tauri updater plugin (not yet implemented)
3. **Native modules**: Pure Rust instead of Node.js native addons
4. **Binary size**: Expected to be significantly smaller (~10-15MB vs ~150MB)
5. **Performance**: Rust backend should be faster for RDP protocol handling

## Next Steps

1. Copy React components from `../src/components/` and adapt for Tauri IPC
2. Implement full RDP protocol in Rust (port from `../electron/rdp/`)
3. Test connection, bitmap rendering, input handling
4. Add auto-updater support
5. Performance testing and optimization
6. Package for distribution

## License

MIT
