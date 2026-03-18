// Binary buffer writing utility for RDP protocol encoding

export class BufferWriter {
  private buffers: Buffer[] = [];
  private current: Buffer;
  private offset: number;

  constructor(initialSize = 4096) {
    this.current = Buffer.alloc(initialSize);
    this.offset = 0;
  }

  get position(): number {
    return this.offset;
  }

  private ensureCapacity(needed: number): void {
    if (this.offset + needed > this.current.length) {
      const newSize = Math.max(this.current.length * 2, this.offset + needed);
      const newBuf = Buffer.alloc(newSize);
      this.current.copy(newBuf, 0, 0, this.offset);
      this.current = newBuf;
    }
  }

  writeUInt8(value: number): this {
    this.ensureCapacity(1);
    this.current.writeUInt8(value, this.offset);
    this.offset += 1;
    return this;
  }

  writeUInt16LE(value: number): this {
    this.ensureCapacity(2);
    this.current.writeUInt16LE(value, this.offset);
    this.offset += 2;
    return this;
  }

  writeUInt16BE(value: number): this {
    this.ensureCapacity(2);
    this.current.writeUInt16BE(value, this.offset);
    this.offset += 2;
    return this;
  }

  writeUInt32LE(value: number): this {
    this.ensureCapacity(4);
    this.current.writeUInt32LE(value, this.offset);
    this.offset += 4;
    return this;
  }

  writeUInt32BE(value: number): this {
    this.ensureCapacity(4);
    this.current.writeUInt32BE(value, this.offset);
    this.offset += 4;
    return this;
  }

  writeInt16LE(value: number): this {
    this.ensureCapacity(2);
    this.current.writeInt16LE(value, this.offset);
    this.offset += 2;
    return this;
  }

  writeBuffer(buf: Buffer): this {
    this.ensureCapacity(buf.length);
    buf.copy(this.current, this.offset);
    this.offset += buf.length;
    return this;
  }

  writeBytes(data: number[]): this {
    this.ensureCapacity(data.length);
    for (const b of data) {
      this.current.writeUInt8(b, this.offset++);
    }
    return this;
  }

  writeString(str: string, encoding: BufferEncoding = 'utf8'): this {
    const buf = Buffer.from(str, encoding);
    return this.writeBuffer(buf);
  }

  writeUnicodeString(str: string, includeNull = true): this {
    const buf = Buffer.from(str + (includeNull ? '\0' : ''), 'utf16le');
    return this.writeBuffer(buf);
  }

  writePad(count: number, value = 0): this {
    this.ensureCapacity(count);
    for (let i = 0; i < count; i++) {
      this.current.writeUInt8(value, this.offset++);
    }
    return this;
  }

  // Write BER encoded length
  writeBerLength(length: number): this {
    if (length < 0x80) {
      this.writeUInt8(length);
    } else if (length < 0x100) {
      this.writeUInt8(0x81);
      this.writeUInt8(length);
    } else {
      this.writeUInt8(0x82);
      this.writeUInt16BE(length);
    }
    return this;
  }

  // Write PER encoded length
  writePerLength(length: number): this {
    if (length < 0x80) {
      this.writeUInt8(length);
    } else {
      this.writeUInt16BE(length | 0x8000);
    }
    return this;
  }

  // Get the buffer with the actual written data
  toBuffer(): Buffer {
    return this.current.subarray(0, this.offset);
  }

  // Set a value at a specific position without changing current offset
  setUInt16LE(value: number, position: number): this {
    this.current.writeUInt16LE(value, position);
    return this;
  }

  setUInt32LE(value: number, position: number): this {
    this.current.writeUInt32LE(value, position);
    return this;
  }

  setUInt16BE(value: number, position: number): this {
    this.current.writeUInt16BE(value, position);
    return this;
  }
}

// Helper to build a complete TPKT + X.224 + data packet
export function buildTpkt(data: Buffer): Buffer {
  const w = new BufferWriter(data.length + 4);
  w.writeUInt8(3);            // TPKT version
  w.writeUInt8(0);            // reserved
  w.writeUInt16BE(data.length + 4); // total length including TPKT header
  w.writeBuffer(data);
  return w.toBuffer();
}
