# RDPea.com — Product Landing Page Design Handoff

**Prepared for:** Design firm  
**Prepared by:** bluewhackadoo  
**Date:** April 2026  
**Domain:** rdpea.com

---

## 1. Product Overview

**RDPea** is a lightweight, cross-platform Remote Desktop Protocol (RDP) client for Windows, macOS, and Linux. It is a free, open-source Electron desktop application that lets IT professionals and power users manage and connect to multiple remote PCs from a single modern interface.

### One-liner
> A fast, modern Remote Desktop client for Windows, Mac, and Linux — free, open source, and built from scratch.

### Elevator Pitch
RDPea is a native desktop app that replaces Microsoft's Remote Desktop client with something that runs everywhere, looks modern, and is built entirely in TypeScript — no external executables, no mstsc.exe dependency. It stores credentials encrypted locally with AES-256-GCM, supports full audio/video/clipboard, and manages multiple connections with groups, tags, and color-coded cards. It also integrates directly with Hyper-V for automatic VM start/resume/save.

---

## 2. Target Audience

| Persona | Description |
|---------|-------------|
| **IT Administrators** | Manage dozens of servers/workstations daily, need fast switching between connections |
| **Developers** | Connect to dev/staging VMs, often on Hyper-V, need a lightweight tool that doesn't get in the way |
| **MSPs (Managed Service Providers)** | Manage client infrastructure remotely, need organized connection lists with groups |
| **Power Users** | Home lab enthusiasts running Hyper-V, Proxmox, or other hypervisors who want a modern RDP client |
| **Mac/Linux Users** | Currently underserved by Microsoft's own client — need a native cross-platform alternative |

---

## 3. Brand Identity

### Name & Wordmark
- **Product name:** RDPea
- **Pronunciation:** "R-D-Pea" (like the vegetable)
- **Wordmark:** "RDPea" — the "RD" references Remote Desktop, the "Pea" is literal (a pea)
- **Tagline options (pick or riff on):**
  - "Remote Desktop, shelled."
  - "Lightweight Remote Desktop for Every Platform."
  - "Your desktops. One app. Zero bloat."

### Logo
- The logo is an SVG combining:
  - **"RD"** in large serif-style letterforms (light gray #CCCCCC)
  - **A green pea** (3D sphere with radial gradient, positioned at top-right as a decorative "period")
  - **"Pea"** in a smaller complementary weight below/right of the RD
  - **"REMOTE DESKTOP"** in very small uppercase tracking beneath
- Logo files are in `build/Logo.svg`, `build/icon.ico`, `build/icon.png`, and `build/icons/` (16px through 512px PNGs)
- The green pea uses a radial gradient: center highlight `#D4EDA8` → mid `#7EC850` / `#4A9C28` → edge `#2D6E14` / `#1A4A08`

### Color Palette (from the app itself)

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| **Primary** | primary-500 | `#3b82f6` | Buttons, active states, links |
| **Primary dark** | primary-600 | `#2563eb` | Button backgrounds |
| **Primary light** | primary-400 | `#60a5fa` | Accents, highlights |
| **Surface (darkest)** | surface-950 | `#020617` | App background |
| **Surface dark** | surface-900 | `#0f172a` | Panels, sidebars |
| **Surface mid** | surface-700 | `#334155` | Borders, dividers |
| **Surface light** | surface-400 | `#94a3b8` | Secondary text |
| **Text** | surface-100 | `#f1f5f9` | Primary text on dark |
| **Success** | emerald-400 | `#34d399` | Active connections, success states |
| **Pea green** | — | `#4A9C28` | Logo accent, can be used sparingly as brand color |

### Typography
- App uses: `'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
- Website recommendation: Use a clean sans-serif like **Inter**, **Geist**, or **Plus Jakarta Sans** for headings, system font stack for body

### Visual Style
- **Dark-first design** — the app is dark-themed; the website should match
- **Glassmorphism** — the app uses `backdrop-blur-xl` glass panels with semi-transparent backgrounds
- **Subtle borders** — `border-surface-700/50` (translucent slate borders)
- **Smooth animations** — fade-in, slide-up transitions
- **Minimal, clean, professional** — not playful/cartoon, not corporate/boring

---

## 4. Page Structure & Sections

### 4.1 Hero Section

**Goal:** Immediate clarity on what the product is + primary CTA to download.

**Content:**
- Logo (SVG)
- Headline: **"Lightweight Remote Desktop for Windows, Mac & Linux"**
- Subheadline: "A fast, modern RDP client — free, open source, and built from scratch. Manage multiple connections with encrypted credential storage, Hyper-V integration, and full audio/video support."
- **Primary CTA:** "Download for [detected OS]" (auto-detect Windows/macOS/Linux and show platform-appropriate button)
- **Secondary CTA:** "View on GitHub" → https://github.com/bluewhackadoo/RDPea
- **Hero image/video:** An app screenshot or short looping video showing the dashboard with connection cards in grid view, then a session window connecting. The dark UI should pop against a subtle gradient background.

**Design notes:**
- Consider a large screenshot of the dashboard (grid view with multiple color-coded connection cards) floating with perspective/tilt and a subtle glow/reflection
- Or an embedded screen recording (15–20s loop, no audio) showing: dashboard → click connect → session window opens → remote desktop renders

### 4.2 Feature Highlights (Above the Fold or Immediately Below Hero)

**Goal:** Quick-scan value props. 3–4 short feature cards.

| Icon | Title | Description |
|------|-------|-------------|
| 🔒 | **Encrypted Storage** | Credentials encrypted with AES-256-GCM using machine-derived keys. Your passwords never leave your device unencrypted. |
| 🖥️ | **Multi-Connection Manager** | Organize unlimited RDP connections with groups, tags, color-coding, and grid or list views. |
| 📌 | **Pinnable Windows** | Each session opens in its own independently pinnable, always-on-top window. |
| 🎵 | **Full Audio & Video** | Native RDP bitmap rendering on HTML5 Canvas with RDPSND audio playback. No laggy VNC-style streaming. |

### 4.3 Detailed Feature Grid / Bento Grid

**Goal:** Showcase the full feature set with visual depth.

**Features to highlight (each with a short description + small UI screenshot or icon):**

1. **Pure TypeScript RDP Stack**
   - "No mstsc.exe. No external executables. The entire RDP protocol — X.224, MCS, GCC, NLA/CredSSP, RDPSND — is implemented natively in TypeScript."

2. **Dark Glass UI**
   - "A beautiful dark interface with glassmorphism, smooth animations, and a modern design language."
   - Screenshot: Dashboard in grid view

3. **Connection Management**
   - "Save unlimited connections with custom names, colors, groups, tags, and notes. Search and filter instantly."
   - Screenshot: Sidebar with groups + grid of connection cards

4. **Tabbed Connection Editor**
   - "Configure every detail: General, Display, Resources, Hyper-V, Gateway, and Notes — all in a clean tabbed modal."
   - Screenshot: Connection form with tabs visible

5. **Hyper-V Integration**
   - "Automatically start, resume, and save Hyper-V VMs when you connect and disconnect. Test VM connectivity right from the connection editor."
   - Screenshot: Hyper-V tab showing VM state + Start/Resume button

6. **Dynamic Resizing**
   - "Session windows resize dynamically with smart sizing. Set your initial resolution and the session adapts as you resize the window."

7. **Resource Redirection**
   - "Clipboard sync, drive mapping, printer redirection, and Windows key capture — all configurable per connection."
   - Screenshot: Resources tab with checkboxes

8. **NLA/TLS Security**
   - "NTLMv2 authentication via CredSSP with TLS transport encryption. Standard RDP security (RC4) as fallback for legacy servers."

9. **Auto-Update**
   - "Built-in update mechanism. Check for updates from within the app and install with one click."

10. **Open Source**
    - "MIT licensed. Fully auditable. No telemetry, no tracking, no accounts."
    - Link to GitHub

### 4.4 Screenshots / App Gallery

**Goal:** Let people see the actual product.

**Required screenshots (I will provide these — design firm should leave placeholders):**

| # | View | Description |
|---|------|-------------|
| 1 | **Dashboard — Grid View** | Main window showing multiple connection cards in a 4-column grid, sidebar visible with groups and search |
| 2 | **Dashboard — List View** | Same connections in list/table layout |
| 3 | **Connection Editor — General Tab** | Modal showing host, port, username, password, domain, group, tags, color picker |
| 4 | **Connection Editor — Hyper-V Tab** | Hyper-V enabled, VM name filled, test result showing "VM found — current state: Running" |
| 5 | **Connection Editor — Resources Tab** | Audio, clipboard, drives, printers, Windows key capture toggles |
| 6 | **Active Session** | Remote desktop rendered in a session window with the auto-hiding toolbar visible at top |
| 7 | **Debug Panel** | Session window with debug log panel expanded at bottom |
| 8 | **Empty State** | Dashboard with zero connections showing the friendly "No connections yet" illustration |

**Design notes:**
- Screenshots should be displayed in browser-chrome or OS-window mockups appropriate to the platform
- Consider a carousel or interactive gallery
- Dark screenshots on a dark page — use subtle borders/shadows/glow to separate them from the background

### 4.5 Cross-Platform Download Section

**Goal:** Clear download paths for all platforms.

**Layout:** Three columns (or responsive cards) for Windows / macOS / Linux.

**Windows:**
- **Installer (.exe):** Primary download button
- **Portable (.exe):** Secondary link ("No install required")
- **Winget:** `winget install bluewhackadoo.RDPea`
- **Chocolatey:** `choco install rdpea`

**macOS:**
- **DMG:** Primary download button
- **Homebrew:** `brew install --cask rdpea`
- Note: Universal binary (Intel + Apple Silicon)

**Linux:**
- **AppImage:** Primary download button
- **Deb:** For Debian/Ubuntu
- **RPM:** For Fedora/RHEL
- **Snap:** `sudo snap install rdpea`

**Implementation note:** Download links point to GitHub Releases:
`https://github.com/bluewhackadoo/RDPea/releases/latest`

The design should auto-detect the visitor's OS and highlight/expand the relevant platform section, with the others collapsed or secondary.

### 4.6 Technical Details / "Under the Hood"

**Goal:** Credibility with technical audience.

**Content:** A brief technical section for developers/sysadmins who want to understand the stack:

- **Framework:** Electron + React 18 + Vite
- **RDP Protocol:** Custom pure-TypeScript implementation
  - X.224 connection sequence
  - MCS (T.125) / GCC conference
  - NLA via CredSSP + NTLMv2
  - TLS transport encryption
  - RDPSND virtual channel (audio)
  - Clipboard virtual channel
  - Bitmap RLE decompression → HTML5 Canvas
- **Security:** AES-256-GCM encrypted storage, scrypt key derivation, no plaintext secrets
- **Rendering:** Direct bitmap blitting to HTML5 Canvas — no intermediate encoding/decoding

**Design notes:** This could be a horizontally scrolling "protocol stack" diagram or a simple vertical list with icons. Keep it concise — the audience that cares about this will read it; everyone else should be able to skip it.

### 4.7 Open Source & Community

**Goal:** Build trust and invite contribution.

**Content:**
- "RDPea is MIT licensed and fully open source."
- GitHub stars badge (dynamic)
- Link to repository: https://github.com/bluewhackadoo/RDPea
- Link to issues: https://github.com/bluewhackadoo/RDPea/issues
- "Found a bug? Have a feature request? Open an issue."

### 4.8 Support & Sponsorship

**Goal:** Revenue / sustainability.

**Content:**
- **Sponsor:** "Support ongoing development" → https://github.com/sponsors/bluewhackadoo
- **Paid support:** "Need help with setup or custom integrations?" → bluewhackadoo@RDPea.com
  - Initial setup & configuration
  - Performance tuning
  - Custom integrations
- **Future Pro features** (teaser):
  - Advanced automation workflows
  - Extended integrations
  - Priority feature requests

**Design notes:** Keep this tasteful and non-aggressive. A single row or card — not a full pricing page.

### 4.9 Footer

**Content:**
- Logo (small)
- Navigation links: Features, Download, GitHub, Support
- Copyright: `© 2026 RDPea. MIT License.`
- Social/community links (GitHub only for now)
- Contact: bluewhackadoo@RDPea.com

---

## 5. Pages

For the initial launch, this is a **single-page site** (landing page). No separate pages needed.

**Future consideration:** A `/docs` or `/changelog` page may be added later, but is out of scope for this handoff.

---

## 6. Functional Requirements

| Requirement | Details |
|-------------|---------|
| **OS detection** | Auto-detect visitor's OS via User-Agent and highlight the appropriate download section |
| **Download links** | Point to GitHub Releases (`/releases/latest/download/...`) — not self-hosted binaries |
| **Responsive** | Must work well on desktop (primary), tablet, and mobile (informational — nobody downloads a desktop app on mobile, but the page should still look good) |
| **Performance** | Fast load. No heavy JS frameworks needed — this is a marketing page. Static HTML/CSS with minimal JS is fine. Frameworks like Astro, Next.js (static export), or even plain HTML + Tailwind are all acceptable. |
| **Analytics** | Placeholder for a privacy-respecting analytics snippet (e.g., Plausible, Umami). No Google Analytics. |
| **SEO** | Proper meta tags, Open Graph tags, Twitter card tags. Target keywords: "RDP client", "remote desktop", "cross-platform RDP", "open source RDP", "RDP for Mac", "RDP for Linux" |
| **Favicon** | Use the provided pea favicon (SVG) |

---

## 7. Assets Provided

| Asset | Location | Format |
|-------|----------|--------|
| Logo (full) | `build/Logo.svg` | SVG |
| Favicon | `public/favicon.svg` | SVG |
| App icon | `build/icon.ico`, `build/icon.png` | ICO, PNG |
| Icon set | `build/icons/` | PNG (16–512px) |
| App screenshots | **TO BE PROVIDED** — placeholders in mockups please | PNG |
| Screen recording | **TO BE PROVIDED** | MP4/WebM |

---

## 8. Design References & Inspiration

The following products have landing pages with a similar aesthetic to what we're going for:

- **Warp** (warp.dev) — Dark, technical, clean, developer-focused
- **Linear** (linear.app) — Dark glassmorphism, product screenshots, minimal copy
- **Raycast** (raycast.com) — Dark, feature grid, download CTAs, cross-platform
- **Fig / Amazon Q** — Dark terminal aesthetic, feature showcase
- **Hyper** (hyper.is) — Terminal app, dark page, hero screenshot, simple download

**Key takeaways from these:**
- Dark background (near-black, not gray)
- Product screenshots as hero images with subtle glow/shadow
- Feature grid with icons and short descriptions
- Clear, prominent download CTA
- Minimal, confident copy — not salesy
- Technical credibility without being intimidating

---

## 9. Copy Tone & Voice

- **Confident but not arrogant** — "Here's what it does" not "The best RDP client ever"
- **Technical but accessible** — Use real terms (NLA, CredSSP, AES-256) but explain them briefly
- **Concise** — Short sentences, short paragraphs. Developers don't read marketing fluff.
- **Honest** — It's open source, it's free, it's MIT licensed. No hidden catches.
- **No emoji in body copy** — Emojis are OK for platform labels (🪟 Windows, 🍏 macOS, 🐧 Linux) but not in feature descriptions

---

## 10. SEO & Meta

```html
<title>RDPea — Lightweight Remote Desktop Client for Windows, Mac & Linux</title>
<meta name="description" content="A fast, modern, open-source RDP client. Manage multiple remote desktop connections with encrypted storage, Hyper-V integration, and full audio/video support. Free for Windows, macOS, and Linux." />
<meta property="og:title" content="RDPea — Lightweight Remote Desktop Client" />
<meta property="og:description" content="Free, open-source RDP client for Windows, Mac & Linux. Encrypted credentials, Hyper-V integration, multi-connection management." />
<meta property="og:image" content="https://rdpea.com/og-image.png" />
<meta property="og:url" content="https://rdpea.com" />
<meta name="twitter:card" content="summary_large_image" />
```

**OG image:** TO BE CREATED — should be 1200x630px, dark background, logo + hero screenshot + tagline.

---

## 11. Hosting & Deployment

- **Domain:** rdpea.com (already owned)
- **Preferred hosting:** Netlify, Vercel, or Cloudflare Pages (static site)
- **SSL:** Required (HTTPS only)
- **CDN:** Included with any of the above hosting providers

---

## 12. Deliverables Expected

1. **Design mockups** (Figma preferred) for:
   - Desktop (1440px)
   - Tablet (768px)
   - Mobile (375px)
2. **Built site** (HTML/CSS/JS or framework of choice) — production-ready, deployable to Netlify/Vercel
3. **OG image** (1200x630px)
4. **Favicon set** (already provided, but confirm integration)

---

## 13. Timeline & Budget

_To be discussed separately._

---

## 14. Contact

- **Project owner:** bluewhackadoo
- **Email:** bluewhackadoo@RDPea.com
- **GitHub:** https://github.com/bluewhackadoo/RDPea
- **Repository:** https://github.com/bluewhackadoo/RDPea (public, MIT license)

---

## Appendix A: Full Feature List (Reference)

For completeness, here is every feature currently shipped:

- AES-256-GCM encrypted credential storage (machine-derived key via scrypt)
- Unlimited saved connections with name, color, group, tags, notes
- Grid view and list view for connection dashboard
- Search and filter connections
- Group-based sidebar navigation
- Per-connection settings: host, port, username, password, domain, gateway
- Display settings: width, height, color depth (16/24/32-bit)
- Dynamic session resizing with smart sizing
- Resource redirection: clipboard, drives, printers
- Windows key capture (per-connection toggle)
- Audio: play locally, play on remote, or mute (RDPSND virtual channel)
- Independent session windows (each connection in its own window)
- Pin any window always-on-top
- Hyper-V VM management: auto-start/resume on connect, auto-save on disconnect
- Hyper-V test connection with live VM state reporting
- Hyper-V PowerShell module detection and one-click install
- UAC auto-elevation for Hyper-V commands (with user consent dialog)
- NLA/CredSSP authentication with NTLMv2
- TLS transport encryption
- Standard RDP security (RC4) fallback for legacy servers
- Pure TypeScript RDP protocol stack (no external binaries)
- HTML5 Canvas bitmap rendering with RLE decompression
- Web Audio API for PCM audio playback
- Custom frameless title bar with minimize/maximize/close/pin
- Global debug logging toggle (visible in session windows)
- In-app auto-update with progress indicator
- Manual "Check for Updates" button
- RD Gateway support (configurable per connection)
- Connection duplication
- Last-connected timestamp tracking
- Cross-platform: Windows (NSIS installer + portable), macOS (DMG, universal binary), Linux (AppImage, deb, rpm, snap)
- Version display in title bar
- Open source (MIT license)

## Appendix B: Competitor Landscape (for positioning context)

| Competitor | Platform | Notes |
|-----------|----------|-------|
| **Microsoft Remote Desktop (mstsc.exe)** | Windows only | Built-in but dated UI, no macOS/Linux |
| **Microsoft Remote Desktop (Mac App Store)** | macOS | Limited features, no Linux |
| **Remmina** | Linux | GTK-based, Linux-only, dated UI |
| **FreeRDP** | Cross-platform | Command-line focused, not user-friendly |
| **Royal TS** | Windows/macOS | Commercial ($$$), feature-heavy |
| **mRemoteNG** | Windows | Open source but Windows-only, old UI |
| **Parsec** | Cross-platform | Gaming-focused, not RDP |
| **RustDesk** | Cross-platform | Different protocol (not RDP), self-hosted |

**RDPea's differentiators:**
- Cross-platform with a **single modern UI** (not three different codebases)
- **Free and open source** (vs. Royal TS at $50+/seat)
- **Pure TypeScript** RDP implementation (no mstsc.exe or FreeRDP dependency)
- **Hyper-V integration** (unique — no other RDP client does this)
- **Modern dark UI** with glassmorphism (vs. Win32-era GUIs)
- **Encrypted credential storage** built-in (not plaintext .rdp files)
