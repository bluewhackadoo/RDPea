#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Downloads RDPea release artifacts and updates package manager manifests with SHA256 hashes.

.DESCRIPTION
    This script downloads all release artifacts from the latest GitHub release,
    calculates their SHA256 hashes, and automatically updates the package manager
    manifest files (Winget, Chocolatey, Homebrew, Snap).

.PARAMETER Version
    The version to download (e.g., "1.0.4"). Defaults to latest release.

.EXAMPLE
    .\update-package-manifests.ps1 -Version "1.0.4"
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Configuration
$Owner = "bluewhackadoo"
$Repo = "RDPea"
$DownloadDir = $PSScriptRoot

# GitHub API
$ApiBase = "https://api.github.com/repos/$Owner/$Repo"

Write-Host "=== RDPea Package Manifest Updater ===" -ForegroundColor Cyan
Write-Host ""

# Get version from latest release if not specified
if (-not $Version) {
    Write-Host "Fetching latest release..." -ForegroundColor Yellow
    $LatestRelease = Invoke-RestMethod -Uri "$ApiBase/releases/latest"
    $Version = $LatestRelease.tag_name -replace '^v', ''
    Write-Host "Latest version: $Version" -ForegroundColor Green
} else {
    $Version = $Version -replace '^v', ''
}

$Tag = "v$Version"
$ReleaseUrl = "https://github.com/$Owner/$Repo/releases/download/$Tag"

# Define artifacts to download
$Artifacts = @(
    @{
        Name = "Windows Setup"
        File = "RDPea-Setup-$Version.exe"
        Url = "$ReleaseUrl/RDPea-Setup-$Version.exe"
    },
    @{
        Name = "Windows Portable"
        File = "RDPea-Portable-$Version.exe"
        Url = "$ReleaseUrl/RDPea-Portable-$Version.exe"
    },
    @{
        Name = "macOS DMG (arm64)"
        File = "RDPea-$Version-arm64.dmg"
        Url = "$ReleaseUrl/RDPea-$Version-arm64.dmg"
    },
    @{
        Name = "macOS DMG (x64)"
        File = "RDPea-$Version-x64.dmg"
        Url = "$ReleaseUrl/RDPea-$Version-x64.dmg"
    },
    @{
        Name = "Linux AppImage"
        File = "RDPea-$Version-x86_64.AppImage"
        Url = "$ReleaseUrl/RDPea-$Version-x86_64.AppImage"
    },
    @{
        Name = "Linux Deb"
        File = "RDPea-$Version-amd64.deb"
        Url = "$ReleaseUrl/RDPea-$Version-amd64.deb"
    }
)

# Download artifacts and calculate hashes
Write-Host ""
Write-Host "Downloading artifacts..." -ForegroundColor Yellow
$Hashes = @{}

foreach ($Artifact in $Artifacts) {
    $FilePath = Join-Path $DownloadDir $Artifact.File
    
    Write-Host "  - $($Artifact.Name)..." -NoNewline
    
    try {
        # Download file
        Invoke-WebRequest -Uri $Artifact.Url -OutFile $FilePath -ErrorAction Stop
        
        # Calculate SHA256
        $Hash = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
        $Hashes[$Artifact.File] = $Hash
        
        Write-Host " OK" -ForegroundColor Green
        Write-Host "    SHA256: $Hash" -ForegroundColor Gray
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Update package manifests
Write-Host ""
Write-Host "Updating package manifests..." -ForegroundColor Yellow

# 1. Update Winget manifest
$WingetManifest = Join-Path $PSScriptRoot "..\packaging\winget\bluewhackadoo.RDPea.yaml"
if (Test-Path $WingetManifest) {
    Write-Host "  - Winget manifest..." -NoNewline
    $Content = Get-Content $WingetManifest -Raw
    
    # Update version
    $Content = $Content -replace 'PackageVersion: [\d\.]+', "PackageVersion: $Version"
    
    # Update installer URL
    $Content = $Content -replace 'InstallerUrl: https://github\.com/[^/]+/[^/]+/releases/download/v[\d\.]+/[^\s]+', 
                                  "InstallerUrl: $ReleaseUrl/RDPea-Setup-$Version.exe"
    
    # Update SHA256
    $SetupHash = $Hashes["RDPea-Setup-$Version.exe"]
    if ($SetupHash) {
        $Content = $Content -replace 'InstallerSha256: [a-fA-F0-9]+', "InstallerSha256: $SetupHash"
    }
    
    # Update release notes URL
    $Content = $Content -replace 'ReleaseNotesUrl: https://github\.com/[^/]+/[^/]+/releases/tag/v[\d\.]+',
                                  "ReleaseNotesUrl: https://github.com/$Owner/$Repo/releases/tag/$Tag"
    
    Set-Content -Path $WingetManifest -Value $Content -NoNewline
    Write-Host " OK" -ForegroundColor Green
}

# 2. Update Chocolatey nuspec
$ChocoNuspec = Join-Path $PSScriptRoot "..\packaging\chocolatey\rdpea.nuspec"
if (Test-Path $ChocoNuspec) {
    Write-Host "  - Chocolatey nuspec..." -NoNewline
    $Content = Get-Content $ChocoNuspec -Raw
    
    # Update version
    $Content = $Content -replace '<version>[\d\.]+</version>', "<version>$Version</version>"
    
    # Update release notes
    $Content = $Content -replace '<releaseNotes>https://github\.com/[^<]+</releaseNotes>',
                                  "<releaseNotes>https://github.com/$Owner/$Repo/releases/tag/$Tag</releaseNotes>"
    
    Set-Content -Path $ChocoNuspec -Value $Content -NoNewline
    Write-Host " OK" -ForegroundColor Green
}

# 3. Update Chocolatey install script
$ChocoInstall = Join-Path $PSScriptRoot "..\packaging\chocolatey\tools\chocolateyinstall.ps1"
if (Test-Path $ChocoInstall) {
    Write-Host "  - Chocolatey install script..." -NoNewline
    $Content = Get-Content $ChocoInstall -Raw
    
    # Update URL
    $Content = $Content -replace "\`$url64\s*=\s*'https://github\.com/[^']+\.exe'",
                                  "`$url64      = '$ReleaseUrl/RDPea-Setup-$Version.exe'"
    
    # Update checksum
    $SetupHash = $Hashes["RDPea-Setup-$Version.exe"]
    if ($SetupHash) {
        $Content = $Content -replace "checksum64\s*=\s*'[a-fA-F0-9]+'", "checksum64    = '$SetupHash'"
    }
    
    Set-Content -Path $ChocoInstall -Value $Content -NoNewline
    Write-Host " OK" -ForegroundColor Green
}

# 4. Update Homebrew formula
$HomebrewFormula = Join-Path $PSScriptRoot "..\packaging\homebrew\rdpea.rb"
if (Test-Path $HomebrewFormula) {
    Write-Host "  - Homebrew formula..." -NoNewline
    $Content = Get-Content $HomebrewFormula -Raw
    
    # Update version
    $Content = $Content -replace 'version "[\d\.]+"', "version `"$Version`""
    
    # Update ARM64 SHA256 (default)
    $Arm64Hash = $Hashes["RDPea-$Version-arm64.dmg"]
    if ($Arm64Hash) {
        $Content = $Content -replace 'sha256 "[a-fA-F0-9]+"', "sha256 `"$Arm64Hash`""
    }
    
    # Note: Intel SHA256 would need separate handling in the formula
    # For now, we'll add a comment
    $X64Hash = $Hashes["RDPea-$Version-x64.dmg"]
    if ($X64Hash) {
        Write-Host ""
        Write-Host "    Note: x64 DMG SHA256: $X64Hash" -ForegroundColor Gray
        Write-Host "    (Manual update needed for on_intel block)" -ForegroundColor Gray
    }
    
    Set-Content -Path $HomebrewFormula -Value $Content -NoNewline
    Write-Host " OK" -ForegroundColor Green
}

# 5. Update Snapcraft config
$SnapConfig = Join-Path $PSScriptRoot "..\packaging\snap\snapcraft.yaml"
if (Test-Path $SnapConfig) {
    Write-Host "  - Snapcraft config..." -NoNewline
    $Content = Get-Content $SnapConfig -Raw
    
    # Update version
    $Content = $Content -replace "version: '[^']+\'", "version: '$Version'"
    
    Set-Content -Path $SnapConfig -Value $Content -NoNewline
    Write-Host " OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Version: $Version" -ForegroundColor Green
Write-Host "Downloaded artifacts: $($Hashes.Count)" -ForegroundColor Green
Write-Host ""
Write-Host "Package manifests updated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Review the changes in packaging/ directory"
Write-Host "  2. Commit and push the updated manifests"
Write-Host "  3. Submit to package managers (see packaging/README.md)"
Write-Host ""
