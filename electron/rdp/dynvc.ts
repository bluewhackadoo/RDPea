// Dynamic Virtual Channels (MS-RDPEDYC) and the Display Control channel (MS-RDPEDISP).
//
// DVCs ride inside the static "drdynvc" channel. The server opens the channels it wants;
// we accept only "Microsoft::Windows::RDS::DisplayControl", which lets the client ask the
// server to change the desktop resolution on the fly (the mechanism behind resize-to-fit in
// mstsc and Windows Sandbox). The server answers with a Deactivate All / Demand Active
// sequence carrying the new size.
import { BufferReader } from './bufferReader';
import { BufferWriter } from './bufferWriter';

export const DRDYNVC_CHANNEL_NAME = 'drdynvc';
export const DISPLAY_CONTROL_CHANNEL_NAME = 'Microsoft::Windows::RDS::DisplayControl';

// DVC command values (high nibble of the header byte)
const CMD_CREATE = 0x01;
const CMD_DATA_FIRST = 0x02;
const CMD_DATA = 0x03;
const CMD_CLOSE = 0x04;
const CMD_CAPS = 0x05;

// Static virtual channel chunk size we advertised; a DVC PDU must fit in one chunk
const MAX_CHUNK = 1600;

// Display control PDU types
const DISPLAYCONTROL_PDU_TYPE_CAPS = 0x05;
const DISPLAYCONTROL_PDU_TYPE_MONITOR_LAYOUT = 0x02;
const DISPLAYCONTROL_MONITOR_PRIMARY = 0x01;

export const DISPLAY_MIN_DIMENSION = 200;
export const DISPLAY_MAX_DIMENSION = 8192;

interface DvcChannel {
  name: string;
  fragments: Buffer[];
  expectedLength: number; // 0 when not reassembling
}

export interface DisplayControlCaps {
  channelId: number;
  maxNumMonitors: number;
  maxMonitorAreaFactorA: number;
  maxMonitorAreaFactorB: number;
}

export interface DynvcState {
  version: number;
  channels: Map<number, DvcChannel>;
  displayControl: DisplayControlCaps | null;
}

export function createDynvcState(): DynvcState {
  return { version: 0, channels: new Map(), displayControl: null };
}

export interface DynvcResult {
  responses: Buffer[];      // PDUs to send back on the drdynvc channel
  log: string[];
  displayControlReady: boolean; // true when the DisplayControl channel just became usable
  displayControlClosed: boolean;
}

function readChannelId(r: BufferReader, cbId: number): number {
  if (cbId === 0) return r.readUInt8();
  if (cbId === 1) return r.readUInt16LE();
  return r.readUInt32LE();
}

function writeChannelId(w: BufferWriter, cbId: number, id: number): void {
  if (cbId === 0) w.writeUInt8(id);
  else if (cbId === 1) w.writeUInt16LE(id);
  else w.writeUInt32LE(id);
}

function cbIdFor(id: number): number {
  if (id <= 0xFF) return 0;
  if (id <= 0xFFFF) return 1;
  return 2;
}

function readLength(r: BufferReader, sp: number): number {
  if (sp === 0) return r.readUInt8();
  if (sp === 1) return r.readUInt16LE();
  return r.readUInt32LE();
}

// Process one PDU received on the drdynvc static channel
export function processDynvcData(data: Buffer, state: DynvcState): DynvcResult {
  const result: DynvcResult = { responses: [], log: [], displayControlReady: false, displayControlClosed: false };
  const r = new BufferReader(data);
  if (r.remaining < 1) return result;

  const header = r.readUInt8();
  const cmd = (header >> 4) & 0x0F;
  const sp = (header >> 2) & 0x03;
  const cbId = header & 0x03;

  switch (cmd) {
    case CMD_CAPS: {
      // DYNVC_CAPS_VERSIONn: header, pad, version, [priority charges]
      if (r.remaining < 3) return result;
      r.skip(1);
      state.version = r.readUInt16LE();
      result.log.push(`DVC capabilities: server version ${state.version}`);
      // DYNVC_CAPS_RSP: cmd 5, sp 0, cbId 0, pad, version
      const w = new BufferWriter(4);
      w.writeUInt8(CMD_CAPS << 4);
      w.writeUInt8(0);
      w.writeUInt16LE(Math.min(state.version, 3));
      result.responses.push(w.toBuffer());
      return result;
    }

    case CMD_CREATE: {
      const channelId = readChannelId(r, cbId);
      const raw = r.readBytes(r.remaining);
      const nul = raw.indexOf(0);
      const name = raw.subarray(0, nul >= 0 ? nul : raw.length).toString('ascii');
      const accept = name === DISPLAY_CONTROL_CHANNEL_NAME;
      result.log.push(`DVC create request: "${name}" (id ${channelId}) → ${accept ? 'accept' : 'decline'}`);

      // DYNVC_CREATE_RSP: same header cbId, channelId, CreationStatus (int32, <0 = refused)
      const w = new BufferWriter(12);
      w.writeUInt8((CMD_CREATE << 4) | cbId);
      writeChannelId(w, cbId, channelId);
      w.writeUInt32LE(accept ? 0x00000000 : 0xC0000001); // STATUS_UNSUCCESSFUL
      result.responses.push(w.toBuffer());

      if (accept) {
        state.channels.set(channelId, { name, fragments: [], expectedLength: 0 });
      }
      return result;
    }

    case CMD_DATA_FIRST:
    case CMD_DATA: {
      const channelId = readChannelId(r, cbId);
      const ch = state.channels.get(channelId);
      if (!ch) return result; // data for a channel we declined

      let complete: Buffer | null = null;
      if (cmd === CMD_DATA_FIRST) {
        const total = readLength(r, sp);
        const chunk = r.readBytes(r.remaining);
        ch.fragments = [chunk];
        ch.expectedLength = total;
        if (chunk.length >= total) { complete = chunk; ch.fragments = []; ch.expectedLength = 0; }
      } else {
        const chunk = r.readBytes(r.remaining);
        if (ch.expectedLength > 0) {
          ch.fragments.push(chunk);
          const have = ch.fragments.reduce((n, f) => n + f.length, 0);
          if (have >= ch.expectedLength) {
            complete = Buffer.concat(ch.fragments);
            ch.fragments = [];
            ch.expectedLength = 0;
          }
        } else {
          complete = chunk;
        }
      }

      if (complete && ch.name === DISPLAY_CONTROL_CHANNEL_NAME) {
        handleDisplayControlData(complete, channelId, state, result);
      }
      return result;
    }

    case CMD_CLOSE: {
      const channelId = readChannelId(r, cbId);
      const ch = state.channels.get(channelId);
      if (ch) {
        result.log.push(`DVC close: "${ch.name}" (id ${channelId})`);
        state.channels.delete(channelId);
        if (ch.name === DISPLAY_CONTROL_CHANNEL_NAME) {
          state.displayControl = null;
          result.displayControlClosed = true;
        }
      }
      return result;
    }

    default:
      result.log.push(`DVC: unhandled command 0x${cmd.toString(16)}`);
      return result;
  }
}

function handleDisplayControlData(data: Buffer, channelId: number, state: DynvcState, result: DynvcResult): void {
  const r = new BufferReader(data);
  if (r.remaining < 8) return;
  const type = r.readUInt32LE();
  r.readUInt32LE(); // length
  if (type === DISPLAYCONTROL_PDU_TYPE_CAPS && r.remaining >= 12) {
    state.displayControl = {
      channelId,
      maxNumMonitors: r.readUInt32LE(),
      maxMonitorAreaFactorA: r.readUInt32LE(),
      maxMonitorAreaFactorB: r.readUInt32LE(),
    };
    result.displayControlReady = true;
    result.log.push(
      `Display Control ready: maxMonitors=${state.displayControl.maxNumMonitors}, ` +
      `maxArea=${state.displayControl.maxMonitorAreaFactorA}x${state.displayControl.maxMonitorAreaFactorB}`,
    );
  } else {
    result.log.push(`Display Control: unhandled PDU type 0x${type.toString(16)}`);
  }
}

// Clamp a requested desktop size to what the protocol and the server accept.
// Width must be even (spec); we use multiples of 4 to keep every bitmap stride aligned.
export function normalizeDesktopSize(width: number, height: number, caps?: DisplayControlCaps | null): { width: number; height: number } {
  let w = Math.floor(width / 4) * 4;
  let h = Math.floor(height / 4) * 4;
  w = Math.max(DISPLAY_MIN_DIMENSION, Math.min(DISPLAY_MAX_DIMENSION, w));
  h = Math.max(DISPLAY_MIN_DIMENSION, Math.min(DISPLAY_MAX_DIMENSION, h));
  if (caps && caps.maxMonitorAreaFactorA > 0 && caps.maxMonitorAreaFactorB > 0) {
    const maxArea = caps.maxMonitorAreaFactorA * caps.maxMonitorAreaFactorB;
    if (w * h > maxArea) {
      const s = Math.sqrt(maxArea / (w * h));
      w = Math.max(DISPLAY_MIN_DIMENSION, Math.floor((w * s) / 4) * 4);
      h = Math.max(DISPLAY_MIN_DIMENSION, Math.floor((h * s) / 4) * 4);
    }
  }
  return { width: w, height: h };
}

// DISPLAYCONTROL_MONITOR_LAYOUT_PDU for a single primary monitor at the given size
export function buildMonitorLayoutPdu(width: number, height: number): Buffer {
  const MONITOR_LAYOUT_SIZE = 40;
  const w = new BufferWriter(8 + 8 + MONITOR_LAYOUT_SIZE);
  w.writeUInt32LE(DISPLAYCONTROL_PDU_TYPE_MONITOR_LAYOUT);
  w.writeUInt32LE(8 + 8 + MONITOR_LAYOUT_SIZE); // Length (whole PDU)
  w.writeUInt32LE(MONITOR_LAYOUT_SIZE);
  w.writeUInt32LE(1); // NumMonitors
  // DISPLAYCONTROL_MONITOR_LAYOUT
  w.writeUInt32LE(DISPLAYCONTROL_MONITOR_PRIMARY); // Flags
  w.writeUInt32LE(0); // Left
  w.writeUInt32LE(0); // Top
  w.writeUInt32LE(width);
  w.writeUInt32LE(height);
  w.writeUInt32LE(0); // PhysicalWidth (mm, 0 = unknown)
  w.writeUInt32LE(0); // PhysicalHeight
  w.writeUInt32LE(0); // Orientation (0 = landscape)
  w.writeUInt32LE(100); // DesktopScaleFactor (%)
  w.writeUInt32LE(100); // DeviceScaleFactor (%)
  return w.toBuffer();
}

// Wrap a payload for a DVC into one or more drdynvc PDUs (DATA_FIRST + DATA when fragmented)
export function buildDynvcDataPdus(channelId: number, payload: Buffer): Buffer[] {
  const cbId = cbIdFor(channelId);
  const idLen = cbId === 0 ? 1 : cbId === 1 ? 2 : 4;
  const single = 1 + idLen + payload.length;
  if (single <= MAX_CHUNK) {
    const w = new BufferWriter(single);
    w.writeUInt8((CMD_DATA << 4) | cbId);
    writeChannelId(w, cbId, channelId);
    w.writeBuffer(payload);
    return [w.toBuffer()];
  }

  const pdus: Buffer[] = [];
  const sp = payload.length <= 0xFF ? 0 : payload.length <= 0xFFFF ? 1 : 2;
  const lenLen = sp === 0 ? 1 : sp === 1 ? 2 : 4;
  let offset = 0;

  const firstChunk = Math.min(payload.length, MAX_CHUNK - 1 - idLen - lenLen);
  const first = new BufferWriter(1 + idLen + lenLen + firstChunk);
  first.writeUInt8((CMD_DATA_FIRST << 4) | (sp << 2) | cbId);
  writeChannelId(first, cbId, channelId);
  if (sp === 0) first.writeUInt8(payload.length);
  else if (sp === 1) first.writeUInt16LE(payload.length);
  else first.writeUInt32LE(payload.length);
  first.writeBuffer(payload.subarray(0, firstChunk));
  pdus.push(first.toBuffer());
  offset += firstChunk;

  while (offset < payload.length) {
    const chunk = Math.min(payload.length - offset, MAX_CHUNK - 1 - idLen);
    const w = new BufferWriter(1 + idLen + chunk);
    w.writeUInt8((CMD_DATA << 4) | cbId);
    writeChannelId(w, cbId, channelId);
    w.writeBuffer(payload.subarray(offset, offset + chunk));
    pdus.push(w.toBuffer());
    offset += chunk;
  }
  return pdus;
}
