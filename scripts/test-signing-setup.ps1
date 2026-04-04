# Test Azure Trusted Signing Setup
# This script helps you test your Azure signing configuration locally

Write-Host "=== Azure Trusted Signing Test Setup ===" -ForegroundColor Cyan
Write-Host ""

# Prompt for Azure credentials
Write-Host "Enter your Azure Trusted Signing credentials:" -ForegroundColor Yellow
Write-Host "(You can find these in Azure Portal and your Service Principal output)" -ForegroundColor Gray
Write-Host ""

$AZURE_TENANT_ID = Read-Host "Azure Tenant ID"
$AZURE_CLIENT_ID = Read-Host "Azure Client ID (Service Principal App ID)"
$AZURE_CLIENT_SECRET = Read-Host "Azure Client Secret (Service Principal Password)" -AsSecureString
$AZURE_CLIENT_SECRET_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AZURE_CLIENT_SECRET))
$AZURE_ENDPOINT = Read-Host "Azure Signing Endpoint (e.g., https://eus.codesigning.azure.net)"
$AZURE_CODE_SIGNING_NAME = Read-Host "Azure Code Signing Account Name"
$AZURE_CERT_PROFILE_NAME = Read-Host "Certificate Profile Name (e.g., RDPea-CertProf)"

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
