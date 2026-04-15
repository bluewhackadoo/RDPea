# Direct SignTool test - bypasses electron-builder for clean output
# Usage: .\scripts\test-sign-direct.ps1

param(
    [string]$TenantId = "92ea4ce5-60ab-4310-812f-722685d40043",
    [string]$ClientId = "a7682d10-ddfa-40a8-bb37-e46e98734006",
    [string]$ClientSecret,
    [string]$Endpoint = "https://eus.codesigning.azure.net",
    [string]$AccountName = "RDPea",
    [string]$ProfileName = "RDPea-CertProf"
)

if (-not $ClientSecret) {
    $ClientSecret = Read-Host "Enter Client Secret"
}

Write-Host "`n=== Direct SignTool Test ===" -ForegroundColor Cyan

# Set environment variables for the dlib
$env:AZURE_TENANT_ID = $TenantId
$env:AZURE_CLIENT_ID = $ClientId
$env:AZURE_CLIENT_SECRET = $ClientSecret

# Find exe to sign
$exePath = Get-ChildItem "release\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exePath) {
    $exePath = Get-ChildItem "release\win-unpacked\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $exePath) {
    Write-Host "No exe found in release\ folder. Build first with: npm run electron:build" -ForegroundColor Red
    exit 1
}
Write-Host "Target: $($exePath.FullName)" -ForegroundColor Gray

# Create metadata JSON
$metadataFile = "$env:TEMP\azure-sign-metadata.json"
@{
    Endpoint = $Endpoint
    CodeSigningAccountName = $AccountName
    CertificateProfileName = $ProfileName
} | ConvertTo-Json | Out-File -FilePath $metadataFile -Encoding ascii
Write-Host "Metadata: $metadataFile" -ForegroundColor Gray

# Check dlib - ensure x64 version
$dlibPath = "C:\TrustedSigning\Azure.CodeSigning.Dlib.dll"
if (-not (Test-Path $dlibPath)) {
    Write-Host "`nDownloading Azure Trusted Signing dlib..." -ForegroundColor Yellow
    $tempDir = "$env:TEMP\TrustedSigning"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client" -OutFile "$tempDir\package.zip"
    Expand-Archive -Path "$tempDir\package.zip" -DestinationPath "$tempDir\package" -Force
    
    # Specifically get x64 version
    $x64Dlib = Get-ChildItem -Path "$tempDir\package" -Recurse -Filter "Azure.CodeSigning.Dlib.dll" | 
        Where-Object { $_.DirectoryName -match 'x64' } | Select-Object -First 1
    
    if (-not $x64Dlib) {
        # Fall back to any version
        $x64Dlib = Get-ChildItem -Path "$tempDir\package" -Recurse -Filter "Azure.CodeSigning.Dlib.dll" | Select-Object -First 1
    }
    
    if ($x64Dlib) {
        New-Item -ItemType Directory -Force -Path "C:\TrustedSigning" | Out-Null
        Copy-Item $x64Dlib.FullName -Destination $dlibPath
        Write-Host "Installed dlib from: $($x64Dlib.FullName)" -ForegroundColor Green
    } else {
        Write-Host "Failed to find dlib in NuGet package" -ForegroundColor Red
        exit 1
    }
}

# Verify dlib architecture
$dlibSize = (Get-Item $dlibPath).Length
Write-Host "Dlib: $dlibPath ($dlibSize bytes)" -ForegroundColor Gray

# Find signtool
$signtoolPath = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
if (-not (Test-Path $signtoolPath)) {
    $sdkBase = "C:\Program Files (x86)\Windows Kits\10\bin"
    $versions = Get-ChildItem $sdkBase -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object Name -Descending
    foreach ($v in $versions) {
        $test = Join-Path $v.FullName "x64\signtool.exe"
        if (Test-Path $test) { $signtoolPath = $test; break }
    }
}
Write-Host "SignTool: $signtoolPath" -ForegroundColor Gray

# Make a copy of the exe so we don't modify the original
$testExe = "$env:TEMP\test-sign-rdpea.exe"
Copy-Item $exePath.FullName -Destination $testExe -Force
Write-Host "Test copy: $testExe" -ForegroundColor Gray

Write-Host "`n--- Running SignTool (no /a flag) ---" -ForegroundColor Yellow
Write-Host ""

$result = & $signtoolPath sign /v /debug /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $dlibPath /dmdf $metadataFile $testExe 2>&1
$exitCode = $LASTEXITCODE

Write-Host ""
foreach ($line in $result) {
    Write-Host $line
}

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "SUCCESS! Exit code: $exitCode" -ForegroundColor Green
    
    Write-Host "`n--- Verifying signature ---" -ForegroundColor Yellow
    & $signtoolPath verify /pa /v $testExe 2>&1 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "FAILED. Exit code: $exitCode" -ForegroundColor Red
    
    Write-Host "`n--- Retrying with /a flag ---" -ForegroundColor Yellow
    Write-Host ""
    
    Copy-Item $exePath.FullName -Destination $testExe -Force
    $result2 = & $signtoolPath sign /v /debug /a /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $dlibPath /dmdf $metadataFile $testExe 2>&1
    $exitCode2 = $LASTEXITCODE
    
    Write-Host ""
    foreach ($line in $result2) {
        Write-Host $line
    }
    
    Write-Host ""
    if ($exitCode2 -eq 0) {
        Write-Host "SUCCESS with /a! Exit code: $exitCode2" -ForegroundColor Green
    } else {
        Write-Host "FAILED with /a too. Exit code: $exitCode2" -ForegroundColor Red
        Write-Host "`nThe dlib may not be providing a certificate. Check:" -ForegroundColor Yellow
        Write-Host "  1. Role assignment propagation (wait 15-30 min)" -ForegroundColor Gray
        Write-Host "  2. Correct x64 dlib version" -ForegroundColor Gray
        Write-Host "  3. Certificate profile is Active in Azure" -ForegroundColor Gray
    }
}

# Clean up
Remove-Item $testExe -Force -ErrorAction SilentlyContinue
Remove-Item $metadataFile -Force -ErrorAction SilentlyContinue
