const { execSync } = require('child_process');
const path = require('path');

/**
 * Azure Trusted Signing integration for electron-builder
 * This script is called by electron-builder to sign Windows executables
 * using Azure Trusted Signing service.
 */
exports.default = async function(configuration) {
  // Only sign if Azure signing is enabled
  if (!process.env.AZURE_SIGN) {
    console.log('Azure signing not enabled, skipping...');
    return;
  }

  const filePath = configuration.path;
  console.log(`Signing ${filePath} with Azure Trusted Signing...`);

  try {
    // The azure/trusted-signing-action sets up the signing tools
    // We use signtool.exe which is configured by the action
    const signCommand = `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 "${filePath}"`;
    
    execSync(signCommand, { 
      stdio: 'inherit',
      env: process.env 
    });
    
    console.log(`Successfully signed: ${filePath}`);
  } catch (error) {
    console.error(`Failed to sign ${filePath}:`, error.message);
    throw error;
  }
};
