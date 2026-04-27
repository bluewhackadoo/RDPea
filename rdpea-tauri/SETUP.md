# RDPea Tauri - Setup Guide

## Prerequisites

### 1. Install Rust
```powershell
# Download and run rustup-init.exe from https://rustup.rs/
# Or use winget:
winget install Rustlang.Rustup
```

After installation, restart your terminal and verify:
```powershell
cargo --version
rustc --version
```

### 2. Install Visual Studio Build Tools (Windows)
Required for compiling native Rust dependencies.

Download from: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022

Install with "Desktop development with C++" workload.

### 3. Node.js (Already installed ✓)
You already have Node.js and npm installed.

## Initial Setup

### 1. Install Dependencies
```powershell
cd rdpea-tauri
npm install  # ✓ Already done
```

### 2. Build & Run
```powershell
# Development mode (hot reload)
npm run tauri dev

# Production build
npm run tauri build
```

## Current Status

✅ **Completed**:
- Project scaffolding (Tauri config, Cargo.toml, package.json)
- Rust backend (commands, storage, RDP stubs)
- React frontend (all components copied and adapted)
- Tauri IPC bridge (replaces window.rdpea)
- Import updates (window.rdpea → tauri)

⏳ **Next Steps**:
1. Install Rust (see above)
2. Run `npm run tauri dev` to start development
3. Implement full RDP protocol in Rust
4. Test and iterate

## Troubleshooting

### "cargo not found"
- Install Rust using rustup (see Prerequisites)
- Restart terminal after installation

### "link.exe not found" or similar linker errors
- Install Visual Studio Build Tools with C++ workload
- Restart terminal

### TypeScript errors in IDE
- Run `npm install` if you haven't already
- Restart VS Code/Windsurf

### Port 1420 already in use
- Kill the process using port 1420
- Or change the port in `vite.config.ts`

## Architecture Overview

```
rdpea-tauri/
├── src/                    # React frontend
│   ├── components/         # UI components (copied from Electron version)
│   ├── hooks/              # React hooks
│   ├── lib/
│   │   └── tauri.ts        # Tauri IPC bridge
│   ├── types.ts            # TypeScript interfaces
│   ├── App.tsx             # Main app component
│   ├── main.tsx            # React entry point
│   └── index.css           # TailwindCSS styles
│
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Tauri app setup
│   │   ├── commands.rs     # IPC command handlers
│   │   ├── storage.rs      # Encrypted connection storage
│   │   └── rdp/            # RDP protocol (stub implementations)
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri configuration
│   └── build.rs            # Build script
│
├── package.json            # Node dependencies
├── vite.config.ts          # Vite bundler config
└── tailwind.config.js      # TailwindCSS config
```

## Development Workflow

1. **Start dev server**: `npm run tauri dev`
   - Frontend runs on http://localhost:1420 with hot reload
   - Rust backend compiles and runs the Tauri app
   - Changes to frontend → instant reload
   - Changes to Rust → recompile (takes a few seconds)

2. **Make changes**:
   - Frontend: Edit files in `src/`
   - Backend: Edit files in `src-tauri/src/`

3. **Build for production**: `npm run tauri build`
   - Creates optimized builds in `src-tauri/target/release/`
   - Generates installers in `src-tauri/target/release/bundle/`

## Next Development Tasks

1. **Implement RDP Transport** (`src-tauri/src/rdp/transport.rs`):
   - TCP connection with tokio
   - TLS upgrade with native-tls
   - TPKT framing

2. **Implement RDP Protocol** (`src-tauri/src/rdp/protocol.rs`):
   - X.224 connection negotiation
   - MCS Connect Initial/Response
   - GCC data parsing

3. **Implement Security** (`src-tauri/src/rdp/security.rs`):
   - RSA encryption
   - RC4 session keys
   - Encryption/decryption

4. **Implement NTLM** (`src-tauri/src/rdp/ntlm.rs`):
   - NTLMv2 authentication
   - CredSSP/NLA

5. **Wire up Client** (`src-tauri/src/rdp/client.rs`):
   - Replace stub with full connection lifecycle
   - Handle bitmap updates
   - Process input events

## Resources

- Tauri Docs: https://tauri.app/v2/
- Rust Book: https://doc.rust-lang.org/book/
- RDP Protocol Spec: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/
