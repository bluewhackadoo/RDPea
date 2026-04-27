// Buffer reader/writer utilities — direct port from TypeScript BufferReader/BufferWriter
use byteorder::{BigEndian, LittleEndian, ReadBytesExt, WriteBytesExt};
use std::io::Cursor;

// ===== BufferReader =====

pub struct BufferReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> BufferReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    pub fn remaining(&self) -> usize {
        if self.pos >= self.data.len() {
            0
        } else {
            self.data.len() - self.pos
        }
    }

    pub fn position(&self) -> usize {
        self.pos
    }

    pub fn read_u8(&mut self) -> u8 {
        if self.pos >= self.data.len() {
            return 0;
        }
        let val = self.data[self.pos];
        self.pos += 1;
        val
    }

    pub fn read_u16_le(&mut self) -> u16 {
        if self.pos + 2 > self.data.len() {
            return 0;
        }
        let mut cursor = Cursor::new(&self.data[self.pos..self.pos + 2]);
        let val = cursor.read_u16::<LittleEndian>().unwrap_or(0);
        self.pos += 2;
        val
    }

    pub fn read_u16_be(&mut self) -> u16 {
        if self.pos + 2 > self.data.len() {
            return 0;
        }
        let mut cursor = Cursor::new(&self.data[self.pos..self.pos + 2]);
        let val = cursor.read_u16::<BigEndian>().unwrap_or(0);
        self.pos += 2;
        val
    }

    pub fn read_u32_le(&mut self) -> u32 {
        if self.pos + 4 > self.data.len() {
            return 0;
        }
        let mut cursor = Cursor::new(&self.data[self.pos..self.pos + 4]);
        let val = cursor.read_u32::<LittleEndian>().unwrap_or(0);
        self.pos += 4;
        val
    }

    pub fn read_u32_be(&mut self) -> u32 {
        if self.pos + 4 > self.data.len() {
            return 0;
        }
        let mut cursor = Cursor::new(&self.data[self.pos..self.pos + 4]);
        let val = cursor.read_u32::<BigEndian>().unwrap_or(0);
        self.pos += 4;
        val
    }

    pub fn read_bytes(&mut self, count: usize) -> Vec<u8> {
        let available = std::cmp::min(count, self.remaining());
        let result = self.data[self.pos..self.pos + available].to_vec();
        self.pos += available;
        result
    }

    pub fn read_slice(&mut self, count: usize) -> &'a [u8] {
        let available = std::cmp::min(count, self.remaining());
        let result = &self.data[self.pos..self.pos + available];
        self.pos += available;
        result
    }

    pub fn skip(&mut self, count: usize) {
        self.pos += std::cmp::min(count, self.remaining());
    }

    pub fn read_string(&mut self, len: usize) -> String {
        let bytes = self.read_bytes(len);
        String::from_utf8_lossy(&bytes).to_string()
    }

    // BER length decoding
    pub fn read_ber_length(&mut self) -> usize {
        let first = self.read_u8();
        if first < 0x80 {
            first as usize
        } else if first == 0x81 {
            self.read_u8() as usize
        } else if first == 0x82 {
            self.read_u16_be() as usize
        } else {
            0
        }
    }

    // PER length decoding
    pub fn read_per_length(&mut self) -> usize {
        let first = self.read_u8();
        if first & 0x80 == 0 {
            first as usize
        } else {
            let second = self.read_u8();
            (((first & 0x7F) as usize) << 8) | (second as usize)
        }
    }
}

// ===== BufferWriter =====

pub struct BufferWriter {
    data: Vec<u8>,
}

impl BufferWriter {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: Vec::with_capacity(capacity),
        }
    }

    pub fn position(&self) -> usize {
        self.data.len()
    }

    pub fn write_u8(&mut self, val: u8) {
        self.data.push(val);
    }

    pub fn write_u16_le(&mut self, val: u16) {
        self.data.write_u16::<LittleEndian>(val).unwrap();
    }

    pub fn write_u16_be(&mut self, val: u16) {
        self.data.write_u16::<BigEndian>(val).unwrap();
    }

    pub fn write_u32_le(&mut self, val: u32) {
        self.data.write_u32::<LittleEndian>(val).unwrap();
    }

    pub fn write_u32_be(&mut self, val: u32) {
        self.data.write_u32::<BigEndian>(val).unwrap();
    }

    pub fn write_bytes(&mut self, bytes: &[u8]) {
        self.data.extend_from_slice(bytes);
    }

    pub fn write_pad(&mut self, count: usize) {
        self.data.extend(std::iter::repeat(0u8).take(count));
    }

    pub fn write_string(&mut self, s: &str) {
        self.data.extend_from_slice(s.as_bytes());
    }

    // Set a u16 LE value at an absolute position (for backfilling lengths)
    pub fn set_u16_le(&mut self, val: u16, pos: usize) {
        if pos + 2 <= self.data.len() {
            self.data[pos] = (val & 0xFF) as u8;
            self.data[pos + 1] = ((val >> 8) & 0xFF) as u8;
        }
    }

    pub fn to_vec(self) -> Vec<u8> {
        self.data
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.data
    }

    // BER length encoding
    pub fn write_ber_length(&mut self, length: usize) {
        if length < 0x80 {
            self.write_u8(length as u8);
        } else if length < 0x100 {
            self.write_u8(0x81);
            self.write_u8(length as u8);
        } else {
            self.write_u8(0x82);
            self.write_u16_be(length as u16);
        }
    }

    // BER integer encoding
    pub fn write_ber_int(&mut self, value: u32) {
        self.write_u8(0x02); // INTEGER tag
        if value <= 0x7F {
            self.write_u8(1);
            self.write_u8(value as u8);
        } else if value <= 0x7FFF {
            self.write_u8(2);
            self.write_u16_be(value as u16);
        } else {
            self.write_u8(3);
            self.write_u8(((value >> 16) & 0xFF) as u8);
            self.write_u16_be((value & 0xFFFF) as u16);
        }
    }
}

// Helper: BER length size calculation
pub fn ber_length_size(length: usize) -> usize {
    if length < 0x80 {
        1
    } else if length < 0x100 {
        2
    } else {
        3
    }
}
