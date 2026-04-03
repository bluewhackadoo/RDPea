# Azure Trusted Signing Setup

This document explains how to configure Azure Trusted Signing for code signing Windows binaries in the RDPea project.

## Prerequisites

1. **Azure Account** with an active subscription
2. **Azure Trusted Signing** service set up
3. **Service Principal** created with appropriate permissions

## Azure Setup Steps

### 1. Create Azure Trusted Signing Account

1. Go to Azure Portal: https://portal.azure.com
2. Search for "Trusted Signing"
3. Create a new Trusted Signing account
4. Note the **Account Name** and **Endpoint URL**

### 2. Create Certificate Profile

1. In your Trusted Signing account, go to **Certificate Profiles**
2. Create a new profile (e.g., "RDPea-Production")
3. Configure the certificate details:
   - **Subject Name**: CN=bluewhackadoo
   - **Validity**: 1-3 years
   - **Key Usage**: Code Signing
4. Note the **Certificate Profile Name**

### 3. Create Service Principal

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
