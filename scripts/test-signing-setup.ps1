# Test Azure Trusted Signing Setup
# This script helps you test your Azure signing configuration locally
#
# Usage:
#   Interactive: .\scripts\test-signing-setup.ps1
#   With params: .\scripts\test-signing-setup.ps1 -TenantId "..." -ClientId "..." -ClientSecret "..." -Endpoint "..." -AccountName "..." -ProfileName "..."

param(
    [string]$TenantId,
    [string]$ClientId,
    [string]$ClientSecret,
    [string]$Endpoint,
    [string]$AccountName,
    [string]$ProfileName
)

Write-Host "=== Azure Trusted Signing Test Setup ===" -ForegroundColor Cyan
Write-Host ""

# Prompt for Azure credentials if not provided as parameters
if (-not $TenantId -or -not $ClientId -or -not $ClientSecret -or -not $Endpoint -or -not $AccountName -or -not $ProfileName) {
    Write-Host "Enter your Azure Trusted Signing credentials:" -ForegroundColor Yellow
    Write-Host "(You can find these in Azure Portal and your Service Principal output)" -ForegroundColor Gray
    Write-Host ""

    if (-not $TenantId) {
        $AZURE_TENANT_ID = Read-Host "Azure Tenant ID"
    } else {
        $AZURE_TENANT_ID = $TenantId
    }

    if (-not $ClientId) {
        $AZURE_CLIENT_ID = Read-Host "Azure Client ID (Service Principal App ID)"
    } else {
        $AZURE_CLIENT_ID = $ClientId
    }

    if (-not $ClientSecret) {
        $AZURE_CLIENT_SECRET_SECURE = Read-Host "Azure Client Secret (Service Principal Password)" -AsSecureString
        $AZURE_CLIENT_SECRET_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AZURE_CLIENT_SECRET_SECURE))
    } else {
        $AZURE_CLIENT_SECRET_PLAIN = $ClientSecret
    }

    if (-not $Endpoint) {
        $AZURE_ENDPOINT = Read-Host "Azure Signing Endpoint (e.g., https://eus.codesigning.azure.net)"
    } else {
        $AZURE_ENDPOINT = $Endpoint
    }

    if (-not $AccountName) {
        $AZURE_CODE_SIGNING_NAME = Read-Host "Azure Code Signing Account Name"
    } else {
        $AZURE_CODE_SIGNING_NAME = $AccountName
    }

    if (-not $ProfileName) {
        $AZURE_CERT_PROFILE_NAME = Read-Host "Certificate Profile Name (e.g., RDPea-CertProf)"
    } else {
        $AZURE_CERT_PROFILE_NAME = $ProfileName
    }
} else {
    $AZURE_TENANT_ID = $TenantId
    $AZURE_CLIENT_ID = $ClientId
    $AZURE_CLIENT_SECRET_PLAIN = $ClientSecret
    $AZURE_ENDPOINT = $Endpoint
    $AZURE_CODE_SIGNING_NAME = $AccountName
    $AZURE_CERT_PROFILE_NAME = $ProfileName
}

Write-Host ""
Write-Host "Setting environment variables..." -ForegroundColor Yellow

$env:AZURE_TENANT_ID = $AZURE_TENANT_ID
$env:AZURE_CLIENT_ID = $AZURE_CLIENT_ID
$env:AZURE_CLIENT_SECRET = $AZURE_CLIENT_SECRET_PLAIN
$env:AZURE_ENDPOINT = $AZURE_ENDPOINT
$env:AZURE_CODE_SIGNING_NAME = $AZURE_CODE_SIGNING_NAME
$env:AZURE_CERT_PROFILE_NAME = $AZURE_CERT_PROFILE_NAME

Write-Host "✓ Environment variables set" -ForegroundColor Green
Write-Host ""

# Check if there's a built executable to test with
$exePath = $null
if (Test-Path "release\RDPea-Setup-*.exe") {
    $exePath = (Get-ChildItem "release\RDPea-Setup-*.exe" | Select-Object -First 1).FullName
    Write-Host "Found executable: $exePath" -ForegroundColor Green
} else {
    Write-Host "No executable found in release\ folder" -ForegroundColor Yellow
    Write-Host "Build one first with: npm run electron:build" -ForegroundColor Gray
    Write-Host ""
    $buildNow = Read-Host "Build now? (y/n)"
    if ($buildNow -eq "y") {
        Write-Host "Building..." -ForegroundColor Yellow
        npm run electron:build
        if (Test-Path "release\RDPea-Setup-*.exe") {
            $exePath = (Get-ChildItem "release\RDPea-Setup-*.exe" | Select-Object -First 1).FullName
            Write-Host "✓ Build complete: $exePath" -ForegroundColor Green
        } else {
            Write-Host "Build failed or no executable created" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "Skipping build. Run this script again after building." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "Installing Azure Trusted Signing dlib..." -ForegroundColor Yellow

# Download and install dlib if not already present
$dlibPath = "C:\TrustedSigning\Azure.CodeSigning.Dlib.dll"
if (-not (Test-Path $dlibPath)) {
    $dlibUrl = "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client"
    $tempDir = "$env:TEMP\TrustedSigning"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    
    Write-Host "Downloading Trusted Signing client..."
    Invoke-WebRequest -Uri $dlibUrl -OutFile "$tempDir\package.zip"
    
    Write-Host "Extracting..."
    Expand-Archive -Path "$tempDir\package.zip" -DestinationPath "$tempDir\package" -Force
    
    # Find and copy the dlib
    $dlibSource = Get-ChildItem -Path "$tempDir\package" -Recurse -Filter "Azure.CodeSigning.Dlib.dll" | Select-Object -First 1
    if ($dlibSource) {
        $dlibDest = "C:\TrustedSigning"
        New-Item -ItemType Directory -Force -Path $dlibDest | Out-Null
        Copy-Item $dlibSource.FullName -Destination "$dlibDest\Azure.CodeSigning.Dlib.dll"
        Write-Host "✓ Installed Azure.CodeSigning.Dlib.dll to $dlibDest" -ForegroundColor Green
        $env:AZURE_DLIB_PATH = "$dlibDest\Azure.CodeSigning.Dlib.dll"
    } else {
        Write-Host "✗ Failed to find Azure.CodeSigning.Dlib.dll in package" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Azure.CodeSigning.Dlib.dll already installed" -ForegroundColor Green
    $env:AZURE_DLIB_PATH = $dlibPath
}

Write-Host ""
Write-Host "Testing Azure signing..." -ForegroundColor Yellow
Write-Host ""

# Run the test signing script
node scripts/test-azure-sign.js "$exePath"

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If signing succeeded, you can now:" -ForegroundColor Green
Write-Host "  1. Add these values as GitHub secrets" -ForegroundColor Gray
Write-Host "  2. Push a tag to trigger the full workflow" -ForegroundColor Gray
Write-Host ""
