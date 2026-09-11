// Pointer (mouse cursor) updates — MS-RDPBCGR §2.2.9.1.1.4 (slow-path) and §2.2.9.1.2.1.5–1.11 (fast-path)
//
// The server ships cursor shapes as an XOR colour bitmap plus a 1-bpp AND mask, scanlines
// bottom-up and word-aligned. We convert each shape to top-down RGBA once, here in the main
// process; the renderer turns it into a CSS cursor.
import { BufferReader } from './bufferReader';

export interface PointerImage {
  cacheIndex: number;
  hotX: number;
  hotY: number;
  width: number;
  height: number;
  rgba: Buffer; // width * height * 4, top-down
}

export type PointerUpdate =
  | { kind: 'hidden' }
  | { kind: 'default' }
  | { kind: 'position'; x: number; y: number }
  | { kind: 'cached'; cacheIndex: number }
  | { kind: 'new'; image: PointerImage };

// Fast-path update codes (updateCode field of TS_FP_UPDATE, MS-RDPBCGR §2.2.9.1.2.1)
// 0x0 ORDERS, 0x1 BITMAP, 0x2 PALETTE, 0x3 SYNCHRONIZE, 0x4 SURFCMDS, then the pointer family:
export const FASTPATH_UPDATETYPE_PTR_NULL = 0x05;
export const FASTPATH_UPDATETYPE_PTR_DEFAULT = 0x06;
export const FASTPATH_UPDATETYPE_PTR_POSITION = 0x08;
export const FASTPATH_UPDATETYPE_COLOR = 0x09;
export const FASTPATH_UPDATETYPE_CACHED = 0x0A;
export const FASTPATH_UPDATETYPE_POINTER = 0x0B;
export const FASTPATH_UPDATETYPE_LARGE_POINTER = 0x0C;

// Slow-path TS_POINTER_PDU messageType values
const TS_PTRMSGTYPE_SYSTEM = 0x0001;
const TS_PTRMSGTYPE_POSITION = 0x0003;
const TS_PTRMSGTYPE_COLOR = 0x0006;
const TS_PTRMSGTYPE_CACHED = 0x0007;
const TS_PTRMSGTYPE_POINTER = 0x0008;

export function isFastPathPointerUpdate(updateCode: number): boolean {
  switch (updateCode) {
    case FASTPATH_UPDATETYPE_PTR_NULL:
    case FASTPATH_UPDATETYPE_PTR_DEFAULT:
    case FASTPATH_UPDATETYPE_PTR_POSITION:
    case FASTPATH_UPDATETYPE_COLOR:
    case FASTPATH_UPDATETYPE_CACHED:
    case FASTPATH_UPDATETYPE_POINTER:
    case FASTPATH_UPDATETYPE_LARGE_POINTER:
      return true;
    default:
      return false;
  }
}

export function parseFastPathPointerUpdate(updateCode: number, data: Buffer): PointerUpdate | null {
  const r = new BufferReader(data);
  switch (updateCode) {
    case FASTPATH_UPDATETYPE_PTR_POSITION:
      if (r.remaining < 4) return null;
      return { kind: 'position', x: r.readUInt16LE(), y: r.readUInt16LE() };
    case FASTPATH_UPDATETYPE_PTR_NULL:
      return { kind: 'hidden' };
    case FASTPATH_UPDATETYPE_PTR_DEFAULT:
      return { kind: 'default' };
    case FASTPATH_UPDATETYPE_COLOR:
      return { kind: 'new', image: parseColorPointerAttribute(r, 24) };
    case FASTPATH_UPDATETYPE_CACHED:
      if (r.remaining < 2) return null;
      return { kind: 'cached', cacheIndex: r.readUInt16LE() };
    case FASTPATH_UPDATETYPE_POINTER: {
      if (r.remaining < 2) return null;
      const xorBpp = r.readUInt16LE();
      return { kind: 'new', image: parseColorPointerAttribute(r, xorBpp) };
    }
    default:
      // Large pointers (0x0C) are only sent if we advertise the Large Pointer capability, which we don't.
      return null;
  }
}

export function parseSlowPathPointerPDU(data: Buffer): PointerUpdate | null {
  const r = new BufferReader(data);
  if (r.remaining < 4) return null;
  const messageType = r.readUInt16LE();
  r.skip(2); // pad2Octets
  switch (messageType) {
    case TS_PTRMSGTYPE_SYSTEM: {
      const systemPointerType = r.readUInt32LE();
      return systemPointerType === 0 ? { kind: 'hidden' } : { kind: 'default' };
    }
    case TS_PTRMSGTYPE_POSITION:
      return { kind: 'position', x: r.readUInt16LE(), y: r.readUInt16LE() };
    case TS_PTRMSGTYPE_COLOR:
      return { kind: 'new', image: parseColorPointerAttribute(r, 24) };
    case TS_PTRMSGTYPE_CACHED:
      return { kind: 'cached', cacheIndex: r.readUInt16LE() };
    case TS_PTRMSGTYPE_POINTER: {
      const xorBpp = r.readUInt16LE();
      return { kind: 'new', image: parseColorPointerAttribute(r, xorBpp) };
    }
    default:
      return null;
  }
}

// TS_COLORPOINTERATTRIBUTE (§2.2.9.1.1.4.4)
function parseColorPointerAttribute(r: BufferReader, xorBpp: number): PointerImage {
  const cacheIndex = r.readUInt16LE();
  const hotX = r.readUInt16LE();
  const hotY = r.readUInt16LE();
  const width = r.readUInt16LE();
  const height = r.readUInt16LE();
  const lengthAndMask = r.readUInt16LE();
  const lengthXorMask = r.readUInt16LE();
  const xorMask = r.readBytes(Math.min(lengthXorMask, r.remaining));
  const andMask = r.readBytes(Math.min(lengthAndMask, r.remaining));
  return {
    cacheIndex,
    hotX: Math.min(hotX, Math.max(0, width - 1)),
    hotY: Math.min(hotY, Math.max(0, height - 1)),
    width,
    height,
    rgba: pointerToRGBA(width, height, xorBpp, xorMask, andMask),
  };
}

// Convert XOR bitmap + AND mask into top-down RGBA.
// AND bit set + black XOR pixel  → transparent
// AND bit set + non-black XOR    → screen-inverting pixel; approximated as the inverted colour
// AND bit clear                  → opaque XOR colour
// 32-bpp cursors that carry a real alpha channel are used as-is.
export function pointerToRGBA(width: number, height: number, bpp: number, xor: Buffer, and: Buffer): Buffer {
  const out = Buffer.alloc(width * height * 4);
  const xorStride = Math.floor((width * bpp + 15) / 16) * 2;
  const andStride = Math.floor((width + 15) / 16) * 2;

  let hasAlpha = false;
  if (bpp === 32) {
    for (let i = 3; i < xor.length; i += 4) {
      if (xor[i] !== 0) { hasAlpha = true; break; }
    }
  }

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; // scanlines are bottom-up
    const xorRow = srcY * xorStride;
    const andRow = srcY * andStride;
    for (let x = 0; x < width; x++) {
      let rr = 0, gg = 0, bb = 0, aa = 255;
      switch (bpp) {
        case 32: {
          const i = xorRow + x * 4;
          if (i + 3 < xor.length) { bb = xor[i]; gg = xor[i + 1]; rr = xor[i + 2]; aa = hasAlpha ? xor[i + 3] : 255; }
          break;
        }
        case 24: {
          const i = xorRow + x * 3;
          if (i + 2 < xor.length) { bb = xor[i]; gg = xor[i + 1]; rr = xor[i + 2]; }
          break;
        }
        case 16: {
          const i = xorRow + x * 2;
          if (i + 1 < xor.length) {
            const v = xor[i] | (xor[i + 1] << 8);
            rr = Math.round(((v >> 11) & 0x1F) * 255 / 31);
            gg = Math.round(((v >> 5) & 0x3F) * 255 / 63);
            bb = Math.round((v & 0x1F) * 255 / 31);
          }
          break;
        }
        case 8: {
          // Palette not tracked — grayscale approximation
          const i = xorRow + x;
          const v = i < xor.length ? xor[i] : 0;
          rr = gg = bb = v;
          break;
        }
        case 1: {
          const i = xorRow + (x >> 3);
          const bit = i < xor.length ? (xor[i] >> (7 - (x & 7))) & 1 : 0;
          rr = gg = bb = bit ? 255 : 0;
          break;
        }
        default:
          break;
      }

      if (!hasAlpha) {
        const ai = andRow + (x >> 3);
        const andBit = ai < and.length ? (and[ai] >> (7 - (x & 7))) & 1 : 0;
        if (andBit) {
          if (rr === 0 && gg === 0 && bb === 0) {
            aa = 0;
          } else {
            rr = 255 - rr; gg = 255 - gg; bb = 255 - bb;
          }
        }
      }

      const o = (y * width + x) * 4;
      out[o] = rr; out[o + 1] = gg; out[o + 2] = bb; out[o + 3] = aa;
    }
  }
  return out;
}
