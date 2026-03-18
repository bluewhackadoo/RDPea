// NTLM Authentication for CredSSP/NLA (MS-NLMP)
import * as crypto from 'crypto';
import { BufferWriter } from './bufferWriter';
import { BufferReader } from './bufferReader';

const NTLMSSP_SIGNATURE = 'NTLMSSP\0';

enum NtlmMessageType {
  NEGOTIATE = 1,
  CHALLENGE = 2,
  AUTHENTICATE = 3,
}

// NTLM negotiate flags
const NTLMSSP_NEGOTIATE_56 = 0x80000000;
const NTLMSSP_NEGOTIATE_KEY_EXCH = 0x40000000;
const NTLMSSP_NEGOTIATE_128 = 0x20000000;
const NTLMSSP_NEGOTIATE_EXTENDED_SESSIONSECURITY = 0x00080000;
const NTLMSSP_NEGOTIATE_ALWAYS_SIGN = 0x00008000;
const NTLMSSP_NEGOTIATE_NTLM = 0x00000200;
const NTLMSSP_NEGOTIATE_SEAL = 0x00000020;
const NTLMSSP_NEGOTIATE_SIGN = 0x00000010;
const NTLMSSP_REQUEST_TARGET = 0x00000004;
const NTLMSSP_NEGOTIATE_OEM = 0x00000002;
const NTLMSSP_NEGOTIATE_UNICODE = 0x00000001;

export interface NtlmCredentials {
  username: string;
  password: string;
  domain: string;
}

export interface NtlmChallengeData {
  flags: number;
  serverChallenge: Buffer;
  targetName: string;
  targetInfo: Buffer;
}

export class NtlmAuth {
  private credentials: NtlmCredentials;
  private negotiateFlags: number;
  private serverChallenge: Buffer | null = null;
  private exportedSessionKey: Buffer | null = null;
  private clientSigningKey: Buffer | null = null;
  private clientSealingKey: Buffer | null = null;
  private sealHandle: crypto.Cipher | null = null;
  private seqNum: number = 0;
  private negotiateMessageBytes: Buffer | null = null;
  private challengeMessageBytes: Buffer | null = null;

  constructor(credentials: NtlmCredentials) {
    this.credentials = credentials;
    this.negotiateFlags =
      NTLMSSP_NEGOTIATE_56 |
      NTLMSSP_NEGOTIATE_KEY_EXCH |
      NTLMSSP_NEGOTIATE_128 |
      NTLMSSP_NEGOTIATE_EXTENDED_SESSIONSECURITY |
      NTLMSSP_NEGOTIATE_ALWAYS_SIGN |
      NTLMSSP_NEGOTIATE_NTLM |
      NTLMSSP_NEGOTIATE_SEAL |
      NTLMSSP_NEGOTIATE_SIGN |
      NTLMSSP_REQUEST_TARGET |
      NTLMSSP_NEGOTIATE_UNICODE;
  }

  // Create NTLM Negotiate message (Type 1)
  createNegotiateMessage(): Buffer {
    const w = new BufferWriter(64);
    w.writeString(NTLMSSP_SIGNATURE);      // Signature
    w.writeUInt32LE(NtlmMessageType.NEGOTIATE); // MessageType
    w.writeUInt32LE(this.negotiateFlags >>> 0);   // NegotiateFlags (>>> 0 to coerce to unsigned)
    // DomainNameFields (empty)
    w.writeUInt16LE(0); // DomainNameLen
    w.writeUInt16LE(0); // DomainNameMaxLen
    w.writeUInt32LE(0); // DomainNameBufferOffset
    // WorkstationFields (empty)
    w.writeUInt16LE(0); // WorkstationLen
    w.writeUInt16LE(0); // WorkstationMaxLen
    w.writeUInt32LE(0); // WorkstationBufferOffset
    // Version (8 bytes)
    w.writeUInt8(10);  // ProductMajorVersion (Win 10)
    w.writeUInt8(0);   // ProductMinorVersion
    w.writeUInt16LE(19041); // ProductBuild
    w.writePad(3);     // Reserved
    w.writeUInt8(15);  // NTLMRevisionCurrent
    const result = w.toBuffer();
    this.negotiateMessageBytes = Buffer.from(result);
    return result;
  }

  // Parse NTLM Challenge message (Type 2)
  parseChallengeMessage(data: Buffer): NtlmChallengeData {
    const r = new BufferReader(data);
    const sig = r.readString(8);
    if (sig !== NTLMSSP_SIGNATURE) {
      throw new Error('Invalid NTLM signature');
    }
    const msgType = r.readUInt32LE();
    if (msgType !== NtlmMessageType.CHALLENGE) {
      throw new Error(`Expected NTLM Challenge, got type ${msgType}`);
    }
    const targetNameLen = r.readUInt16LE();
    const targetNameMaxLen = r.readUInt16LE();
    const targetNameOffset = r.readUInt32LE();
    const flags = r.readUInt32LE();
    const serverChallenge = r.readBytes(8);
    r.skip(8); // Reserved

    let targetInfoLen = 0;
    let targetInfoOffset = 0;
    if (r.remaining >= 4) {
      targetInfoLen = r.readUInt16LE();
      const _targetInfoMaxLen = r.readUInt16LE();
      targetInfoOffset = r.readUInt32LE();
    }

    const targetName = data.toString('utf16le', targetNameOffset, targetNameOffset + targetNameLen);
    const targetInfo = targetInfoLen > 0
      ? data.subarray(targetInfoOffset, targetInfoOffset + targetInfoLen)
      : Buffer.alloc(0);

    this.serverChallenge = serverChallenge;
    this.negotiateFlags = flags;
    this.challengeMessageBytes = Buffer.from(data);

    return { flags, serverChallenge, targetName, targetInfo };
  }

  // Create NTLM Authenticate message (Type 3) with MIC support
  createAuthenticateMessage(challenge: NtlmChallengeData): Buffer {
    const { username, password, domain } = this.credentials;

    // Parse target info for MsvAvTimestamp and modify to add MsvAvFlags
    const { timestamp: serverTimestamp, modifiedTargetInfo } =
      this.processTargetInfo(challenge.targetInfo);

    // Generate NTLMv2 response
    const clientChallenge = crypto.randomBytes(8);
    const timestamp = serverTimestamp || this.fileTime();
    const ntlmV2Hash = this.ntlmV2Hash(password, username, domain);

    // Build temp structure for NTProofStr (using modified target info with MsvAvFlags)
    const temp = this.buildTemp(clientChallenge, timestamp, modifiedTargetInfo);
    const ntProofStr = this.hmacMd5(ntlmV2Hash,
      Buffer.concat([challenge.serverChallenge, temp]));
    const ntChallengeResponse = Buffer.concat([ntProofStr, temp]);

    // Session base key
    const sessionBaseKey = this.hmacMd5(ntlmV2Hash, ntProofStr);

    // Exported session key (for signing/sealing)
    this.exportedSessionKey = crypto.randomBytes(16);
    const encryptedRandomSessionKey = this.rc4(sessionBaseKey, this.exportedSessionKey);

    // Encode fields
    const domainBuf = Buffer.from(domain, 'utf16le');
    const userBuf = Buffer.from(username, 'utf16le');
    const workstationBuf = Buffer.from('RDPEA', 'utf16le');
    const lmResponse = Buffer.alloc(24); // Empty LM response for NTLMv2

    // Header is 88 bytes: sig(8) + type(4) + 6×fields(48) + flags(4) + version(8) + MIC(16)
    const MIC_OFFSET = 72;
    const headerLen = 88;
    let offset = headerLen;
    const domainOffset = offset; offset += domainBuf.length;
    const userOffset = offset; offset += userBuf.length;
    const workstationOffset = offset; offset += workstationBuf.length;
    const lmOffset = offset; offset += lmResponse.length;
    const ntOffset = offset; offset += ntChallengeResponse.length;
    const ekOffset = offset; offset += encryptedRandomSessionKey.length;

    const w = new BufferWriter(offset + 32);
    w.writeString(NTLMSSP_SIGNATURE);
    w.writeUInt32LE(NtlmMessageType.AUTHENTICATE);

    // LmChallengeResponseFields
    w.writeUInt16LE(lmResponse.length);
    w.writeUInt16LE(lmResponse.length);
    w.writeUInt32LE(lmOffset);

    // NtChallengeResponseFields
    w.writeUInt16LE(ntChallengeResponse.length);
    w.writeUInt16LE(ntChallengeResponse.length);
    w.writeUInt32LE(ntOffset);

    // DomainNameFields
    w.writeUInt16LE(domainBuf.length);
    w.writeUInt16LE(domainBuf.length);
    w.writeUInt32LE(domainOffset);

    // UserNameFields
    w.writeUInt16LE(userBuf.length);
    w.writeUInt16LE(userBuf.length);
    w.writeUInt32LE(userOffset);

    // WorkstationFields
    w.writeUInt16LE(workstationBuf.length);
    w.writeUInt16LE(workstationBuf.length);
    w.writeUInt32LE(workstationOffset);

    // EncryptedRandomSessionKeyFields
    w.writeUInt16LE(encryptedRandomSessionKey.length);
    w.writeUInt16LE(encryptedRandomSessionKey.length);
    w.writeUInt32LE(ekOffset);

    // NegotiateFlags
    w.writeUInt32LE(this.negotiateFlags >>> 0);

    // Version
    w.writeUInt8(10);
    w.writeUInt8(0);
    w.writeUInt16LE(19041);
    w.writePad(3);
    w.writeUInt8(15);

    // MIC placeholder (16 zero bytes at offset 72)
    w.writePad(16);

    // Payload
    w.writeBuffer(domainBuf);
    w.writeBuffer(userBuf);
    w.writeBuffer(workstationBuf);
    w.writeBuffer(lmResponse);
    w.writeBuffer(ntChallengeResponse);
    w.writeBuffer(encryptedRandomSessionKey);

    const authMsg = w.toBuffer();

    // Compute MIC = HMAC_MD5(ExportedSessionKey, Negotiate + Challenge + Authenticate)
    if (this.negotiateMessageBytes && this.challengeMessageBytes) {
      const mic = crypto.createHmac('md5', this.exportedSessionKey)
        .update(this.negotiateMessageBytes)
        .update(this.challengeMessageBytes)
        .update(authMsg)
        .digest();
      mic.copy(authMsg, MIC_OFFSET);
    }

    return authMsg;
  }

  // Parse target info AV_PAIRs, extract MsvAvTimestamp, add MsvAvFlags for MIC
  private processTargetInfo(targetInfo: Buffer): { timestamp: Buffer | null; modifiedTargetInfo: Buffer } {
    let timestamp: Buffer | null = null;
    let hasFlags = false;

    // First pass: find timestamp and check for existing flags
    let pos = 0;
    while (pos + 4 <= targetInfo.length) {
      const avId = targetInfo.readUInt16LE(pos);
      const avLen = targetInfo.readUInt16LE(pos + 2);
      if (avId === 0x0000) break; // MsvAvEOL
      if (avId === 0x0007 && avLen === 8) { // MsvAvTimestamp
        timestamp = targetInfo.subarray(pos + 4, pos + 4 + 8);
      }
      if (avId === 0x0006) hasFlags = true; // MsvAvFlags already present
      pos += 4 + avLen;
    }

    // If no timestamp found, return original target info (no MIC needed)
    if (!timestamp) {
      return { timestamp: null, modifiedTargetInfo: targetInfo };
    }

    // Build modified target info with MsvAvFlags (MIC_PROVIDED = 0x00000002)
    // Insert MsvAvFlags before MsvAvEOL
    if (hasFlags) {
      // Flags exist — modify in place: find and update
      const modified = Buffer.from(targetInfo);
      let p = 0;
      while (p + 4 <= modified.length) {
        const id = modified.readUInt16LE(p);
        const len = modified.readUInt16LE(p + 2);
        if (id === 0x0000) break;
        if (id === 0x0006 && len === 4) {
          const existing = modified.readUInt32LE(p + 4);
          modified.writeUInt32LE(existing | 0x00000002, p + 4);
          return { timestamp, modifiedTargetInfo: modified };
        }
        p += 4 + len;
      }
      return { timestamp, modifiedTargetInfo: modified };
    } else {
      // No flags — insert MsvAvFlags(8 bytes) before MsvAvEOL
      // MsvAvFlags: AvId=0x0006(2) + AvLen=0x0004(2) + Value=0x00000002(4) = 8 bytes
      const flagsPair = Buffer.alloc(8);
      flagsPair.writeUInt16LE(0x0006, 0); // AvId = MsvAvFlags
      flagsPair.writeUInt16LE(0x0004, 2); // AvLen = 4
      flagsPair.writeUInt32LE(0x00000002, 4); // MIC_PROVIDED
      // Split at MsvAvEOL position (pos points to it)
      const before = targetInfo.subarray(0, pos);
      const eol = targetInfo.subarray(pos); // MsvAvEOL (4 bytes: 0x0000 0x0000)
      return { timestamp, modifiedTargetInfo: Buffer.concat([before, flagsPair, eol]) };
    }
  }

  getExportedSessionKey(): Buffer {
    if (!this.exportedSessionKey) {
      throw new Error('Session key not yet established');
    }
    return this.exportedSessionKey;
  }

  // Initialize NTLM sealing keys and RC4 handle for EncryptMessage
  initializeSealing(): void {
    if (!this.exportedSessionKey) throw new Error('Session key not established');
    this.clientSigningKey = crypto.createHash('md5')
      .update(this.exportedSessionKey)
      .update('session key to client-to-server signing key magic constant\0')
      .digest();
    this.clientSealingKey = crypto.createHash('md5')
      .update(this.exportedSessionKey)
      .update('session key to client-to-server sealing key magic constant\0')
      .digest();
    this.sealHandle = crypto.createCipheriv('rc4', this.clientSealingKey, '');
    this.seqNum = 0;
  }

  // NTLM SealMessage (MS-NLMP 3.4.4) — encrypt + MAC
  sealMessage(message: Buffer): Buffer {
    if (!this.sealHandle || !this.clientSigningKey) {
      throw new Error('Sealing not initialized');
    }
    // 1. Encrypt message with RC4 seal handle
    const encrypted = this.sealHandle.update(message);
    // 2. MAC on plaintext: HMAC-MD5(SigningKey, SeqNum + Message)
    const seqBuf = Buffer.alloc(4);
    seqBuf.writeUInt32LE(this.seqNum);
    const hmac = crypto.createHmac('md5', this.clientSigningKey)
      .update(seqBuf)
      .update(message)
      .digest();
    let checksum = hmac.subarray(0, 8);
    // 3. Encrypt checksum with seal handle if KEY_EXCH negotiated
    if (this.negotiateFlags & 0x40000000) {
      checksum = this.sealHandle.update(checksum);
    }
    // 4. Build signature: Version(4) + EncryptedChecksum(8) + SeqNum(4)
    const signature = Buffer.alloc(16);
    signature.writeUInt32LE(0x00000001, 0);
    checksum.copy(signature, 4);
    seqBuf.copy(signature, 12);
    this.seqNum++;
    return Buffer.concat([signature, encrypted]);
  }

  // NTLMv2 hash: HMAC-MD5(MD4(UNICODE(password)), UNICODE(UPPER(username) + domain))
  private ntlmV2Hash(password: string, username: string, domain: string): Buffer {
    const ntHash = this.md4(Buffer.from(password, 'utf16le'));
    const identity = Buffer.from((username.toUpperCase() + domain), 'utf16le');
    return this.hmacMd5(ntHash, identity);
  }

  // Build NTLMv2 temp blob
  private buildTemp(clientChallenge: Buffer, timestamp: Buffer, targetInfo: Buffer): Buffer {
    const w = new BufferWriter(32 + targetInfo.length + 4);
    w.writeUInt8(1);   // RespType
    w.writeUInt8(1);   // HiRespType
    w.writeUInt16LE(0); // Reserved1
    w.writeUInt32LE(0); // Reserved2
    w.writeBuffer(timestamp);
    w.writeBuffer(clientChallenge);
    w.writeUInt32LE(0); // Reserved3
    w.writeBuffer(targetInfo);
    w.writeUInt32LE(0); // Reserved4
    return w.toBuffer();
  }

  // Windows FILETIME (100ns intervals since Jan 1, 1601)
  private fileTime(): Buffer {
    const msFrom1601To1970 = BigInt('11644473600000');
    const now = BigInt(Date.now());
    const fileTime = (now + msFrom1601To1970) * BigInt(10000);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(fileTime);
    return buf;
  }

  private md4(data: Buffer): Buffer {
    return crypto.createHash('md4').update(data).digest();
  }

  private hmacMd5(key: Buffer, data: Buffer): Buffer {
    return crypto.createHmac('md5', key).update(data).digest();
  }

  private rc4(key: Buffer, data: Buffer): Buffer {
    const cipher = crypto.createCipheriv('rc4', key, '');
    return Buffer.concat([cipher.update(data), cipher.final()]);
  }
}

// CredSSP (TSRequest) ASN.1 encoding/decoding helpers
export function buildTsRequest(version: number, negoToken?: Buffer, authInfo?: Buffer, pubKeyAuth?: Buffer, clientNonce?: Buffer): Buffer {
  const fields: Buffer[] = [];

  // [0] version
  const versionBuf = asn1Constructed(0xA0, asn1Integer(version));
  fields.push(versionBuf);

  // [1] negoTokens
  if (negoToken) {
    const innerSeq = asn1Sequence([
      asn1Constructed(0xA0, asn1OctetString(negoToken)),
    ]);
    const negoTokens = asn1Constructed(0xA1, asn1Sequence([innerSeq]));
    fields.push(negoTokens);
  }

  // [2] authInfo
  if (authInfo) {
    fields.push(asn1Constructed(0xA2, asn1OctetString(authInfo)));
  }

  // [3] pubKeyAuth
  if (pubKeyAuth) {
    fields.push(asn1Constructed(0xA3, asn1OctetString(pubKeyAuth)));
  }

  // [5] clientNonce (CredSSP v5+)
  if (clientNonce) {
    fields.push(asn1Constructed(0xA5, asn1OctetString(clientNonce)));
  }

  return asn1Sequence(fields);
}

export function parseTsRequest(data: Buffer): {
  version: number;
  negoToken?: Buffer;
  pubKeyAuth?: Buffer;
  errorCode?: number;
} {
  const r = new BufferReader(data);
  // SEQUENCE tag
  r.readUInt8(); // 0x30
  r.readBerLength();

  let version = 0;
  let negoToken: Buffer | undefined;
  let pubKeyAuth: Buffer | undefined;
  let errorCode: number | undefined;

  while (r.remaining > 0) {
    const tag = r.readUInt8();
    const len = r.readBerLength();
    const fieldData = r.readBytes(len);

    const contextTag = tag & 0x1F;
    if (contextTag === 0) {
      // version: INTEGER
      const vr = new BufferReader(fieldData);
      vr.readUInt8(); // INTEGER tag
      const vl = vr.readBerLength();
      version = vr.readUInt8();
    } else if (contextTag === 1) {
      // negoTokens
      negoToken = extractNegoToken(fieldData);
    } else if (contextTag === 3) {
      // pubKeyAuth
      const pr = new BufferReader(fieldData);
      pr.readUInt8(); // OCTET STRING tag
      const pl = pr.readBerLength();
      pubKeyAuth = pr.readBytes(pl);
    } else if (contextTag === 4) {
      // errorCode (CredSSP v3+)
      const er = new BufferReader(fieldData);
      er.readUInt8(); // INTEGER tag
      const el = er.readBerLength();
      if (el === 1) errorCode = er.readUInt8();
      else if (el === 2) errorCode = er.readUInt16BE();
      else if (el === 4) errorCode = er.readUInt32BE();
    }
  }

  return { version, negoToken, pubKeyAuth, errorCode };
}

function extractNegoToken(data: Buffer): Buffer {
  const r = new BufferReader(data);
  // SEQUENCE OF
  r.readUInt8(); r.readBerLength();
  // SEQUENCE
  r.readUInt8(); r.readBerLength();
  // [0]
  r.readUInt8(); r.readBerLength();
  // OCTET STRING
  r.readUInt8();
  const len = r.readBerLength();
  return r.readBytes(len);
}

// ASN.1 DER helpers (exported for TSCredentials encoding)
export function asn1Length(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  const buf = Buffer.alloc(3);
  buf[0] = 0x82;
  buf.writeUInt16BE(length, 1);
  return buf;
}

export function asn1Constructed(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), asn1Length(content.length), content]);
}

export function asn1Sequence(items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), asn1Length(content.length), content]);
}

export function asn1OctetString(data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), asn1Length(data.length), data]);
}

export function asn1Integer(value: number): Buffer {
  if (value < 0x80) return Buffer.from([0x02, 0x01, value]);
  if (value < 0x8000) {
    const buf = Buffer.alloc(4);
    buf[0] = 0x02; buf[1] = 0x02;
    buf.writeUInt16BE(value, 2);
    return buf;
  }
  const buf = Buffer.alloc(6);
  buf[0] = 0x02; buf[1] = 0x04;
  buf.writeUInt32BE(value, 2);
  return buf;
}
