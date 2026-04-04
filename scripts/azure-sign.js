const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Azure Trusted Signing integration for electron-builder
 * This script is called by electron-builder to sign Windows executables
 * using Azure Trusted Signing service via SignTool.exe with dlib extension.
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
    // Create a temporary JSON file with Azure credentials for dlib
    const credentialsFile = path.join(os.tmpdir(), `azure-creds-${Date.now()}.json`);
    const credentials = {
      "Endpoint": process.env.AZURE_ENDPOINT,
      "CodeSigningAccountName": process.env.AZURE_CODE_SIGNING_NAME,
      "CertificateProfileName": process.env.AZURE_CERT_PROFILE_NAME
    };
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials, null, 2));

    // Set environment variables for Azure authentication
    const env = {
      ...process.env,
      AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
      AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
      AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET
    };

    // Find the Azure Code Signing dlib
    let dlibPath = null;
    
    // Check if AZURE_DLIB_PATH is set (from GitHub Actions)
    if (process.env.AZURE_DLIB_PATH && fs.existsSync(process.env.AZURE_DLIB_PATH)) {
      dlibPath = process.env.AZURE_DLIB_PATH;
    }
    
    // Fall back to common locations
    if (!dlibPath) {
      const possibleDlibPaths = [
        'C:\\TrustedSigning\\Azure.CodeSigning.Dlib.dll',
        'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\Azure.CodeSigning.Dlib.dll',
        'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\Azure.CodeSigning.Dlib.dll',
        'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\Azure.CodeSigning.Dlib.dll',
        'C:\\Users\\bluew\\AppData\\Local\\Microsoft\\MicrosoftArtifactSigningClientTools\\Azure.CodeSigning.Dlib.dll'
      ];

      dlibPath = possibleDlibPaths.find(p => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });
    }

    if (!dlibPath) {
      // Try to find it dynamically
      try {
        const windowsKitsBase = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
        if (fs.existsSync(windowsKitsBase)) {
          const versions = fs.readdirSync(windowsKitsBase)
            .filter(f => f.match(/^\d+\.\d+\.\d+\.\d+$/))
            .sort()
            .reverse();
          
          for (const version of versions) {
            const testPath = path.join(windowsKitsBase, version, 'x64', 'Azure.CodeSigning.Dlib.dll');
            if (fs.existsSync(testPath)) {
              dlibPath = testPath;
              break;
            }
          }
        }
      } catch (e) {
        console.warn('Could not auto-detect dlib path:', e.message);
      }
    }

    if (!dlibPath) {
      throw new Error('Azure.CodeSigning.Dlib.dll not found. Please ensure Windows SDK with Azure Code Signing is installed.');
    }

    console.log(`Using dlib: ${dlibPath}`);

    // Find SignTool.exe
    let signToolPath = null;
    const possibleSignToolPaths = [
      'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe',
      'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe'
    ];

    signToolPath = possibleSignToolPaths.find(p => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    // Try to find it dynamically if not found
    if (!signToolPath) {
      try {
        const windowsKitsBase = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
        if (fs.existsSync(windowsKitsBase)) {
          const versions = fs.readdirSync(windowsKitsBase)
            .filter(f => f.match(/^\d+\.\d+\.\d+\.\d+$/))
            .sort()
            .reverse();
          
          for (const version of versions) {
            const testPath = path.join(windowsKitsBase, version, 'x64', 'signtool.exe');
            if (fs.existsSync(testPath)) {
              signToolPath = testPath;
              break;
            }
          }
        }
      } catch (e) {
        console.warn('Could not auto-detect signtool path:', e.message);
      }
    }

    if (!signToolPath) {
      throw new Error('signtool.exe not found. Please install Windows SDK from https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/');
    }

    console.log(`Using signtool: ${signToolPath}`);

    // Use SignTool.exe with Azure Trusted Signing dlib
    const signCommand = [
      `"${signToolPath}" sign`,
      '/v',
      '/debug',
      '/fd SHA256',
      '/tr "http://timestamp.acs.microsoft.com"',
      '/td SHA256',
      `/dlib "${dlibPath}"`,
      `/dmdf "${credentialsFile}"`,
      `"${filePath}"`
    ].join(' ');

    console.log('Running SignTool with Azure Trusted Signing...');
    execSync(signCommand, { 
      stdio: 'inherit',
      env: env,
      shell: true
    });
    
    // Clean up credentials file
    try {
      fs.unlinkSync(credentialsFile);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    console.log(`✓ Successfully signed: ${path.basename(filePath)}\n`);
  } catch (error) {
    console.error(`✗ Failed to sign ${path.basename(filePath)}:`, error.message);
    throw error;
  }
};
