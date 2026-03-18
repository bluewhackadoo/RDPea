// Convert Logo.svg to icon.png and icon.ico using sharp
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'build', 'Logo.svg');
const outDir = path.join(__dirname, '..', 'build');

async function convertSvgToIcons() {
  try {
    // Check if SVG file exists
    if (!fs.existsSync(svgPath)) {
      console.error(`Error: Logo.svg not found at ${svgPath}`);
      console.log('Skipping icon generation - using existing icons');
      process.exit(0);
    }
    
    // Read the SVG logo (now square 143x143)
    const svgBuffer = fs.readFileSync(svgPath);
    
    // Generate 512x512 PNG with the full RDPea logo (macOS requires 512x512 minimum)
    await sharp(svgBuffer)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .png()
      .toFile(path.join(outDir, 'icon.png'));
    
    console.log('Icon generated: build/icon.png');
    
    // Generate multiple sizes for ICO
    const sizes = [16, 32, 48, 256];
    const pngBuffers = await Promise.all(
      sizes.map(size =>
        sharp(svgBuffer)
          .resize(size, size, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          })
          .png()
          .toBuffer()
      )
    );
    
    // Create ICO file manually
    const ico = createICO(pngBuffers, sizes);
    fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
    console.log('Icon generated: build/icon.ico');
    
  } catch (error) {
    console.error('Error converting SVG:', error);
    process.exit(1);
  }
}

// Simple ICO file creator
function createICO(pngBuffers, sizes) {
  // ICO header: reserved (2) + type (2) + count (2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // Reserved
  header.writeUInt16LE(1, 2);  // Type: 1 = ICO
  header.writeUInt16LE(sizes.length, 4);  // Number of images
  
  // Directory entries: 16 bytes each
  let offset = 6 + (sizes.length * 16);
  const entries = pngBuffers.map((png, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = sizes[i] === 256 ? 0 : sizes[i];  // Width (0 = 256)
    entry[1] = sizes[i] === 256 ? 0 : sizes[i];  // Height (0 = 256)
    entry[2] = 0;  // Color palette
    entry[3] = 0;  // Reserved
    entry.writeUInt16LE(1, 4);  // Color planes
    entry.writeUInt16LE(32, 6);  // Bits per pixel
    entry.writeUInt32LE(png.length, 8);  // Image size
    entry.writeUInt32LE(offset, 12);  // Image offset
    offset += png.length;
    return entry;
  });
  
  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

convertSvgToIcons();
