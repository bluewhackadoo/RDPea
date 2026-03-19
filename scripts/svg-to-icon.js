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
    
    // Read the SVG and extract just the pea sphere (strip text paths, crop viewBox)
    let svg = fs.readFileSync(svgPath, 'utf8');
    // Remove text <path> elements (the ones with long 'd' attrs containing glyph data)
    svg = svg.replace(/<path d="M[^"]{200,}"[^/]*\/>/g, '');
    // Crop viewBox to just the pea sphere area (within the translated group: x=74,y=7 size=70x70 + 1px padding)
    svg = svg.replace(/viewBox="0 0 143 143"/, 'viewBox="73 37 72 72"');
    const svgBuffer = Buffer.from(svg);
    
    const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

    // Generate 512x512 PNG (macOS requires 512x512 minimum)
    await sharp(svgBuffer)
      .resize(512, 512, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toFile(path.join(outDir, 'icon.png'));
    console.log('Icon generated: build/icon.png');
    
    // Generate multiple sizes for ICO (Windows)
    const icoSizes = [16, 32, 48, 256];
    const pngBuffers = await Promise.all(
      icoSizes.map(size =>
        sharp(svgBuffer)
          .resize(size, size, { fit: 'contain', background: TRANSPARENT })
          .png()
          .toBuffer()
      )
    );
    const ico = createICO(pngBuffers, icoSizes);
    fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
    console.log('Icon generated: build/icon.ico');

    // Generate multiple sizes in build/icons/ for Linux desktop integration
    const iconsDir = path.join(outDir, 'icons');
    if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
    const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
    await Promise.all(
      linuxSizes.map(async (size) => {
        const sizeDir = path.join(iconsDir, `${size}x${size}`);
        if (!fs.existsSync(sizeDir)) fs.mkdirSync(sizeDir, { recursive: true });
        await sharp(svgBuffer)
          .resize(size, size, { fit: 'contain', background: TRANSPARENT })
          .png()
          .toFile(path.join(sizeDir, 'icon.png'));
      })
    );
    console.log('Icons generated: build/icons/ (Linux multi-size)');
    
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
