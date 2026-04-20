/**
 * Local test script for Azure Trusted Signing
 * This allows you to test signing without running the full GitHub Actions workflow
 * 
 * Usage:
 * 1. Set environment variables with your Azure credentials
 * 2. Build a test executable: bun run electron:build
 * 3. Run: bun scripts/test-azure-sign.js path/to/your.exe
 */

const azureSign = require('./azure-sign.js');
const path = require('path');

// Check if file path was provided
if (process.argv.length < 3) {
  console.error('Usage: bun scripts/test-azure-sign.js <path-to-exe>');
  console.error('Example: bun scripts/test-azure-sign.js release/RDPea-Setup-1.0.4.exe');
  process.exit(1);
}

const filePath = process.argv[2];

// Check required environment variables
const requiredEnvVars = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_ENDPOINT',
  'AZURE_CODE_SIGNING_NAME',
  'AZURE_CERT_PROFILE_NAME'
];

console.log('Checking environment variables...');
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('\n❌ Missing required environment variables:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\nSet them using:');
  console.error('  $env:AZURE_TENANT_ID="your-tenant-id"');
  console.error('  $env:AZURE_CLIENT_ID="your-client-id"');
  console.error('  $env:AZURE_CLIENT_SECRET="your-client-secret"');
  console.error('  $env:AZURE_ENDPOINT="https://xxx.codesigning.azure.net"');
  console.error('  $env:AZURE_CODE_SIGNING_NAME="your-account-name"');
  console.error('  $env:AZURE_CERT_PROFILE_NAME="RDPea-CertProf"');
  process.exit(1);
}

console.log('✓ All environment variables set\n');

// Test signing
const configuration = {
  path: path.resolve(filePath)
};

console.log(`Testing Azure signing on: ${configuration.path}\n`);

azureSign.default(configuration)
  .then(() => {
    console.log('\n✅ Signing test completed successfully!');
    console.log('\nTo verify the signature:');
    console.log(`  signtool verify /pa "${configuration.path}"`);
    console.log('  Or right-click the file → Properties → Digital Signatures');
  })
  .catch((error) => {
    console.error('\n❌ Signing test failed:', error.message);
    process.exit(1);
  });
