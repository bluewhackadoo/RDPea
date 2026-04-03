const { execSync } = require('child_process');
const path = require('path');

/**
 * Azure Trusted Signing integration for electron-builder
 * This script is called by electron-builder to sign Windows executables
 * using Azure Trusted Signing service via AzureSignTool.
 */
exports.default = async function(configuration) {
  // Check if Azure credentials are configured
  const requiredEnvVars = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID', 
    'AZURE_CLIENT_SECRET',
    'AZURE_ENDPOINT',
    'AZURE_CODE_SIGNING_NAME',
    'AZURE_CERT_PROFILE_NAME'
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.log(`Azure signing disabled - missing environment variables: ${missingVars.join(', ')}`);
    console.log('Skipping code signing...');
    return;
  }

  const filePath = configuration.path;
  console.log(`\nSigning ${path.basename(filePath)} with Azure Trusted Signing...`);

  try {
    // Install AzureSignTool if not already installed
    try {
      execSync('dotnet tool list -g', { stdio: 'pipe' });
    } catch {
      console.log('Installing .NET SDK tools...');
      execSync('dotnet tool install --global AzureSignTool', { stdio: 'inherit' });
    }

    // Check if AzureSignTool is installed
    try {
      execSync('azuresigntool --version', { stdio: 'pipe' });
    } catch {
      console.log('Installing AzureSignTool...');
      execSync('dotnet tool install --global AzureSignTool', { stdio: 'inherit' });
    }

    // Sign using AzureSignTool
    const signCommand = [
      'azuresigntool sign',
      `-kvu "${process.env.AZURE_ENDPOINT}"`,
      `-kvi "${process.env.AZURE_CLIENT_ID}"`,
      `-kvt "${process.env.AZURE_TENANT_ID}"`,
      `-kvs "${process.env.AZURE_CLIENT_SECRET}"`,
      `-kvc "${process.env.AZURE_CERT_PROFILE_NAME}"`,
      `-tr http://timestamp.digicert.com`,
      '-v',
      `"${filePath}"`
    ].join(' ');

    console.log('Running AzureSignTool...');
    execSync(signCommand, { 
      stdio: 'inherit',
      env: process.env 
    });
    
    console.log(`✓ Successfully signed: ${path.basename(filePath)}\n`);
  } catch (error) {
    console.error(`✗ Failed to sign ${path.basename(filePath)}:`, error.message);
    throw error;
  }
};
