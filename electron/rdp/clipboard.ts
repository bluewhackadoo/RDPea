// CLIPRDR — Clipboard Redirection Virtual Channel (MS-RDPECLIP)
import { BufferWriter } from './bufferWriter';
import { BufferReader } from './bufferReader';
import * as types from './types';

export interface ClipboardState {
  initialized: boolean;
  useLongFormatNames: boolean;
  serverReady: boolean;
  // Text we're holding to respond to CB_FORMAT_DATA_REQUEST
  pendingClientText: string | null;
}

export function createClipboardState(): ClipboardState {
  return {
    initialized: false,
    useLongFormatNames: false,
    serverReady: false,
    pendingClientText: null,
  };
}

export interface ClipboardResult {
  responses: Buffer[];
  // Text received from the remote server clipboard
  remoteText?: string;
}

// Build a CLIPRDR PDU header + body
function buildClipPDU(msgType: number, msgFlags: number, body: Buffer): Buffer {
  const w = new BufferWriter(8 + body.length);
  w.writeUInt16LE(msgType);
  w.writeUInt16LE(msgFlags);
  w.writeUInt32LE(body.length);
  w.writeBuffer(body);
  return w.toBuffer();
}

// Build Client Clipboard Capabilities PDU
function buildClientCapabilities(): Buffer {
  // General Capability Set: capabilitySetType(2) + lengthCapability(2) + version(4) + generalFlags(4)
  const capSet = new BufferWriter(12);
  capSet.writeUInt16LE(types.CB_CAPSTYPE_GENERAL);
  capSet.writeUInt16LE(12); // length of this capability set
  capSet.writeUInt32LE(types.CB_CAPS_VERSION_2);
  capSet.writeUInt32LE(types.CB_USE_LONG_FORMAT_NAMES);

  // CB_CLIP_CAPS body: cCapabilitiesSets(2) + pad(2) + capabilitySets
  const body = new BufferWriter(4 + 12);
  body.writeUInt16LE(1); // cCapabilitiesSets
  body.writeUInt16LE(0); // pad
  body.writeBuffer(capSet.toBuffer());

  return buildClipPDU(types.ClipPDUType.CB_CLIP_CAPS, 0, body.toBuffer());
}

// Build a Format List PDU advertising CF_UNICODETEXT (long format names)
function buildFormatListLong(): Buffer {
  // Long format: formatId(4) + formatName(null-terminated UTF-16LE, or just 2-byte null for standard)
  const body = new BufferWriter(8);
  body.writeUInt32LE(types.CF_UNICODETEXT);
  body.writeUInt16LE(0); // empty name (standard format) — null terminator
  return buildClipPDU(types.ClipPDUType.CB_FORMAT_LIST, 0, body.toBuffer());
}

// Build a Format List PDU advertising CF_UNICODETEXT (short format names)
function buildFormatListShort(): Buffer {
  // Short format: formatId(4) + formatName(32 bytes, zero-padded)
  const body = new BufferWriter(36);
  body.writeUInt32LE(types.CF_UNICODETEXT);
  body.writePad(32); // empty name padded to 32 bytes
  return buildClipPDU(types.ClipPDUType.CB_FORMAT_LIST, 0, body.toBuffer());
}

// Build Format List Response (acknowledge server's format list)
function buildFormatListResponse(ok: boolean): Buffer {
  return buildClipPDU(
    types.ClipPDUType.CB_FORMAT_LIST_RESPONSE,
    ok ? types.CB_RESPONSE_OK : types.CB_RESPONSE_FAIL,
    Buffer.alloc(0)
  );
}

// Build Format Data Request for CF_UNICODETEXT
function buildFormatDataRequest(formatId: number): Buffer {
  const body = new BufferWriter(4);
  body.writeUInt32LE(formatId);
  return buildClipPDU(types.ClipPDUType.CB_FORMAT_DATA_REQUEST, 0, body.toBuffer());
}

// Build Format Data Response with text content
function buildFormatDataResponse(text: string): Buffer {
  // CF_UNICODETEXT: null-terminated UTF-16LE
  const textBuf = Buffer.from(text + '\0', 'utf16le');
  return buildClipPDU(
    types.ClipPDUType.CB_FORMAT_DATA_RESPONSE,
    types.CB_RESPONSE_OK,
    textBuf
  );
}

// Build a failed Format Data Response
function buildFormatDataResponseFail(): Buffer {
  return buildClipPDU(
    types.ClipPDUType.CB_FORMAT_DATA_RESPONSE,
    types.CB_RESPONSE_FAIL,
    Buffer.alloc(0)
  );
}

// Process incoming CLIPRDR channel data
export function processClipData(data: Buffer, state: ClipboardState): ClipboardResult {
  const result: ClipboardResult = { responses: [] };

  if (data.length < 8) return result;

  const r = new BufferReader(data);
  const msgType = r.readUInt16LE();
  const msgFlags = r.readUInt16LE();
  const dataLen = r.readUInt32LE();
  const body = r.readBytes(Math.min(dataLen, r.remaining));

  switch (msgType) {
    case types.ClipPDUType.CB_CLIP_CAPS:
      handleServerCapabilities(body, state);
      // Respond with our capabilities
      result.responses.push(buildClientCapabilities());
      state.initialized = true;
      break;

    case types.ClipPDUType.CB_MONITOR_READY:
      state.serverReady = true;
      // Send our capabilities if not already sent
      if (!state.initialized) {
        result.responses.push(buildClientCapabilities());
        state.initialized = true;
      }
      // Send initial format list (advertise what we have — empty to start)
      if (state.pendingClientText) {
        result.responses.push(
          state.useLongFormatNames ? buildFormatListLong() : buildFormatListShort()
        );
      }
      break;

    case types.ClipPDUType.CB_FORMAT_LIST: {
      // Server clipboard changed — check if it has text
      const hasText = parseFormatList(body, state.useLongFormatNames, msgFlags);
      // Always ACK the format list
      result.responses.push(buildFormatListResponse(true));
      // If server has text, request it
      if (hasText) {
        result.responses.push(buildFormatDataRequest(types.CF_UNICODETEXT));
      }
      break;
    }

    case types.ClipPDUType.CB_FORMAT_LIST_RESPONSE:
      // Server acknowledged our format list — nothing to do
      break;

    case types.ClipPDUType.CB_FORMAT_DATA_REQUEST: {
      // Server wants our clipboard data
      const requestedFormat = body.length >= 4 ? body.readUInt32LE(0) : 0;
      if ((requestedFormat === types.CF_UNICODETEXT || requestedFormat === types.CF_TEXT) && state.pendingClientText !== null) {
        result.responses.push(buildFormatDataResponse(state.pendingClientText));
      } else {
        result.responses.push(buildFormatDataResponseFail());
      }
      break;
    }

    case types.ClipPDUType.CB_FORMAT_DATA_RESPONSE: {
      // Server sent us clipboard data
      if (msgFlags & types.CB_RESPONSE_OK) {
        result.remoteText = decodeUnicodeText(body);
      }
      break;
    }

    default:
      // Ignore unknown PDU types (lock/unlock, file contents, etc.)
      break;
  }

  return result;
}

// Build a Format List PDU to send to the server when local clipboard changes
export function buildClientFormatList(state: ClipboardState): Buffer {
  return state.useLongFormatNames ? buildFormatListLong() : buildFormatListShort();
}

// Parse server capabilities to determine features
function handleServerCapabilities(body: Buffer, state: ClipboardState): void {
  if (body.length < 4) return;
  const r = new BufferReader(body);
  const numCapSets = r.readUInt16LE();
  r.readUInt16LE(); // pad

  for (let i = 0; i < numCapSets && r.remaining >= 4; i++) {
    const capType = r.readUInt16LE();
    const capLen = r.readUInt16LE();
    const capBody = r.readBytes(Math.max(0, capLen - 4));

    if (capType === types.CB_CAPSTYPE_GENERAL && capBody.length >= 8) {
      const _version = capBody.readUInt32LE(0);
      const flags = capBody.readUInt32LE(4);
      state.useLongFormatNames = !!(flags & types.CB_USE_LONG_FORMAT_NAMES);
    }
  }
}

// Parse Format List to check if CF_UNICODETEXT or CF_TEXT is available
function parseFormatList(body: Buffer, longNames: boolean, msgFlags: number): boolean {
  if (body.length === 0) return false;

  const r = new BufferReader(body);

  if (longNames) {
    // Long format names: formatId(4) + null-terminated UTF-16LE name
    while (r.remaining >= 6) {
      const formatId = r.readUInt32LE();
      if (formatId === types.CF_UNICODETEXT || formatId === types.CF_TEXT) return true;
      // Skip null-terminated UTF-16LE name
      while (r.remaining >= 2) {
        const ch = r.readUInt16LE();
        if (ch === 0) break;
      }
    }
  } else {
    // Short format names: formatId(4) + formatName(32 bytes)
    while (r.remaining >= 36) {
      const formatId = r.readUInt32LE();
      if (formatId === types.CF_UNICODETEXT || formatId === types.CF_TEXT) return true;
      r.readBytes(32); // skip name
    }
  }

  return false;
}

// Decode CF_UNICODETEXT (null-terminated UTF-16LE) to JS string
function decodeUnicodeText(body: Buffer): string {
  // Find null terminator (pair of 0x00 bytes on even boundary)
  let end = body.length;
  for (let i = 0; i + 1 < body.length; i += 2) {
    if (body[i] === 0 && body[i + 1] === 0) {
      end = i;
      break;
    }
  }
  return body.subarray(0, end).toString('utf16le');
}
