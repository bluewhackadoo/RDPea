# RDPea — Lightweight RDP Remote Desktop Client for 🪟Windows, 🍏Mac and 🐧Linux

A fast, modern Remote Desktop Protocol (RDP) client built with Electron, React, and TailwindCSS. Manage multiple PC connections with encrypted credential storage, independently pinnable windows, and full video/audio support.

## Features

- **Encrypted Storage** — All connections and credentials are encrypted with AES-256-GCM, derived from a machine-specific key
- **Multiple Connections** — Save and organize unlimited RDP connections with groups, tags, and color coding
- **Independently Pinnable Windows** — Each connection opens in its own window that can be pinned always-on-top
- **Dynamic Resizing** — Session windows resize dynamically with smart sizing enabled
- **Native RDP Protocol** — Pure TypeScript RDP implementation — no external executables (no mstsc.exe)
- **Canvas Rendering** — Remote desktop rendered natively on HTML5 Canvas with bitmap decompression
- **Full Audio Support** — RDPSND virtual channel with Web Audio API playback (configurable per connection)
- **Keyboard & Mouse** — Full input forwarding with scancode mapping for all keys
- **Modern UI** — Dark theme, glass morphism, grid/list views, search, and smooth animations
- **NLA/TLS Security** — NTLMv2 authentication via CredSSP, TLS transport encryption
- **Resource Redirection** — Clipboard virtual channel support

## Tech Stack

- **Electron** — Native desktop shell with multi-window support
- **React 18** — UI framework with hooks
- **Vite** — Fast build tooling with HMR
- **TailwindCSS** — Utility-first styling
- **Lucide Icons** — Clean, consistent iconography
- **Node.js Crypto** — AES-256-GCM encryption for connection data
- **Custom RDP Stack** — Pure TypeScript RDP protocol (X.224, MCS/T.125, GCC, NLA/CredSSP, RDPSND)
- **HTML5 Canvas** — Bitmap frame rendering with RLE decompression
- **Web Audio API** — PCM audio playback from RDPSND virtual channel

## Installation  (NOT YET WORKING)

### Windows

**Winget** (recommended):
```bash
winget install bluewhackadoo.RDPea
```

**Chocolatey**:
```bash
choco install rdpea
```

**Manual**: Download the latest `.exe` installer from [Releases](https://github.com/bluewhackadoo/RDPea/releases)

### macOS

**Homebrew**:
```bash
brew install --cask rdpea
```

**Manual**: Download the latest `.dmg` from [Releases](https://github.com/bluewhackadoo/RDPea/releases)

### Linux

**AppImage** (universal):
```bash
wget https://github.com/bluewhackadoo/RDPea/releases/latest/download/RDPea-1.0.3.AppImage
chmod +x RDPea-1.0.3.AppImage
./RDPea-1.0.3.AppImage
```

**Debian/Ubuntu**:
```bash
wget https://github.com/bluewhackadoo/RDPea/releases/latest/download/rdpea_1.0.3_amd64.deb
sudo dpkg -i rdpea_1.0.3_amd64.deb
```

**Fedora/RHEL**:
```bash
wget https://github.com/bluewhackadoo/RDPea/releases/latest/download/rdpea-1.0.3.x86_64.rpm
sudo rpm -i rdpea-1.0.3.x86_64.rpm
```

**Snap**:
```bash
sudo snap install rdpea
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Windows 10/11, macOS, or Linux (no external RDP dependencies)

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

This starts both the Vite dev server and the Electron app with hot reload.

### Build Binaries

To create distributable binaries for your platform:

```bash
npm run electron:build
```

This produces platform-specific installers in the `release/` folder:

**Windows:**
- `RDPea Setup [version].exe` — NSIS installer (one-click install)
- `RDPea [version].exe` — Portable executable (no installation required)

**macOS:**
- `RDPea-[version].dmg` — Disk image installer

**Linux:**
- `RDPea-[version].AppImage` — Portable AppImage

The build process:
1. Compiles TypeScript (Electron main process + RDP stack)
2. Bundles React app with Vite
3. Packages with electron-builder using the generated icon
4. Creates platform-specific installers with proper code signing (if configured)

## Project Structure

```
├── electron/
│   ├── main.ts          # Electron main process, IPC, window management
│   ├── preload.ts       # Context bridge API exposed to renderer
│   └── rdp/             # Native TypeScript RDP protocol stack
│       ├── client.ts    # Main RDP client orchestrator
│       ├── transport.ts # TCP/TLS transport layer
│       ├── protocol.ts  # X.224, MCS (T.125), GCC protocol layers
│       ├── security.ts  # RDP security, encryption, PDU helpers
│       ├── ntlm.ts      # NTLMv2 auth for NLA/CredSSP
│       ├── bitmap.ts    # RDP bitmap RLE decompression
│       ├── input.ts     # Keyboard scancode & mouse input PDUs
│       ├── audio.ts     # RDPSND virtual channel (audio output)
│       ├── types.ts     # Protocol constants & interfaces
│       ├── bufferReader.ts # Binary protocol reading
│       └── bufferWriter.ts # Binary protocol writing
├── src/
│   ├── main.tsx         # React entry point
│   ├── App.tsx          # Root component with routing
│   ├── index.css        # Tailwind base + custom components
│   ├── types.ts         # TypeScript interfaces & global window type
│   ├── hooks/
│   │   └── useConnections.ts  # Connection CRUD, search, sort, persist
│   └── components/
│       ├── TitleBar.tsx        # Custom frameless title bar with pin
│       ├── Dashboard.tsx       # Main connection manager view
│       ├── Sidebar.tsx         # Groups, search, view toggle
│       ├── ConnectionCard.tsx  # Grid/list card with actions
│       ├── ConnectionForm.tsx  # Add/edit connection modal
│       └── SessionView.tsx     # Canvas-based RDP session renderer
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## Security

- Credentials are encrypted at rest using **AES-256-GCM** with a key derived via `scrypt` from machine-specific identifiers
- Connection data is stored in `%APPDATA%/rdpea/connections.enc`
- RDP connections use **TLS encryption** with NTLMv2 authentication (CredSSP/NLA)
- No external executables — the entire RDP protocol runs within the Electron process
- Standard RDP security (RC4 encryption) supported as fallback for legacy servers

## License

MIT License - See [LICENSE](LICENSE) file for details.

**Attribution Required**: This software is licensed under the MIT License, which requires that the copyright notice and permission notice be included in all copies or substantial portions of the software. Any derivative works or distributions must retain the original copyright attribution to bluewhackadoo.
