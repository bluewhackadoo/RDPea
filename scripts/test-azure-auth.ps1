# Test Azure Authentication for Trusted Signing
# This script tests if the Service Principal can authenticate to Azure

param(
    [string]$TenantId,
    [string]$ClientId,
    [string]$ClientSecret,
    [string]$Endpoint,
    [string]$AccountName,
    [string]$ProfileName
)

Write-Host "=== Azure Trusted Signing Authentication Test ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if credentials are provided
Write-Host "Test 1: Verifying credentials..." -ForegroundColor Yellow
if (-not $TenantId -or -not $ClientId -or -not $ClientSecret) {
    Write-Host "✗ Missing credentials" -ForegroundColor Red
    exit 1
}
Write-Host "✓ All credentials provided" -ForegroundColor Green
Write-Host "  Tenant ID: $TenantId" -ForegroundColor Gray
Write-Host "  Client ID: $ClientId" -ForegroundColor Gray
Write-Host "  Endpoint: $Endpoint" -ForegroundColor Gray
Write-Host "  Account: $AccountName" -ForegroundColor Gray
Write-Host "  Profile: $ProfileName" -ForegroundColor Gray
Write-Host ""

# Test 2: Try to get an access token
Write-Host "Test 2: Attempting to get Azure AD access token..." -ForegroundColor Yellow
try {
    $tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $body = @{
        client_id     = $ClientId
        client_secret = $ClientSecret
        scope         = "https://codesigning.azure.net/.default"
        grant_type    = "client_credentials"
    }
    
    $response = Invoke-RestMethod -Uri $tokenUrl -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
    
    if ($response.access_token) {
        Write-Host "✓ Successfully obtained access token" -ForegroundColor Green
        Write-Host "  Token type: $($response.token_type)" -ForegroundColor Gray
        Write-Host "  Expires in: $($response.expires_in) seconds" -ForegroundColor Gray
        
        # Decode the token to see claims (basic decode, not validation)
        $tokenParts = $response.access_token.Split('.')
        if ($tokenParts.Length -ge 2) {
            $payload = $tokenParts[1]
            # Add padding if needed
            while ($payload.Length % 4 -ne 0) {
                $payload += "="
            }
            $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload))
            $claims = $payloadJson | ConvertFrom-Json
            
            Write-Host ""
            Write-Host "  Token claims:" -ForegroundColor Gray
            Write-Host "    App ID: $($claims.appid)" -ForegroundColor Gray
            Write-Host "    Tenant ID: $($claims.tid)" -ForegroundColor Gray
            if ($claims.roles) {
                Write-Host "    Roles: $($claims.roles -join ', ')" -ForegroundColor Gray
            } else {
                Write-Host "    Roles: None (this might be the problem!)" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "✗ No access token in response" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Failed to get access token" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "=== Authentication Test Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If you see roles in the token claims above, authentication is working correctly." -ForegroundColor Green
Write-Host "If you don't see roles, the Service Principal may not have the correct role assignment." -ForegroundColor Yellow
Write-Host ""
