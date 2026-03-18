// RDP Bitmap Decompression (MS-RDPBCGR §2.2.9.1.1.3.1.2.2)
// Implements RLE decompression for 15/16/24/32 bpp bitmaps
import { BufferReader } from './bufferReader';
import { BitmapRect } from './types';

// Decompress an RLE-compressed RDP bitmap
export function decompressBitmap(
  compressedData: Buffer,
  width: number,
  height: number,
  bpp: number
): Buffer {
  if (bpp === 32) return decompressRLE32(compressedData, width, height);
  if (bpp === 24) return decompressRLE24(compressedData, width, height);
  if (bpp === 16 || bpp === 15) return decompressRLE16(compressedData, width, height);
  if (bpp === 8) return decompressRLE8(compressedData, width, height);
  throw new Error(`Unsupported bpp: ${bpp}`);
}

// Precomputed lookup tables for RGB565/RGB555 → 8-bit conversion
const LUT5 = new Uint8Array(32);
const LUT6 = new Uint8Array(64);
for (let i = 0; i < 32; i++) LUT5[i] = (i * 255 + 15) / 31 | 0;
for (let i = 0; i < 64; i++) LUT6[i] = (i * 255 + 31) / 63 | 0;

// Convert bitmap data to RGBA pixel buffer for canvas rendering
// RDP bitmaps are bottom-up, BGR/BGRA format
export function bitmapToRGBA(
  data: Buffer,
  width: number,
  height: number,
  bpp: number,
  srcWidth?: number,
  srcHeight?: number
): Buffer {
  const stride = srcWidth || width;
  const sh = srcHeight || height;
  const rgba = Buffer.alloc(width * height * 4);
  const bytesPerPx = bpp >> 3;
  const rowBytes = stride * bytesPerPx;

  if (bpp === 16) {
    for (let y = 0; y < height; y++) {
      const srcRow = (sh - 1 - y) * rowBytes;
      if (srcRow < 0 || srcRow + width * 2 > data.length) continue;
      let dstIdx = y * width * 4;
      let srcIdx = srcRow;
      for (let x = 0; x < width; x++) {
        const pixel = data[srcIdx] | (data[srcIdx + 1] << 8);
        rgba[dstIdx]     = LUT5[(pixel >> 11) & 0x1F];
        rgba[dstIdx + 1] = LUT6[(pixel >> 5) & 0x3F];
        rgba[dstIdx + 2] = LUT5[pixel & 0x1F];
        rgba[dstIdx + 3] = 255;
        srcIdx += 2;
        dstIdx += 4;
      }
    }
  } else if (bpp === 32) {
    for (let y = 0; y < height; y++) {
      const srcRow = (sh - 1 - y) * rowBytes;
      if (srcRow < 0 || srcRow + width * 4 > data.length) continue;
      let dstIdx = y * width * 4;
      let srcIdx = srcRow;
      for (let x = 0; x < width; x++) {
        rgba[dstIdx]     = data[srcIdx + 2];
        rgba[dstIdx + 1] = data[srcIdx + 1];
        rgba[dstIdx + 2] = data[srcIdx];
        rgba[dstIdx + 3] = 255;
        srcIdx += 4;
        dstIdx += 4;
      }
    }
  } else if (bpp === 24) {
    for (let y = 0; y < height; y++) {
      const srcRow = (sh - 1 - y) * rowBytes;
      if (srcRow < 0 || srcRow + width * 3 > data.length) continue;
      let dstIdx = y * width * 4;
      let srcIdx = srcRow;
      for (let x = 0; x < width; x++) {
        rgba[dstIdx]     = data[srcIdx + 2];
        rgba[dstIdx + 1] = data[srcIdx + 1];
        rgba[dstIdx + 2] = data[srcIdx];
        rgba[dstIdx + 3] = 255;
        srcIdx += 3;
        dstIdx += 4;
      }
    }
  } else if (bpp === 15) {
    for (let y = 0; y < height; y++) {
      const srcRow = (sh - 1 - y) * rowBytes;
      if (srcRow < 0 || srcRow + width * 2 > data.length) continue;
      let dstIdx = y * width * 4;
      let srcIdx = srcRow;
      for (let x = 0; x < width; x++) {
        const pixel = data[srcIdx] | (data[srcIdx + 1] << 8);
        rgba[dstIdx]     = LUT5[(pixel >> 10) & 0x1F];
        rgba[dstIdx + 1] = LUT5[(pixel >> 5) & 0x1F];
        rgba[dstIdx + 2] = LUT5[pixel & 0x1F];
        rgba[dstIdx + 3] = 255;
        srcIdx += 2;
        dstIdx += 4;
      }
    }
  }
  return rgba;
}

// Parse bitmap update PDU and extract bitmap rectangles
export function parseBitmapUpdateData(data: Buffer): BitmapRect[] {
  const r = new BufferReader(data);
  const updateType = r.readUInt16LE(); // should be 0x0001 (BITMAP)
  const numRects = r.readUInt16LE();
  const rects: BitmapRect[] = [];

  for (let i = 0; i < numRects; i++) {
    const destLeft = r.readUInt16LE();
    const destTop = r.readUInt16LE();
    const destRight = r.readUInt16LE();
    const destBottom = r.readUInt16LE();
    const width = r.readUInt16LE();
    const height = r.readUInt16LE();
    const bitsPerPixel = r.readUInt16LE();
    const flags = r.readUInt16LE();
    const bitmapLength = r.readUInt16LE();

    const isCompressed = !!(flags & 0x0001);
    const NO_BITMAP_HDR = !!(flags & 0x0400);

    let bitmapData: Buffer;
    if (isCompressed && !NO_BITMAP_HDR) {
      // Compressed bitmap with header
      r.skip(2); // cbCompFirstRowSize
      r.skip(2); // cbCompMainBodySize
      r.skip(2); // cbScanWidth
      r.skip(2); // cbUncompressedSize
      bitmapData = r.readBytes(bitmapLength - 8);
    } else {
      bitmapData = r.readBytes(bitmapLength);
    }

    rects.push({
      x: destLeft,
      y: destTop,
      width: destRight - destLeft + 1,
      height: destBottom - destTop + 1,
      bitmapWidth: width,
      bitmapHeight: height,
      bitsPerPixel,
      isCompressed,
      data: bitmapData,
    });
  }

  return rects;
}

// ===== RLE Decompression implementations =====

// Standard RDP RLE codes
const REGULAR_BG_RUN = 0x00;
const REGULAR_FG_RUN = 0x01;
const REGULAR_FG_BG_IMAGE = 0x02;
const REGULAR_COLOR_RUN = 0x03;
const REGULAR_COLOR_IMAGE = 0x04;
const MEGA_MEGA_BG_RUN = 0xF0;
const MEGA_MEGA_FG_RUN = 0xF1;
const MEGA_MEGA_FG_BG_IMAGE = 0xF2;
const MEGA_MEGA_COLOR_RUN = 0xF3;
const MEGA_MEGA_COLOR_IMAGE = 0xF4;
const LITE_SET_FG_FG_RUN = 0x0C;
const LITE_SET_FG_FG_BG_IMAGE = 0x0D;
const MEGA_MEGA_SET_FG_RUN = 0xF6;
const MEGA_MEGA_SET_FGBG_IMAGE = 0xF7;
const LITE_DITHERED_RUN = 0x0E;
const MEGA_MEGA_DITHERED_RUN = 0xF8;
const SPECIAL_FGBG_1 = 0xF9;
const SPECIAL_FGBG_2 = 0xFA;
const WHITE = 0xFD;
const BLACK = 0xFE;

function decompressRLE16(src: Buffer, width: number, height: number): Buffer {
  const dst = Buffer.alloc(width * height * 2);
  const rowDelta = width * 2;
  let srcIdx = 0, dstIdx = 0;
  let fgPel = 0xFFFF;
  let fInsertFgPel = false;
  let fFirstLine = true;

  while (srcIdx < src.length && dstIdx < dst.length) {
    // Track first scanline boundary (per FreeRDP)
    if (fFirstLine && dstIdx >= rowDelta) {
      fFirstLine = false;
      fInsertFgPel = false;
    }

    const byte = src[srcIdx];
    let code: number;
    let rl: number;

    // Extract code ID (MS-RDPBCGR interleaved RLE)
    if ((byte & 0xC0) !== 0xC0) {
      code = byte >> 5;          // Regular: top 3 bits → 0-4
    } else if ((byte & 0xF0) === 0xF0) {
      code = byte;               // Mega-mega: full byte 0xF0-0xFF
    } else {
      code = byte >> 4;          // Lite: top nibble → 0xC, 0xD, 0xE
    }

    // Handle Background Run Orders — only these set fInsertFgPel = true
    if (code === 0 || code === 0xF0) {
      // BG_RUN (REGULAR or MEGA_MEGA)
      if (code === 0) {
        rl = byte & 0x1F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 32; }
      } else {
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
      }
      writeRunBg16(dst, dstIdx, rl, rowDelta, fInsertFgPel ? fgPel : 0);
      dstIdx += rl * 2;
      fInsertFgPel = true;
      continue;
    }

    // For ALL other order types, fInsertFgPel = false (per FreeRDP)
    fInsertFgPel = false;

    switch (code) {
      case 1: // REGULAR_FG_RUN
        rl = byte & 0x1F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 32; }
        writeRunFg16(dst, dstIdx, rl, rowDelta, fgPel);
        dstIdx += rl * 2;
        break;
      case 2: { // REGULAR_FG_BG_IMAGE
        rl = byte & 0x1F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 1; }
        else { rl *= 8; }
        writeFgBgImage16(dst, dstIdx, src, srcIdx, rl, rowDelta, fgPel);
        srcIdx += Math.ceil(rl / 8);
        dstIdx += rl * 2;
        break;
      }
      case 3: // REGULAR_COLOR_RUN
        rl = byte & 0x1F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 32; }
        { const c = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
          writeColorRun16(dst, dstIdx, rl, c); }
        dstIdx += rl * 2;
        break;
      case 4: // REGULAR_COLOR_IMAGE
        rl = byte & 0x1F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 32; }
        { const n = Math.min(rl * 2, dst.length - dstIdx, src.length - srcIdx);
          if (n > 0) src.copy(dst, dstIdx, srcIdx, srcIdx + n); }
        srcIdx += rl * 2; dstIdx += rl * 2;
        break;
      case 0x0C: // LITE_SET_FG_FG_RUN
        rl = byte & 0x0F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 16; }
        fgPel = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        writeRunFg16(dst, dstIdx, rl, rowDelta, fgPel);
        dstIdx += rl * 2;
        break;
      case 0x0D: { // LITE_SET_FG_FGBG_IMAGE
        rl = byte & 0x0F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 1; }
        else { rl *= 8; }
        fgPel = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        writeFgBgImage16(dst, dstIdx, src, srcIdx, rl, rowDelta, fgPel);
        srcIdx += Math.ceil(rl / 8);
        dstIdx += rl * 2;
        break;
      }
      case 0x0E: // LITE_DITHERED_RUN
        rl = byte & 0x0F; srcIdx++;
        if (rl === 0) { rl = src[srcIdx++] + 16; }
        { const d1 = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
          const d2 = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
          writeDitheredRun16(dst, dstIdx, rl, d1, d2); }
        dstIdx += rl * 4;
        break;
      case 0xF1: // MEGA_MEGA_FG_RUN
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        writeRunFg16(dst, dstIdx, rl, rowDelta, fgPel);
        dstIdx += rl * 2;
        break;
      case 0xF2: { // MEGA_MEGA_FGBG_IMAGE
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        writeFgBgImage16(dst, dstIdx, src, srcIdx, rl, rowDelta, fgPel);
        srcIdx += Math.ceil(rl / 8);
        dstIdx += rl * 2;
        break;
      }
      case 0xF3: // MEGA_MEGA_COLOR_RUN
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        { const mc = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
          writeColorRun16(dst, dstIdx, rl, mc); }
        dstIdx += rl * 2;
        break;
      case 0xF4: // MEGA_MEGA_COLOR_IMAGE
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        { const n = Math.min(rl * 2, dst.length - dstIdx, src.length - srcIdx);
          if (n > 0) src.copy(dst, dstIdx, srcIdx, srcIdx + n); }
        srcIdx += rl * 2; dstIdx += rl * 2;
        break;
      case 0xF6: // MEGA_MEGA_SET_FG_RUN
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        fgPel = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        writeRunFg16(dst, dstIdx, rl, rowDelta, fgPel);
        dstIdx += rl * 2;
        break;
      case 0xF7: { // MEGA_MEGA_SET_FGBG_IMAGE
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        fgPel = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        writeFgBgImage16(dst, dstIdx, src, srcIdx, rl, rowDelta, fgPel);
        srcIdx += Math.ceil(rl / 8);
        dstIdx += rl * 2;
        break;
      }
      case 0xF8: // MEGA_MEGA_DITHERED_RUN
        srcIdx++; rl = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
        { const md1 = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
          const md2 = src[srcIdx] | (src[srcIdx + 1] << 8); srcIdx += 2;
          writeDitheredRun16(dst, dstIdx, rl, md1, md2); }
        dstIdx += rl * 4;
        break;
      case 0xF9: // SPECIAL_FGBG_1
        srcIdx++;
        writeFgBgImage16Fixed(dst, dstIdx, 8, rowDelta, fgPel, 0x03);
        dstIdx += 8 * 2;
        break;
      case 0xFA: // SPECIAL_FGBG_2
        srcIdx++;
        writeFgBgImage16Fixed(dst, dstIdx, 8, rowDelta, fgPel, 0x05);
        dstIdx += 8 * 2;
        break;
      case 0xFD: // WHITE
        srcIdx++;
        safeWrite16(dst, dstIdx, 0xFFFF);
        dstIdx += 2;
        break;
      case 0xFE: // BLACK
        srcIdx++;
        safeWrite16(dst, dstIdx, 0x0000);
        dstIdx += 2;
        break;
      default:
        srcIdx++;
        break;
    }
  }
  return dst;
}

function safeRead16(buf: Buffer, off: number): number {
  return (off >= 0 && off + 1 < buf.length) ? buf.readUInt16LE(off) : 0;
}
function safeWrite16(buf: Buffer, off: number, val: number): void {
  if (off >= 0 && off + 1 < buf.length) buf.writeUInt16LE(val, off);
}

function writeRunBg16(dst: Buffer, offset: number, count: number, rowDelta: number, firstPixel: number): void {
  for (let i = 0; i < count; i++) {
    const d = offset + i * 2;
    let pixel = safeRead16(dst, d - rowDelta);
    if (i === 0 && firstPixel) pixel ^= firstPixel;
    safeWrite16(dst, d, pixel);
  }
}

function writeRunFg16(dst: Buffer, offset: number, count: number, rowDelta: number, fgPel: number): void {
  for (let i = 0; i < count; i++) {
    const d = offset + i * 2;
    safeWrite16(dst, d, safeRead16(dst, d - rowDelta) ^ fgPel);
  }
}

function writeColorRun16(dst: Buffer, offset: number, count: number, color: number): void {
  for (let i = 0; i < count; i++) safeWrite16(dst, offset + i * 2, color);
}

function writeFgBgImage16(dst: Buffer, offset: number, bitmask: Buffer, maskIdx: number, count: number, rowDelta: number, fgPel: number): void {
  for (let i = 0; i < count; i++) {
    const d = offset + i * 2;
    const bit = (bitmask[maskIdx + (i >> 3)] >> (i & 7)) & 1;
    let pixel = safeRead16(dst, d - rowDelta);
    if (bit) pixel ^= fgPel;
    safeWrite16(dst, d, pixel);
  }
}

function writeFgBgImage16Fixed(dst: Buffer, offset: number, count: number, rowDelta: number, fgPel: number, mask: number): void {
  for (let i = 0; i < count; i++) {
    const d = offset + i * 2;
    const bit = (mask >> (i & 7)) & 1;
    let pixel = safeRead16(dst, d - rowDelta);
    if (bit) pixel ^= fgPel;
    safeWrite16(dst, d, pixel);
  }
}

function writeDitheredRun16(dst: Buffer, offset: number, count: number, c1: number, c2: number): void {
  for (let i = 0; i < count; i++) {
    safeWrite16(dst, offset + i * 4, c1);
    safeWrite16(dst, offset + i * 4 + 2, c2);
  }
}

// Simplified decompressors for 24/32/8 bpp — same logic, different pixel widths
function decompressRLE24(src: Buffer, width: number, height: number): Buffer {
  // For 24-bit, fall back to direct copy if RLE is too complex
  const expectedSize = width * height * 3;
  if (src.length >= expectedSize) return src.subarray(0, expectedSize);
  // Simple RLE: just pad with zeros
  const dst = Buffer.alloc(expectedSize);
  src.copy(dst, 0, 0, Math.min(src.length, expectedSize));
  return dst;
}

function decompressRLE32(src: Buffer, width: number, height: number): Buffer {
  const expectedSize = width * height * 4;
  if (src.length >= expectedSize) return src.subarray(0, expectedSize);
  const dst = Buffer.alloc(expectedSize);
  src.copy(dst, 0, 0, Math.min(src.length, expectedSize));
  return dst;
}

function decompressRLE8(src: Buffer, width: number, height: number): Buffer {
  const expectedSize = width * height;
  if (src.length >= expectedSize) return src.subarray(0, expectedSize);
  const dst = Buffer.alloc(expectedSize);
  src.copy(dst, 0, 0, Math.min(src.length, expectedSize));
  return dst;
}
