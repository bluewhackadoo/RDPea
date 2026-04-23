---
description: Alpha → Beta → Stable release process for RDPea using Bun toolchain
---

# Release Process

RDPea uses a three-channel release pipeline: **alpha → beta → main (stable)**.
All development uses **Bun** as the package manager and script runner.

## Branch Model

| Branch | Channel | Trigger | Auto-update target |
|--------|---------|---------|-------------------|
| `bun-migration` | Alpha | Push to branch | Pre-release (alpha) |
| `beta` | Beta | Push to branch | Pre-release (beta) |
| `main` | Stable | Tag `v*` | Stable release |

## Day-to-Day Development

1. Work on `bun-migration` branch
2. Every push builds cross-platform alpha packages via CI
3. Alpha builds are versioned as `{base}-alpha.{build_number}`
4. Test alpha builds locally or via GitHub Release artifacts

## Promoting Alpha → Beta

```bash
# Merge current alpha work into beta
git checkout beta
git merge bun-migration
git push origin beta
```

CI will automatically build beta packages versioned as `{base}-beta.{build_number}`.

## Promoting Beta → Stable (Reverse Integration)

Only when feature parity is confirmed:

```bash
# 1. Bump version in package.json (remove pre-release suffix)
# 2. Merge into main
git checkout main
git merge beta
# 3. Tag and push
git tag v1.x.x
git push origin main --tags
```

CI will build all platforms, sign Windows binaries, and publish to:
- GitHub Releases
- Winget, Chocolatey, Homebrew, Snap

## Local Development

```bash
# Install dependencies
bun install

# Run Vite dev server only (for frontend work)
bun run dev

# Run full Electron + Vite dev environment
bun run electron:dev

# Build production package
bun run electron:build

# Generate icons from SVG
bun run generate-icons
```

## Version Scheme

- **Alpha**: `1.0.11-alpha.42` — bleeding edge, may break
- **Beta**: `1.0.11-beta.15` — feature-complete, testing phase
- **Stable**: `1.0.11` — production release

The auto-updater respects channels: alpha/beta builds receive pre-release updates,
stable builds only receive stable updates.
