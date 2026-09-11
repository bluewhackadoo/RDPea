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

## How releases reach the auto-updater (read before touching CI)

The in-app updater (electron-updater, GitHub provider) only ever sees **published** releases:

- It reads `https://github.com/bluewhackadoo/RDPea/releases.atom` (pre-release channels) or
  `/releases/latest` (stable). **Draft releases appear in neither**, so a draft is invisible to
  every installed client. electron-builder's `--publish` defaults to *draft* — the alpha/beta
  workflows therefore stamp `build.publish.releaseType = "prerelease"` before building.
- Alpha/beta clients (`allowPrerelease`) take the newest feed entry and read `alpha.yml`/`beta.yml`,
  falling back to `latest.yml`, which is what electron-builder actually generates. Keep that file
  attached to every pre-release.
- Stable (`build.yml`) creates **one draft** for the tag up front, every platform uploads into it,
  and `publish-release` flips it to published + latest only after the signed Windows build (with
  its post-signing `latest.yml`) is attached. Clients never see a half-populated release. If a
  platform job fails, re-run it: uploads use `--clobber`.
- Never let a platform job call `electron-builder --publish` on the stable tag: that creates a
  *second* draft with the same tag name and the platform's update manifest lands in the wrong place
  (this is why `v1.1.0` shipped without macOS assets).

Verify a deploy: the release must be non-draft, contain `latest.yml` (+ `latest-mac.yml`,
`latest-linux.yml`) and the installer it references, and the `sha512` in `latest.yml` must match
the uploaded (signed) exe.
