// RDPSND — Audio Output Virtual Channel (MS-RDPEA)
import { BufferWriter } from './bufferWriter';
import { BufferReader } from './bufferReader';
import * as types from './types';

export interface AudioState {
  serverFormats: types.AudioFormat[];
  clientFormats: types.AudioFormat[];
  selectedFormat: number;
  version: number;
  initialized: boolean;
  blockId: number;
  // WAVE_INFO split protocol state
  pendingWave?: {
    wTimeStamp: number;
    wFormatNo: number;
    cBlockNo: number;
    initialData: Buffer;
  };
}

export function createAudioState(): AudioState {
  return {
    serverFormats: [],
    clientFormats: [],
    selectedFormat: -1,
    version: 0,
    initialized: false,
    blockId: 0,
  };
}

// Parse RDPSND PDU header
export function parseRdpSndPDU(data: Buffer): { msgType: number; bodySize: number; body: Buffer } {
  const r = new BufferReader(data);
  const msgType = r.readUInt8();
  r.readUInt8(); // bPad
  const bodySize = r.readUInt16LE();
  const body = r.readBytes(Math.min(bodySize, r.remaining));
  return { msgType, bodySize, body };
}

// Parse Server Audio Formats and Version PDU
export function parseServerAudioFormats(body: Buffer): {
  version: number;
  formats: types.AudioFormat[];
} {
  const r = new BufferReader(body);
  r.readUInt32LE(); // dwFlags
  r.readUInt32LE(); // dwVolume
  r.readUInt32LE(); // dwPitch
  const dgramPort = r.readUInt16LE();
  const numFormats = r.readUInt16LE();
  r.readUInt8(); // cLastBlockConfirmed
  const version = r.readUInt16LE();
  r.readUInt8(); // bPad

  const formats: types.AudioFormat[] = [];
  for (let i = 0; i < numFormats && r.remaining >= 18; i++) {
    const formatTag = r.readUInt16LE();
    const nChannels = r.readUInt16LE();
    const nSamplesPerSec = r.readUInt32LE();
    const nAvgBytesPerSec = r.readUInt32LE();
    const nBlockAlign = r.readUInt16LE();
    const wBitsPerSample = r.readUInt16LE();
    const cbSize = r.readUInt16LE();
    let extraData: Buffer | undefined;
    if (cbSize > 0 && r.remaining >= cbSize) {
      extraData = r.readBytes(cbSize);
    }
    formats.push({
      formatTag, nChannels, nSamplesPerSec,
      nAvgBytesPerSec, nBlockAlign, wBitsPerSample, extraData,
    });
  }

  return { version, formats };
}

// Build Client Audio Formats and Version PDU
export function buildClientAudioFormats(
  serverFormats: types.AudioFormat[],
  version: number
): Buffer {
  // We support PCM formats only
  const supportedFormats = serverFormats.filter(f =>
    f.formatTag === types.WAVE_FORMAT_PCM
  );

  // If no PCM, take first format
  const formats = supportedFormats.length > 0 ? supportedFormats : serverFormats.slice(0, 1);

  const w = new BufferWriter(256);
  // Header
  w.writeUInt8(types.RdpSndPDUType.CLIENT_AUDIO_VERSION_AND_FORMATS);
  w.writeUInt8(0); // bPad
  const bodySizePos = w.position;
  w.writeUInt16LE(0); // bodySize placeholder

  const bodyStart = w.position;
  w.writeUInt32LE(0x00000001); // dwFlags = TSSNDCAPS_ALIVE
  w.writeUInt32LE(0xFFFFFFFF); // dwVolume
  w.writeUInt32LE(0);          // dwPitch
  w.writeUInt16LE(0);          // wDGramPort
  w.writeUInt16LE(formats.length); // wNumberOfFormats
  w.writeUInt8(0);             // cLastBlockConfirmed
  w.writeUInt16LE(version);    // wVersion
  w.writeUInt8(0);             // bPad

  for (const fmt of formats) {
    w.writeUInt16LE(fmt.formatTag);
    w.writeUInt16LE(fmt.nChannels);
    w.writeUInt32LE(fmt.nSamplesPerSec);
    w.writeUInt32LE(fmt.nAvgBytesPerSec);
    w.writeUInt16LE(fmt.nBlockAlign);
    w.writeUInt16LE(fmt.wBitsPerSample);
    w.writeUInt16LE(fmt.extraData?.length || 0);
    if (fmt.extraData) w.writeBuffer(fmt.extraData);
  }

  const bodySize = w.position - bodyStart;
  w.setUInt16LE(bodySize, bodySizePos);

  return w.toBuffer();
}

// Build Training Confirm PDU
export function buildTrainingConfirm(wTimeStamp: number, wPackSize: number): Buffer {
  const w = new BufferWriter(12);
  w.writeUInt8(types.RdpSndPDUType.TRAINING_CONFIRM);
  w.writeUInt8(0);
  w.writeUInt16LE(4); // bodySize
  w.writeUInt16LE(wTimeStamp);
  w.writeUInt16LE(wPackSize);
  return w.toBuffer();
}

// Parse Wave Info PDU
export function parseWaveInfo(body: Buffer): {
  wTimeStamp: number;
  wFormatNo: number;
  cBlockNo: number;
  audioData: Buffer;
} {
  const r = new BufferReader(body);
  const wTimeStamp = r.readUInt16LE();
  const wFormatNo = r.readUInt16LE();
  const cBlockNo = r.readUInt8();
  r.skip(3); // bPad
  const audioData = r.readBytes(r.remaining);
  return { wTimeStamp, wFormatNo, cBlockNo, audioData };
}

// Parse Wave2 PDU (newer, contains all audio data inline)
export function parseWave2(body: Buffer): {
  wTimeStamp: number;
  wFormatNo: number;
  cBlockNo: number;
  audioData: Buffer;
} {
  const r = new BufferReader(body);
  const wTimeStamp = r.readUInt16LE();
  const wFormatNo = r.readUInt16LE();
  const cBlockNo = r.readUInt8();
  r.skip(3); // bPad
  const dwAudioTimeStamp = r.readUInt32LE();
  const audioData = r.readBytes(r.remaining);
  return { wTimeStamp, wFormatNo, cBlockNo, audioData };
}

// Build Wave Confirm PDU
export function buildWaveConfirm(wTimeStamp: number, cConfirmedBlockNo: number): Buffer {
  const w = new BufferWriter(8);
  w.writeUInt8(types.RdpSndPDUType.WAVE_CONFIRM);
  w.writeUInt8(0);
  w.writeUInt16LE(4); // bodySize
  w.writeUInt16LE(wTimeStamp);
  w.writeUInt8(cConfirmedBlockNo);
  w.writeUInt8(0); // bPad
  return w.toBuffer();
}

// Process incoming RDPSND channel data
export function processRdpSndData(
  data: Buffer,
  audioState: AudioState
): {
  response?: Buffer;
  audioData?: { pcmData: Buffer; format: types.AudioFormat };
} {
  const pdu = parseRdpSndPDU(data);

  switch (pdu.msgType) {
    case types.RdpSndPDUType.SERVER_AUDIO_VERSION_AND_FORMATS: {
      const { version, formats } = parseServerAudioFormats(pdu.body);
      audioState.serverFormats = formats;
      audioState.version = version;
      audioState.initialized = true;

      // Build client format list (PCM only) and store it
      const supportedFormats = formats.filter(f =>
        f.formatTag === types.WAVE_FORMAT_PCM
      );
      audioState.clientFormats = supportedFormats.length > 0 ? supportedFormats : formats.slice(0, 1);
      audioState.selectedFormat = 0;

      return { response: buildClientAudioFormats(formats, version) };
    }

    case types.RdpSndPDUType.TRAINING: {
      const r = new BufferReader(pdu.body);
      const wTimeStamp = r.readUInt16LE();
      const wPackSize = r.readUInt16LE();
      return { response: buildTrainingConfirm(wTimeStamp, wPackSize) };
    }

    case types.RdpSndPDUType.WAVE_INFO: {
      // WAVE_INFO is a split protocol: first chunk has header + first 4 bytes of audio.
      // The remaining audio data arrives in the next VC chunk (no RDPSND header).
      const wave = parseWaveInfo(pdu.body);
      audioState.pendingWave = {
        wTimeStamp: wave.wTimeStamp,
        wFormatNo: wave.wFormatNo,
        cBlockNo: wave.cBlockNo,
        initialData: wave.audioData,
      };
      // Don't confirm yet — wait for continuation chunk
      return {};
    }

    case types.RdpSndPDUType.WAVE2: {
      const wave = parseWave2(pdu.body);
      audioState.blockId = wave.cBlockNo;
      // wFormatNo indexes the CLIENT format list per MS-RDPEA
      const format = audioState.clientFormats[wave.wFormatNo];
      const confirm = buildWaveConfirm(wave.wTimeStamp, wave.cBlockNo);
      if (format) {
        return { response: confirm, audioData: { pcmData: wave.audioData, format } };
      }
      return { response: confirm };
    }

    case types.RdpSndPDUType.CLOSE: {
      audioState.initialized = false;
      audioState.pendingWave = undefined;
      return {};
    }

    default:
      // Check if this is the continuation of a WAVE_INFO split
      if (audioState.pendingWave) {
        const pw = audioState.pendingWave;
        audioState.pendingWave = undefined;
        audioState.blockId = pw.cBlockNo;
        // Continuation chunk: 4 padding bytes + remaining audio data
        const remainingData = data.subarray(4);
        const fullAudio = Buffer.concat([pw.initialData, remainingData]);
        // wFormatNo indexes the CLIENT format list per MS-RDPEA
        const format = audioState.clientFormats[pw.wFormatNo];
        const confirm = buildWaveConfirm(pw.wTimeStamp, pw.cBlockNo);
        if (format) {
          return { response: confirm, audioData: { pcmData: fullAudio, format } };
        }
        return { response: confirm };
      }
      return {};
  }
}
