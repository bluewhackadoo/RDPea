# RDPea Distribution

## Release Artifacts

After a tagged build (`v*`), the CI produces:

| Platform | Artifact | Filename Pattern |
|----------|----------|-----------------|
| Windows  | NSIS Installer | `RDPea-Setup-{ver}.exe` |
| Windows  | Portable | `RDPea-Portable-{ver}.exe` |
| macOS    | DMG (arm64) | `RDPea-{ver}-arm64.dmg` |
| macOS    | DMG (x64) | `RDPea-{ver}-x64.dmg` |
| macOS    | ZIP (auto-update) | `RDPea-{ver}-arm64-mac.zip` / `-x64-mac.zip` |
| Linux    | AppImage | `RDPea-{ver}-x86_64.AppImage` |
| Linux    | Deb | `RDPea-{ver}-amd64.deb` |

Plus `latest.yml`, `latest-mac.yml`, `latest-linux.yml` for auto-update.

## How to Release

```bash
# 1. Bump version in package.json
# 2. Commit and tag
git add -A && git commit -m "Release v1.0.4"
git tag v1.0.4
git push origin main --tags
```

The CI workflow builds all platforms and publishes to GitHub Releases automatically.

---

## Package Manager Submission

### Winget (Windows)

1. Download `RDPea-Setup-{ver}.exe` from the GitHub Release
2. Get SHA256: `certutil -hashfile RDPea-Setup-1.0.3.exe SHA256`
3. Update `InstallerSha256` in `winget/bluewhackadoo.RDPea.yaml`
4. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
5. Copy manifest to `manifests/b/bluewhackadoo/RDPea/{ver}/`
6. Submit PR

### Chocolatey (Windows)

1. Get SHA256 of `RDPea-Setup-{ver}.exe`
2. Update `checksum64` in `chocolatey/tools/chocolateyinstall.ps1`
3. Update version in `chocolatey/rdpea.nuspec`
4. `cd packaging/chocolatey && choco pack`
5. Test: `choco install rdpea -s . -y`
6. Push: `choco push rdpea.{ver}.nupkg --source https://push.chocolatey.org/`

### Homebrew (macOS)

1. Get SHA256: `shasum -a 256 RDPea-{ver}-arm64.dmg`
2. Update `sha256` and `version` in `homebrew/rdpea.rb`
3. Fork [Homebrew/homebrew-cask](https://github.com/Homebrew/homebrew-cask)
4. Copy to `Casks/r/rdpea.rb`
5. Test: `brew install --cask rdpea`
6. Submit PR

### Snap (Linux)

1. Update `version` in `snap/snapcraft.yaml`
2. `sudo snap install snapcraft --classic`
3. `cd packaging/snap && snapcraft`
4. Test: `sudo snap install rdpea_*.snap --dangerous`
5. `snapcraft login && snapcraft upload rdpea_*.snap --release=stable`

---

## Version Bump Checklist

Update version in all of these files:
- `package.json` — `version`
- `packaging/winget/bluewhackadoo.RDPea.yaml` — `PackageVersion`, `InstallerUrl`, `ReleaseNotesUrl`
- `packaging/chocolatey/rdpea.nuspec` — `version`, `releaseNotes`
- `packaging/chocolatey/tools/chocolateyinstall.ps1` — `url64`
- `packaging/homebrew/rdpea.rb` — `version`
- `packaging/snap/snapcraft.yaml` — `version`
