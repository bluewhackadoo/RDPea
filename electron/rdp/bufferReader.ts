// Binary buffer reading utility for RDP protocol parsing

export class BufferReader {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  get length(): number {
    return this.buffer.length;
  }

  seek(offset: number): void {
    this.offset = offset;
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }

  readUInt8(): number {
    const val = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readUInt16LE(): number {
    const val = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return val;
  }

  readUInt16BE(): number {
    const val = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  readUInt32LE(): number {
    const val = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return val;
  }

  readUInt32BE(): number {
    const val = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  readInt16LE(): number {
    const val = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return val;
  }

  readInt32LE(): number {
    const val = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return val;
  }

  readBytes(length: number): Buffer {
    const val = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return val;
  }

  readString(length: number, encoding: BufferEncoding = 'utf8'): string {
    const val = this.buffer.toString(encoding, this.offset, this.offset + length);
    this.offset += length;
    return val;
  }

  readUnicodeString(byteLength: number): string {
    const val = this.buffer.toString('utf16le', this.offset, this.offset + byteLength);
    this.offset += byteLength;
    return val.replace(/\0+$/, '');
  }

  // Read a BER (Basic Encoding Rules) encoded length
  readBerLength(): number {
    let size = this.readUInt8();
    if (size & 0x80) {
      const numBytes = size & 0x7F;
      if (numBytes === 1) {
        size = this.readUInt8();
      } else if (numBytes === 2) {
        size = this.readUInt16BE();
      } else {
        throw new Error(`Unsupported BER length encoding: ${numBytes} bytes`);
      }
    }
    return size;
  }

  // Read a PER (Packed Encoding Rules) encoded length
  readPerLength(): number {
    let size = this.readUInt8();
    if (size & 0x80) {
      size = ((size & 0x7F) << 8) | this.readUInt8();
    }
    return size;
  }

  peek(length: number): Buffer {
    return this.buffer.subarray(this.offset, this.offset + length);
  }

  peekUInt8(): number {
    return this.buffer.readUInt8(this.offset);
  }

  peekUInt16BE(): number {
    return this.buffer.readUInt16BE(this.offset);
  }

  slice(start: number, end: number): Buffer {
    return this.buffer.subarray(start, end);
  }

  toBuffer(): Buffer {
    return this.buffer;
  }
}
