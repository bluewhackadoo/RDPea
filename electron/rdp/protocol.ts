// X.224, MCS (T.125), and GCC protocol layers (MS-RDPBCGR)
import { BufferWriter } from './bufferWriter';
import { BufferReader } from './bufferReader';
import * as types from './types';

// ===== X.224 Layer =====

export function buildX224ConnectionRequest(
  cookie: string,
  requestedProtocols: number
): Buffer {
  const cookieBuf = Buffer.from(`Cookie: mstshash=${cookie}\r\n`, 'ascii');
  // RDP Negotiation Request
  const negReqLen = 8;
  const x224Len = 6 + cookieBuf.length + negReqLen; // LI does not include itself
  const totalPayload = 1 + x224Len; // 1 byte for LI field

  const w = new BufferWriter(totalPayload + 4);
  // TPKT header
  w.writeUInt8(3);     // version
  w.writeUInt8(0);     // reserved
  w.writeUInt16BE(totalPayload + 4); // total length
  // X.224 CR TPDU
  w.writeUInt8(x224Len);  // LI (length indicator)
  w.writeUInt8(types.X224_TPDU_CONNECTION_REQUEST); // CR
  w.writeUInt16BE(0);     // DST-REF
  w.writeUInt16BE(0);     // SRC-REF
  w.writeUInt8(0);        // Class 0
  // Cookie
  w.writeBuffer(cookieBuf);
  // RDP Negotiation Request
  w.writeUInt8(types.TYPE_RDP_NEG_REQ); // type
  w.writeUInt8(0);        // flags
  w.writeUInt16LE(negReqLen); // length
  w.writeUInt32LE(requestedProtocols); // requestedProtocols

  return w.toBuffer();
}

export function parseX224ConnectionConfirm(data: Buffer): {
  type: number;
  selectedProtocol: number;
} {
  const r = new BufferReader(data);
  const li = r.readUInt8();
  const tpduCode = r.readUInt8() >> 4;

  if (tpduCode !== (types.X224_TPDU_CONNECTION_CONFIRM >> 4)) {
    throw new Error(`Expected X.224 CC, got 0x${tpduCode.toString(16)}`);
  }

  r.skip(5); // DST-REF(2) + SRC-REF(2) + class(1)

  let selectedProtocol = types.PROTOCOL_RDP;
  // Check for negotiation response
  if (r.remaining >= 8) {
    const negType = r.readUInt8();
    const negFlags = r.readUInt8();
    const negLength = r.readUInt16LE();
    selectedProtocol = r.readUInt32LE();
  }

  return { type: tpduCode, selectedProtocol };
}

export function buildX224Data(payload: Buffer): Buffer {
  const w = new BufferWriter(3 + payload.length);
  w.writeUInt8(2);    // LI
  w.writeUInt8(types.X224_TPDU_DATA); // DT
  w.writeUInt8(0x80); // EOT
  w.writeBuffer(payload);
  return w.toBuffer();
}

// ===== MCS Layer (T.125 using BER/PER encoding) =====

export function buildMCSConnectInitial(gccData: Buffer): Buffer {
  // MCS Connect-Initial (BER encoded)
  const w = new BufferWriter(512);

  // The callingDomainSelector, calledDomainSelector, upwardFlag are small
  const callingDomain = Buffer.from([0x04, 0x01, 0x01]); // OCTET STRING, len 1, value 1
  const calledDomain = Buffer.from([0x04, 0x01, 0x01]);
  const upwardFlag = Buffer.from([0x01, 0x01, 0xFF]);    // BOOLEAN TRUE

  // Target parameters (DomainParameters)
  const targetParams = buildDomainParameters(34, 2, 0, 1, 0, 1, 0xFFFF, 2);
  const minParams = buildDomainParameters(1, 1, 1, 1, 0, 1, 0x420, 2);
  const maxParams = buildDomainParameters(0xFFFF, 0xFC17, 0xFFFF, 1, 0, 1, 0xFFFF, 2);

  // userData (OCTET STRING containing GCC)
  const userDataHeader = Buffer.alloc(4);
  userDataHeader[0] = 0x04; // OCTET STRING tag
  // BER length for userData
  const udLen = gccData.length;

  const contentParts = [
    callingDomain,
    calledDomain,
    upwardFlag,
    targetParams,
    minParams,
    maxParams,
  ];

  let contentLen = 0;
  for (const p of contentParts) contentLen += p.length;
  // Add userData length
  contentLen += 1 + berLengthSize(udLen) + udLen; // tag + length + data

  // Build: APPLICATION[101] = 0x7F65
  w.writeUInt8(0x7F);
  w.writeUInt8(0x65);
  writeBerLength(w, contentLen);

  for (const p of contentParts) w.writeBuffer(p);

  // userData
  w.writeUInt8(0x04); // OCTET STRING
  writeBerLength(w, udLen);
  w.writeBuffer(gccData);

  return w.toBuffer();
}

function buildDomainParameters(
  maxChannels: number, maxUsers: number, maxTokens: number,
  numPriorities: number, minThroughput: number, maxHeight: number,
  maxMCSPDUSize: number, protocolVersion: number
): Buffer {
  const inner = new BufferWriter(64);
  writeBerInt(inner, maxChannels);
  writeBerInt(inner, maxUsers);
  writeBerInt(inner, maxTokens);
  writeBerInt(inner, numPriorities);
  writeBerInt(inner, minThroughput);
  writeBerInt(inner, maxHeight);
  writeBerInt(inner, maxMCSPDUSize);
  writeBerInt(inner, protocolVersion);
  const innerBuf = inner.toBuffer();

  const w = new BufferWriter(innerBuf.length + 4);
  w.writeUInt8(0x30); // SEQUENCE
  writeBerLength(w, innerBuf.length);
  w.writeBuffer(innerBuf);
  return w.toBuffer();
}

function writeBerInt(w: BufferWriter, value: number): void {
  w.writeUInt8(0x02); // INTEGER tag
  if (value <= 0x7F) {
    w.writeUInt8(1);
    w.writeUInt8(value);
  } else if (value <= 0x7FFF) {
    w.writeUInt8(2);
    w.writeUInt16BE(value);
  } else {
    w.writeUInt8(3);
    w.writeUInt8((value >> 16) & 0xFF);
    w.writeUInt16BE(value & 0xFFFF);
  }
}

function writeBerLength(w: BufferWriter, length: number): void {
  if (length < 0x80) {
    w.writeUInt8(length);
  } else if (length < 0x100) {
    w.writeUInt8(0x81);
    w.writeUInt8(length);
  } else {
    w.writeUInt8(0x82);
    w.writeUInt16BE(length);
  }
}

function berLengthSize(length: number): number {
  if (length < 0x80) return 1;
  if (length < 0x100) return 2;
  return 3;
}

export function parseMCSConnectResponse(data: Buffer): {
  result: number;
  gccData: Buffer;
} {
  const r = new BufferReader(data);

  // APPLICATION[102] tag = 0x7F66
  const tag1 = r.readUInt8();
  const tag2 = r.readUInt8();
  if (tag1 !== 0x7F || tag2 !== 0x66) {
    throw new Error(`Expected MCS Connect-Response (0x7F66), got 0x${tag1.toString(16)}${tag2.toString(16)}`);
  }
  r.readBerLength(); // total length

  // Result (ENUMERATED)
  r.readUInt8(); // 0x0A tag
  const resultLen = r.readBerLength();
  const result = r.readUInt8();

  // CalledConnectId (INTEGER)
  r.readUInt8(); // 0x02 tag
  const cciLen = r.readBerLength();
  r.skip(cciLen);

  // DomainParameters (SEQUENCE)
  r.readUInt8(); // 0x30 tag
  const dpLen = r.readBerLength();
  r.skip(dpLen);

  // userData (OCTET STRING)
  r.readUInt8(); // 0x04 tag
  const udLen = r.readBerLength();
  const gccData = r.readBytes(udLen);

  return { result, gccData };
}

export function buildMCSErectDomainRequest(): Buffer {
  const w = new BufferWriter(8);
  // PER encoded: CHOICE index for ErectDomainRequest = 1
  w.writeUInt8((types.MCSPDUType.ERECT_DOMAIN_REQUEST) << 2);
  w.writeUInt16BE(0); // subHeight
  w.writeUInt16BE(0); // subInterval
  return w.toBuffer();
}

export function buildMCSAttachUserRequest(): Buffer {
  const w = new BufferWriter(2);
  w.writeUInt8((types.MCSPDUType.ATTACH_USER_REQUEST) << 2);
  return w.toBuffer();
}

export function parseMCSAttachUserConfirm(data: Buffer): {
  result: number;
  userId: number;
} {
  const r = new BufferReader(data);
  const byte1 = r.readUInt8();
  const pduType = byte1 >> 2;
  if (pduType !== types.MCSPDUType.ATTACH_USER_CONFIRM) {
    throw new Error(`Expected AttachUserConfirm, got ${pduType}`);
  }
  const enumerated = r.readUInt8();
  const result = enumerated >> 2;
  const userId = r.readUInt16BE() + 1001; // MCS user IDs start at 1001
  return { result, userId };
}

export function buildMCSChannelJoinRequest(userId: number, channelId: number): Buffer {
  const w = new BufferWriter(8);
  w.writeUInt8((types.MCSPDUType.CHANNEL_JOIN_REQUEST) << 2);
  w.writeUInt16BE(userId - 1001);
  w.writeUInt16BE(channelId);
  return w.toBuffer();
}

export function parseMCSChannelJoinConfirm(data: Buffer): {
  result: number;
  channelId: number;
} {
  const r = new BufferReader(data);
  const byte1 = r.readUInt8();
  const pduType = byte1 >> 2;
  if (pduType !== types.MCSPDUType.CHANNEL_JOIN_CONFIRM) {
    throw new Error(`Expected ChannelJoinConfirm, got ${pduType}`);
  }
  const enumerated = r.readUInt8();
  const result = enumerated >> 2;
  r.readUInt16BE(); // user id
  const requested = r.readUInt16BE();
  const channelId = (r.remaining >= 2) ? r.readUInt16BE() : requested;
  return { result, channelId };
}

export function buildMCSSendDataRequest(userId: number, channelId: number, payload: Buffer): Buffer {
  const w = new BufferWriter(payload.length + 8);
  // SendDataRequest with PER encoding
  const byte1 = (types.MCSPDUType.SEND_DATA_REQUEST) << 2;
  w.writeUInt8(byte1);
  w.writeUInt16BE(userId - 1001);
  w.writeUInt16BE(channelId);
  w.writeUInt8(0x70); // priority + segmentation flags (dataPriority=high, segmentation=begin|end)
  // PER encoded length
  if (payload.length < 0x80) {
    w.writeUInt8(payload.length);
  } else if (payload.length < 0x4000) {
    w.writeUInt16BE(payload.length | 0x8000);
  } else {
    throw new Error('Payload too large for MCS SendDataRequest');
  }
  w.writeBuffer(payload);
  return w.toBuffer();
}

export function parseMCSSendDataIndication(data: Buffer): {
  userId: number;
  channelId: number;
  payload: Buffer;
} {
  const r = new BufferReader(data);
  const byte1 = r.readUInt8();
  const pduType = byte1 >> 2;
  if (pduType !== types.MCSPDUType.SEND_DATA_INDICATION) {
    throw new Error(`Expected SendDataIndication (26), got ${pduType}`);
  }
  const userId = r.readUInt16BE() + 1001;
  const channelId = r.readUInt16BE();
  r.readUInt8(); // priority + segmentation
  const payloadLen = r.readPerLength();
  const payload = r.readBytes(payloadLen);
  return { userId, channelId, payload };
}

// ===== GCC (Generic Conference Control) =====

export function buildGCCConferenceCreateRequest(clientData: Buffer): Buffer {
  const w = new BufferWriter(clientData.length + 32);

  // PER encoded ConnectData
  // Key: object identifier (T.124 key)
  w.writeUInt16BE(0x0005); // object length + tag
  w.writeBytes([
    0x00, 0x14, 0x7C, 0x00, 0x01, // T.124 OID
  ]);

  // ConnectData::connectPDU length (PER)
  const connectPduLen = clientData.length + 14;
  if (connectPduLen < 0x80) {
    w.writeUInt8(connectPduLen);
  } else {
    w.writeUInt16BE(connectPduLen | 0x8000);
  }

  // PER encoded ConferenceCreateRequest
  w.writeUInt16BE(0x0008); // conference-name numeric
  w.writeUInt16BE(0x0010); // padding

  // H221 non-standard key "Duca"
  w.writeUInt8(0x00);
  w.writeUInt8(0xC0);   // OccurrenceTag [CHOICE]
  w.writeUInt8(0x01);
  w.writeUInt8(0x00);   // Optional flag
  w.writeUInt8(0x44);   // 'D'
  w.writeUInt8(0x75);   // 'u'
  w.writeUInt8(0x63);   // 'c'
  w.writeUInt8(0x61);   // 'a'

  // User data length
  if (clientData.length < 0x80) {
    w.writeUInt8(clientData.length);
  } else {
    w.writeUInt16BE(clientData.length | 0x8000);
  }

  w.writeBuffer(clientData);
  return w.toBuffer();
}

export function parseGCCConferenceCreateResponse(data: Buffer): Buffer {
  const r = new BufferReader(data);

  // ConnectData key: choice(1) + OID length(1) + OID value(5)
  const keyChoice = r.readUInt8();       // 0x00 = select object
  const oidLen = r.readUInt8();          // OID length (typically 5)
  r.skip(oidLen);                        // T.124 OID bytes

  // connectPDU (OCTET STRING) length
  const connectPduLen = r.readPerLength();

  // ConferenceCreateResponse fields (PER encoded):
  // 0) selection byte — extension bit + optional-userData-present bit + padding
  const selection = r.readUInt8();

  // 1) nodeID — PER constrained integer (UInt16BE, offset from 1001)
  const nodeIdRaw = r.readUInt16BE();

  // 2) tag — PER unconstrained integer: per_read_length + value bytes
  const tagLen = r.readPerLength();
  r.skip(tagLen);

  // 3) result — PER enumerated (1 byte)
  const result = r.readUInt8();

  // 4) number of userData SET members (1 byte)
  const numSets = r.readUInt8();

  // 5) H221 non-standard: choice(1) + OCTET STRING SIZE(4..255) (offset-len + key)
  const h221Choice = r.readUInt8();      // 0xC0
  const h221KeyLenOffset = r.readUInt8(); // PER offset: actual_len = value + 4
  const h221Key = r.readBytes(h221KeyLenOffset + 4); // "McDn"

  // User data length (PER)
  const udLen = r.readPerLength();
  return r.readBytes(Math.min(udLen, r.remaining));
}

// ===== Client GCC User Data Blocks =====

export function buildClientCoreData(config: types.RdpClientConfig, selectedProtocol = 0): Buffer {
  const w = new BufferWriter(256);
  w.writeUInt16LE(types.CS_CORE);  // header type
  const lenPos = w.position;
  w.writeUInt16LE(0);              // length placeholder

  w.writeUInt32LE(0x00080004);    // RDP version 5.4+
  w.writeUInt16LE(config.width);  // desktopWidth
  w.writeUInt16LE(config.height); // desktopHeight
  w.writeUInt16LE(types.RNS_UD_COLOR_8BPP); // colorDepth (ignored with postBeta2)
  w.writeUInt16LE(0xCA03);        // SASSequence
  w.writeUInt32LE(0x00000409);    // keyboardLayout (US)
  w.writeUInt32LE(2600);          // clientBuild
  // clientName (32 bytes unicode)
  const nameBuf = Buffer.alloc(32);
  Buffer.from('RDPea', 'utf16le').copy(nameBuf);
  w.writeBuffer(nameBuf);
  w.writeUInt32LE(4);             // keyboardType (enhanced 101/102)
  w.writeUInt32LE(0);             // keyboardSubType
  w.writeUInt32LE(12);            // keyboardFunctionKey
  w.writePad(64);                 // imeFileName (64 bytes)
  // Post-beta2 fields
  w.writeUInt16LE(0xCA01);        // postBeta2ColorDepth
  w.writeUInt16LE(1);             // clientProductId
  w.writeUInt32LE(0);             // serialNumber
  // High color depth
  const highColor = config.colorDepth === 24 ? types.HIGH_COLOR_24BPP
    : config.colorDepth === 16 ? types.HIGH_COLOR_16BPP
    : types.HIGH_COLOR_15BPP;
  w.writeUInt16LE(highColor);
  // Supported color depths
  w.writeUInt16LE(0x0007);        // supportedColorDepths (24, 16, 15)
  // Early capability flags
  w.writeUInt16LE(0x0001 | 0x0004 | 0x0008 | 0x0020); // RNS_UD_CS_SUPPORT_ERRINFO_PDU | WANT_32BPP | STATUSINFO | DYNVC
  // clientDigProductId (64 bytes)
  w.writePad(64);
  w.writeUInt8(0);                // connectionType (unknown)
  w.writeUInt8(0);                // pad1octet
  w.writeUInt32LE(selectedProtocol); // serverSelectedProtocol

  // Set length
  const totalLen = w.position;
  w.setUInt16LE(totalLen, lenPos);
  return w.toBuffer();
}

export function buildClientSecurityData(encryptionMethods: number): Buffer {
  const w = new BufferWriter(16);
  w.writeUInt16LE(types.CS_SECURITY);
  w.writeUInt16LE(12);
  w.writeUInt32LE(encryptionMethods); // encryptionMethods
  w.writeUInt32LE(0);                 // extEncryptionMethods
  return w.toBuffer();
}

export function buildClientNetworkData(channels: types.ChannelDef[]): Buffer {
  const w = new BufferWriter(16 + channels.length * 12);
  w.writeUInt16LE(types.CS_NET);
  w.writeUInt16LE(8 + channels.length * 12);
  w.writeUInt32LE(channels.length);
  for (const ch of channels) {
    const nameBuf = Buffer.alloc(8);
    Buffer.from(ch.name, 'ascii').copy(nameBuf);
    w.writeBuffer(nameBuf);
    w.writeUInt32LE(ch.options);
  }
  return w.toBuffer();
}

// ===== Parse Server GCC Data =====

export function parseServerGCCData(data: Buffer): {
  core: types.ServerCoreData;
  security: types.ServerSecurityData;
  network: types.ServerNetworkData;
} {
  const r = new BufferReader(data);
  let core: types.ServerCoreData = { rdpVersion: 0, clientRequestedProtocols: 0, earlyCapabilityFlags: 0 };
  let security: types.ServerSecurityData = { encryptionMethod: 0, encryptionLevel: 0 };
  let network: types.ServerNetworkData = { MCSChannelId: 0, channelIds: [] };

  while (r.remaining >= 4) {
    const headerType = r.readUInt16LE();
    const headerLen = r.readUInt16LE();
    const blockData = r.readBytes(headerLen - 4);
    const br = new BufferReader(blockData);

    switch (headerType) {
      case types.SC_CORE:
        core.rdpVersion = br.readUInt32LE();
        if (br.remaining >= 4) core.clientRequestedProtocols = br.readUInt32LE();
        if (br.remaining >= 4) core.earlyCapabilityFlags = br.readUInt32LE();
        break;

      case types.SC_SECURITY:
        security.encryptionMethod = br.readUInt32LE();
        security.encryptionLevel = br.readUInt32LE();
        if (security.encryptionLevel > 0 && br.remaining >= 8) {
          const serverRandomLen = br.readUInt32LE();
          const serverCertLen = br.readUInt32LE();
          if (serverRandomLen > 0) security.serverRandom = br.readBytes(serverRandomLen);
          if (serverCertLen > 0) security.serverCertificate = br.readBytes(serverCertLen);
        }
        break;

      case types.SC_NET:
        network.MCSChannelId = br.readUInt16LE();
        const channelCount = br.readUInt16LE();
        for (let i = 0; i < channelCount; i++) {
          network.channelIds.push(br.readUInt16LE());
        }
        break;
    }
  }

  return { core, security, network };
}
