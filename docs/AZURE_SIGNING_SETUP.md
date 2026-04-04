# Azure Trusted Signing Setup

This document explains how to configure Azure Trusted Signing for code signing Windows binaries in the RDPea project.

## Prerequisites

1. **Azure Account** with an active subscription
2. **Azure Trusted Signing** service set up
3. **Service Principal** created with appropriate permissions

## Azure Setup Steps

### 1. Create Azure Trusted Signing Account

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "Trusted Signing" and create a new account
3. Choose your subscription and resource group
4. Select a region (e.g., East US)
5. Complete the account creation

### 2. Create Service Principal

A Service Principal is the identity that will authenticate and sign your code.

**Using Azure CLI (Recommended):**

1. Open Azure Cloud Shell or install [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
2. Run the following command (replace `RDPea-Signing-SP` with your preferred name):

```bash
az ad sp create-for-rbac --name "RDPea-Signing-SP" --role "Trusted Signing Identity Verifier" --scopes /subscriptions/YOUR_SUBSCRIPTION_ID
```

3. **Save the output** - you'll need these values:
   - `appId` → This is your **AZURE_CLIENT_ID**
   - `password` → This is your **AZURE_CLIENT_SECRET**
   - `tenant` → This is your **AZURE_TENANT_ID**

**Using Azure Portal (Alternative):**

1. Go to Azure Portal → **Azure Active Directory** (or **Microsoft Entra ID**)
2. Click **App registrations** → **+ New registration**
3. Name: `RDPea-Signing-SP`
4. Click **Register**
5. Note the **Application (client) ID** → This is your **AZURE_CLIENT_ID**
6. Note the **Directory (tenant) ID** → This is your **AZURE_TENANT_ID**
7. Click **Certificates & secrets** → **+ New client secret**
8. Description: `GitHub Actions Signing`
9. Expiration: Choose duration (e.g., 24 months)
10. Click **Add**
11. **Copy the secret value immediately** → This is your **AZURE_CLIENT_SECRET** (you won't see it again!)

### 3. Create Certificate Profile

1. In your Trusted Signing account, go to "Certificate Profiles"
2. Click "+ Create"
3. Choose profile type:
   - **Public Trust**: For public distribution (requires identity validation)
   - **Private Trust**: For internal/testing (no validation required)
4. Complete the profile creation
5. Note the **Certificate Profile Name** (e.g., `RDPea-CertProf`)

### 4. Assign Service Principal Permissions

Now grant your Service Principal permission to sign with the certificate profile:

1. Go to your **Trusted Signing Account** → **Certificate Profiles**
2. Select your certificate profile (e.g., `RDPea-CertProf`)
3. Click **Access control (IAM)** in the left menu
4. Click **+ Add** → **Add role assignment**
5. Select role: **Trusted Signing Certificate Profile Signer**
6. Click **Next**
7. Click **+ Select members**
8. Search for your Service Principal name (e.g., `RDPea-Signing-SP`)
9. Select it and click **Select**
10. Click **Review + assign** twice

Wait 2-3 minutes for the permission to propagate.

### 5. Get Azure Endpoint and Account Name

```bash
# Create service principal
az ad sp create-for-rbac --name "RDPea-GitHub-Actions" --role "Trusted Signing Certificate Profile Signer" --scopes /subscriptions/{subscription-id}/resourceGroups/{resource-group}/providers/Microsoft.CodeSigning/codeSigningAccounts/{account-name}
```

This will output:
- `appId` (Client ID)
- `password` (Client Secret)
- `tenant` (Tenant ID)

## GitHub Secrets Configuration

Add the following secrets to your GitHub repository:

**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### Required Secrets

| Secret Name | Description | Example Value |
|------------|-------------|---------------|
| `AZURE_TENANT_ID` | Azure AD Tenant ID | `12345678-1234-1234-1234-123456789012` |
| `AZURE_CLIENT_ID` | Service Principal App ID | `87654321-4321-4321-4321-210987654321` |
| `AZURE_CLIENT_SECRET` | Service Principal Password | `your-secret-password` |
| `AZURE_SIGNING_ENDPOINT` | Trusted Signing Endpoint | `https://eus.codesigning.azure.net` |
| `AZURE_CODE_SIGNING_ACCOUNT_NAME` | Account Name | `RDPea-CodeSigning` |
| `AZURE_CERTIFICATE_PROFILE_NAME` | Certificate Profile Name | `RDPea-Production` |

### How to Add Secrets

1. Go to: https://github.com/bluewhackadoo/RDPea/settings/secrets/actions
2. Click **New repository secret**
3. Enter the **Name** and **Value**
4. Click **Add secret**
5. Repeat for all 6 secrets

## Verification

### Test the Signing

1. Create a new tag to trigger a release:
   ```bash
   git tag v1.0.4-test
   git push origin v1.0.4-test
   ```

2. Monitor the GitHub Actions workflow:
   - Go to: https://github.com/bluewhackadoo/RDPea/actions
   - Watch the "Build and Release" workflow
   - Check the "Setup Azure Trusted Signing" step

3. Download the signed executable from the release

4. Verify the signature on Windows:
   ```powershell
   # Right-click the .exe → Properties → Digital Signatures
   # Or use signtool:
   signtool verify /pa RDPea-Setup-1.0.4-test.exe
   ```

### Expected Output

When signed correctly, you should see:
- **Digital Signatures** tab in file properties
- **Signer**: bluewhackadoo
- **Timestamp**: Valid timestamp from DigiCert
- **Certificate Chain**: Valid and trusted

## Troubleshooting

### "Failed to sign" Error

- Verify all 6 GitHub secrets are set correctly
- Check that the Service Principal has the correct role assignment
- Ensure the Certificate Profile is active and not expired

### "Access Denied" Error

- The Service Principal needs "Trusted Signing Certificate Profile Signer" role
- Verify the scope includes the correct resource group and account

### 403 Forbidden Error
If you see `Status: 403 (Forbidden)` when signing, the Service Principal doesn't have permission to use the certificate profile.

**Fix:**
1. Go to Azure Portal → Your Trusted Signing Account → Certificate Profiles
2. Select your certificate profile (e.g., `RDPea-CertProf`)
3. Click **Access control (IAM)** in the left menu
4. Click **+ Add** → **Add role assignment**
5. Select role: **Trusted Signing Certificate Profile Signer**
6. Click **Next**
7. Click **+ Select members**
8. Search for your Service Principal by name (e.g., `RDPea-Signing-SP`)
9. Select it and click **Select**
10. Click **Review + assign** twice

Wait a few minutes for the permission to propagate, then try signing again.

### Signature Not Showing

- Ensure `AZURE_SIGN=true` environment variable is set in the workflow
- Check that `scripts/azure-sign.js` is being called
- Verify signtool.exe is available in the GitHub Actions runner

## Cost Considerations

Azure Trusted Signing pricing (as of 2026):
- **Certificate Profile**: ~$10/month
- **Signing Operations**: Free for first 5,000 signatures/month
- **Additional signatures**: $0.003 per signature

For RDPea's release frequency, expect ~$10-15/month.

## Security Best Practices

1. **Rotate secrets** every 90 days
2. **Use separate profiles** for production vs. testing
3. **Monitor signing operations** in Azure Portal
4. **Limit Service Principal permissions** to only what's needed
5. **Never commit secrets** to the repository

## References

- [Azure Trusted Signing Documentation](https://learn.microsoft.com/en-us/azure/trusted-signing/)
- [GitHub Actions Azure Integration](https://github.com/Azure/trusted-signing-action)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
