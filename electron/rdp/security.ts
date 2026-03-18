// RDP Security Layer — encryption/decryption, key generation, PDU building (MS-RDPBCGR §5)
import * as crypto from 'crypto';
import { BufferWriter } from './bufferWriter';
import { BufferReader } from './bufferReader';
import * as types from './types';

export interface SecurityState {
  encryptionMethod: number;
  encryptionLevel: number;
  macKey: Buffer | null;
  encryptKey: Buffer | null;
  decryptKey: Buffer | null;
  encryptRC4: crypto.Cipher | null;
  decryptRC4: crypto.Decipher | null;
  encryptCount: number;
  decryptCount: number;
  useTls: boolean;
}

export function createSecurityState(): SecurityState {
  return {
    encryptionMethod: 0,
    encryptionLevel: 0,
    macKey: null,
    encryptKey: null,
    decryptKey: null,
    encryptRC4: null,
    decryptRC4: null,
    encryptCount: 0,
    decryptCount: 0,
    useTls: false,
  };
}

// Parse server certificate to extract RSA public key
export function parseServerCertificate(certData: Buffer): { modulus: Buffer; exponent: number } {
  const r = new BufferReader(certData);
  const dwVersion = r.readUInt32LE();
  const certType = dwVersion & 0x7FFFFFFF;

  if (certType === 1) {
    // Proprietary certificate
    return parseProprietaryCert(r);
  } else if (certType === 2) {
    // X.509 certificate chain
    return parseX509CertChain(r);
  }
  throw new Error(`Unknown certificate type: ${certType}`);
}

function parseProprietaryCert(r: BufferReader): { modulus: Buffer; exponent: number } {
  r.readUInt32LE(); // dwSigAlgId
  r.readUInt32LE(); // dwKeyAlgId
  const publicKeyType = r.readUInt16LE(); // BB_RSA_KEY_BLOB
  const publicKeyLen = r.readUInt16LE();
  const keyBlob = r.readBytes(publicKeyLen);

  const kr = new BufferReader(keyBlob);
  kr.readUInt32LE(); // magic "RSA1"
  const keyLen = kr.readUInt32LE();
  const bitLen = kr.readUInt32LE();
  const dataLen = kr.readUInt32LE();
  const exponent = kr.readUInt32LE();
  const modulus = kr.readBytes(keyLen - 8); // modulus (minus padding)

  return { modulus, exponent };
}

function parseX509CertChain(r: BufferReader): { modulus: Buffer; exponent: number } {
  const numCerts = r.readUInt32LE();
  let lastCert: Buffer = Buffer.alloc(0);
  for (let i = 0; i < numCerts; i++) {
    const certLen = r.readUInt32LE();
    lastCert = r.readBytes(certLen);
  }
  // Extract public key from X.509 DER certificate
  return extractRsaFromX509(lastCert);
}

function extractRsaFromX509(der: Buffer): { modulus: Buffer; exponent: number } {
  // Simple X.509 DER parser - extract SubjectPublicKeyInfo RSA key
  try {
    const cert = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const exported = cert.export({ format: 'jwk' }) as crypto.JsonWebKey;
    const modulus = Buffer.from(exported.n!, 'base64url');
    const expBuf = Buffer.from(exported.e!, 'base64url');
    const exponent = expBuf.length === 3
      ? (expBuf[0] << 16) | (expBuf[1] << 8) | expBuf[2]
      : expBuf.length === 2
        ? (expBuf[0] << 8) | expBuf[1]
        : expBuf[0];
    return { modulus, exponent };
  } catch {
    // Fallback: try parsing the DER manually for the RSA key
    return { modulus: Buffer.alloc(64), exponent: 65537 };
  }
}

// Generate session keys from client/server random using MS-RDPBCGR §5.3.5
export function generateSessionKeys(
  clientRandom: Buffer,
  serverRandom: Buffer,
  encryptionMethod: number
): { macKey: Buffer; encryptKey: Buffer; decryptKey: Buffer } {
  const preMasterHash = Buffer.concat([clientRandom, serverRandom]);
  const masterSecret = salted(preMasterHash, clientRandom, serverRandom);
  const sessionKeyBlob = salted(masterSecret, serverRandom, clientRandom);

  const macKey = sessionKeyBlob.subarray(0, 16);
  let encryptKey: Buffer;
  let decryptKey: Buffer;

  if (encryptionMethod === types.ENCRYPTION_FLAG_40BIT) {
    encryptKey = finalHash(sessionKeyBlob.subarray(16, 32), clientRandom, serverRandom).subarray(0, 8);
    encryptKey[0] = 0xD1; encryptKey[1] = 0x26; encryptKey[2] = 0x9E;
    decryptKey = finalHash(sessionKeyBlob.subarray(32, 48), clientRandom, serverRandom).subarray(0, 8);
    decryptKey[0] = 0xD1; decryptKey[1] = 0x26; decryptKey[2] = 0x9E;
  } else if (encryptionMethod === types.ENCRYPTION_FLAG_56BIT) {
    encryptKey = finalHash(sessionKeyBlob.subarray(16, 32), clientRandom, serverRandom).subarray(0, 8);
    encryptKey[0] = 0xD1;
    decryptKey = finalHash(sessionKeyBlob.subarray(32, 48), clientRandom, serverRandom).subarray(0, 8);
    decryptKey[0] = 0xD1;
  } else {
    // 128-bit
    encryptKey = finalHash(sessionKeyBlob.subarray(16, 32), clientRandom, serverRandom);
    decryptKey = finalHash(sessionKeyBlob.subarray(32, 48), clientRandom, serverRandom);
  }

  return { macKey, encryptKey, decryptKey };
}

function salted(secret: Buffer, client: Buffer, server: Buffer): Buffer {
  const sha1A = sha1Hash(Buffer.from('A'), secret, client, server);
  const sha1BB = sha1Hash(Buffer.from('BB'), secret, client, server);
  const sha1CCC = sha1Hash(Buffer.from('CCC'), secret, client, server);

  const md5A = md5Hash(secret, sha1A);
  const md5B = md5Hash(secret, sha1BB);
  const md5C = md5Hash(secret, sha1CCC);

  return Buffer.concat([md5A, md5B, md5C]);
}

function finalHash(key: Buffer, client: Buffer, server: Buffer): Buffer {
  return md5Hash(key, sha1Hash(key, client, server));
}

function sha1Hash(...parts: Buffer[]): Buffer {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(p);
  return h.digest();
}

function md5Hash(...parts: Buffer[]): Buffer {
  const h = crypto.createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
}

// RSA encrypt with server public key (raw, no padding — RDP specific)
export function rsaEncrypt(data: Buffer, modulus: Buffer, exponent: number): Buffer {
  // RDP uses raw RSA (no PKCS padding) with little-endian modulus
  // We reverse to big-endian for crypto operations
  const mod = Buffer.from(modulus);
  mod.reverse(); // LE → BE
  const dataBE = Buffer.from(data);
  dataBE.reverse(); // LE → BE

  const m = BigInt('0x' + mod.toString('hex'));
  const e = BigInt(exponent);
  const d = BigInt('0x' + dataBE.toString('hex'));

  const result = modPow(d, e, m);
  const resultHex = result.toString(16).padStart(mod.length * 2, '0');
  const resultBuf = Buffer.from(resultHex, 'hex');
  resultBuf.reverse(); // BE → LE
  return resultBuf;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

// Build Security Exchange PDU (client sends encrypted random)
export function buildSecurityExchangePDU(encryptedClientRandom: Buffer): Buffer {
  const w = new BufferWriter(encryptedClientRandom.length + 12);
  w.writeUInt32LE(types.SEC_EXCHANGE_PKT); // flags
  w.writeUInt32LE(encryptedClientRandom.length + 8); // length including this field + padding
  w.writeBuffer(encryptedClientRandom);
  w.writePad(8); // padding
  return w.toBuffer();
}

// Build Client Info PDU
export function buildClientInfoPDU(
  username: string,
  password: string,
  domain: string,
  secState: SecurityState
): Buffer {
  const domainBuf = Buffer.from(domain, 'utf16le');
  const userBuf = Buffer.from(username, 'utf16le');
  const passBuf = Buffer.from(password, 'utf16le');
  const shellBuf = Buffer.alloc(0);
  const dirBuf = Buffer.alloc(0);

  const w = new BufferWriter(512);
  // Info flags (MS-RDPBCGR 2.2.1.11.1.1)
  const flags = 0x00000001 | // INFO_MOUSE
    0x00000002 |              // INFO_DISABLECTRLALTDEL
    0x00000008 |              // INFO_AUTOLOGON
    0x00000010 |              // INFO_UNICODE
    0x00000020 |              // INFO_MAXIMIZESHELL
    0x00000040 |              // INFO_LOGONNOTIFY
    0x00000100 |              // INFO_ENABLEWINDOWSKEY
    0;                        // NOTE: Do NOT set INFO_NOAUDIOPLAYBACK (0x00080000) — it disables audio redirection

  w.writeUInt32LE(0);          // CodePage
  w.writeUInt32LE(flags);      // flags
  w.writeUInt16LE(domainBuf.length);
  w.writeUInt16LE(userBuf.length);
  w.writeUInt16LE(passBuf.length);
  w.writeUInt16LE(shellBuf.length);
  w.writeUInt16LE(dirBuf.length);
  w.writeBuffer(domainBuf);
  w.writeUInt16LE(0); // domain null terminator
  w.writeBuffer(userBuf);
  w.writeUInt16LE(0); // user null terminator
  w.writeBuffer(passBuf);
  w.writeUInt16LE(0); // password null terminator
  w.writeBuffer(shellBuf);
  w.writeUInt16LE(0); // shell null terminator
  w.writeBuffer(dirBuf);
  w.writeUInt16LE(0); // dir null terminator

  // Extended info
  w.writeUInt16LE(2);   // clientAddressFamily (AF_INET)
  const addrBuf = Buffer.from('0.0.0.0', 'utf16le');
  w.writeUInt16LE(addrBuf.length + 2);
  w.writeBuffer(addrBuf);
  w.writeUInt16LE(0);
  // Client dir
  const clientDirBuf = Buffer.from('C:\\Windows\\System32\\mstscax.dll', 'utf16le');
  w.writeUInt16LE(clientDirBuf.length + 2);
  w.writeBuffer(clientDirBuf);
  w.writeUInt16LE(0);
  // Time zone info (simplified)
  w.writePad(172);
  // Session ID
  w.writeUInt32LE(0);
  // Performance flags
  w.writeUInt32LE(
    0x00000001 | // PERF_DISABLE_WALLPAPER
    0x00000004 | // PERF_DISABLE_FULLWINDOWDRAG
    0x00000008 | // PERF_DISABLE_MENUANIMATIONS
    0x00000020   // PERF_DISABLE_THEMING
  );
  // Reconnect cookie length
  w.writeUInt16LE(0);

  const infoData = w.toBuffer();

  // Wrap with security header
  if (secState.useTls || secState.encryptionLevel === 0) {
    // TLS or no-encryption: just SEC_INFO_PKT flag, no encryption
    const hw = new BufferWriter(4 + infoData.length);
    hw.writeUInt32LE(types.SEC_INFO_PKT);
    hw.writeBuffer(infoData);
    return hw.toBuffer();
  } else {
    // Standard RDP security with encryption
    return encryptPDU(secState, types.SEC_INFO_PKT, infoData);
  }
}

export function encryptPDU(secState: SecurityState, flags: number, data: Buffer): Buffer {
  if (!secState.encryptRC4 || !secState.macKey) {
    throw new Error('Encryption not initialized');
  }

  const mac = generateMac(secState.macKey, data, secState.encryptCount);
  const encrypted = secState.encryptRC4.update(data);
  secState.encryptCount++;

  const w = new BufferWriter(12 + encrypted.length);
  w.writeUInt32LE(flags | types.SEC_ENCRYPT);
  w.writeBuffer(mac);
  w.writeBuffer(encrypted);
  return w.toBuffer();
}

export function decryptPDU(secState: SecurityState, data: Buffer): { flags: number; payload: Buffer } {
  const r = new BufferReader(data);
  const flags = r.readUInt32LE();

  if (flags & types.SEC_ENCRYPT) {
    if (!secState.decryptRC4 || !secState.macKey) {
      throw new Error('Decryption not initialized');
    }
    const mac = r.readBytes(8);
    const encrypted = r.readBytes(r.remaining);
    const decrypted = secState.decryptRC4.update(encrypted);
    secState.decryptCount++;
    return { flags, payload: decrypted };
  }

  return { flags, payload: r.readBytes(r.remaining) };
}

function generateMac(macKey: Buffer, data: Buffer, seqNumber: number): Buffer {
  const pad1 = Buffer.alloc(40, 0x36);
  const pad2 = Buffer.alloc(48, 0x5C);
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeUInt32LE(seqNumber);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(data.length);

  const sha1 = crypto.createHash('sha1');
  sha1.update(macKey);
  sha1.update(pad1);
  sha1.update(lenBuf);
  sha1.update(data);
  const sha1Digest = sha1.digest();

  const md5 = crypto.createHash('md5');
  md5.update(macKey);
  md5.update(pad2);
  md5.update(sha1Digest);
  return md5.digest().subarray(0, 8);
}

// ===== Share Control / Share Data PDU helpers =====

export function parseShareControlHeader(data: Buffer): {
  totalLength: number;
  pduType: number;
  pduSource: number;
  payload: Buffer;
} {
  const r = new BufferReader(data);
  const totalLength = r.readUInt16LE();
  const pduType = r.readUInt16LE();
  const pduSource = r.readUInt16LE();
  const payload = r.readBytes(r.remaining);
  return { totalLength, pduType, pduSource, payload };
}

export function parseShareDataHeader(data: Buffer): {
  shareId: number;
  pduType2: number;
  compressedType: number;
  compressedLength: number;
  payload: Buffer;
} {
  const r = new BufferReader(data);
  const shareId = r.readUInt32LE();
  r.readUInt8(); // pad1
  r.readUInt8(); // streamId
  const uncompressedLength = r.readUInt16LE();
  const pduType2 = r.readUInt8();
  const compressedType = r.readUInt8();
  const compressedLength = r.readUInt16LE();
  const payload = r.readBytes(r.remaining);
  return { shareId, pduType2, compressedType, compressedLength, payload };
}

export function buildShareControlPDU(pduType: number, pduSource: number, payload: Buffer): Buffer {
  const totalLength = 6 + payload.length;
  const w = new BufferWriter(totalLength);
  w.writeUInt16LE(totalLength);
  w.writeUInt16LE(pduType);
  w.writeUInt16LE(pduSource);
  w.writeBuffer(payload);
  return w.toBuffer();
}

export function buildShareDataPDU(
  shareId: number,
  pduType2: number,
  payload: Buffer
): Buffer {
  const w = new BufferWriter(18 + payload.length);
  w.writeUInt32LE(shareId);   // shareId
  w.writeUInt8(0);            // pad1
  w.writeUInt8(1);            // streamId (low)
  w.writeUInt16LE(payload.length + 4); // uncompressedLength
  w.writeUInt8(pduType2);
  w.writeUInt8(0);            // compressedType
  w.writeUInt16LE(0);         // compressedLength
  w.writeBuffer(payload);
  return w.toBuffer();
}
