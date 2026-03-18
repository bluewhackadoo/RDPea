// Main RDP Client — orchestrates the full connection lifecycle
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { RdpTransport } from './transport';
import { NtlmAuth, buildTsRequest, parseTsRequest, asn1Constructed, asn1Sequence, asn1OctetString, asn1Integer } from './ntlm';
import { BufferReader } from './bufferReader';
import { BufferWriter } from './bufferWriter';
import * as protocol from './protocol';
import * as security from './security';
import * as bitmap from './bitmap';
import * as input from './input';
import * as audio from './audio';
import * as clipboard from './clipboard';
import * as types from './types';

export interface RdpClientEvents {
  connect: () => void;
  ready: () => void;
  bitmap: (rects: Array<{ x: number; y: number; width: number; height: number; data: Buffer }>) => void;
  audio: (pcmData: Buffer, format: types.AudioFormat) => void;
  clipboard: (text: string) => void;
  close: () => void;
  error: (err: Error) => void;
}

export class RdpClient extends EventEmitter {
  private config: types.RdpClientConfig;
  private transport: RdpTransport;
  private secState: security.SecurityState;
  private audioState: audio.AudioState;
  private clipState: clipboard.ClipboardState;
  private ntlm: NtlmAuth | null = null;

  private userId = 0;
  private ioChannelId = 1003;
  private mcsChannelId = 0;
  private shareId = 0;
  private channels: types.ChannelDef[] = [];
  private channelMap: Map<number, string> = new Map();
  private selectedProtocol = types.PROTOCOL_RDP;
  private connected = false;
  private phase: 'x224' | 'nla' | 'mcs' | 'security' | 'licensing' | 'active' | 'data' = 'x224';

  // NLA state
  private nlaStep = 0;

  // Channel join tracking — wait for ALL before proceeding
  private pendingChannelJoins = new Set<number>();

  // Standard RDP security — store for Security Exchange PDU
  private clientRandom: Buffer | null = null;
  private encryptedClientRandom: Buffer | null = null;
  private serverPubKey: { modulus: Buffer; exponent: number } | null = null;

  // License phase tracking for proper sec header detection
  private licensingDone = false;

  private log(msg: string, ...args: unknown[]): void {
    console.log(`[RDP][${this.phase}] ${msg}`, ...args);
  }

  private logError(msg: string, ...args: unknown[]): void {
    console.error(`[RDP][${this.phase}] ERROR: ${msg}`, ...args);
  }

  constructor(config: types.RdpClientConfig) {
    super();
    this.config = config;
    this.transport = new RdpTransport();
    this.secState = security.createSecurityState();
    this.audioState = audio.createAudioState();
    this.clipState = clipboard.createClipboardState();

    // Set up virtual channels
    // rdpdr (device redirection) must be registered — Windows servers require it before enabling rdpsnd
    this.channels.push({ name: types.RDPDR_CHANNEL_NAME, options: 0xC0000000 });
    if (config.enableAudio) {
      this.channels.push({ name: types.RDPSND_CHANNEL_NAME, options: 0xC0000000 });
    }
    if (config.enableClipboard) {
      this.channels.push({ name: types.CLIPRDR_CHANNEL_NAME, options: 0xC0A00000 });
    }
  }

  async connect(): Promise<void> {
    try {
      this.log(`Connecting to ${this.config.host}:${this.config.port} (security=${this.config.security})`);

      // Set up transport event handlers
      this.transport.on('packet', (data: Buffer) => this.onPacket(data));
      this.transport.on('fastpath', (data: Buffer) => this.onFastPath(data));
      this.transport.on('credssp', (data: Buffer) => this.onCredSSP(data));
      this.transport.on('error', (err: Error) => {
        this.logError('Transport error:', err.message);
        this.emit('error', err);
      });
      this.transport.on('close', () => {
        this.log('Transport closed');
        this.connected = false;
        this.emit('close');
      });

      // Connect TCP
      await this.transport.connect(this.config.host, this.config.port);
      this.log('TCP connected');
      this.emit('connect');

      // Send X.224 Connection Request
      this.phase = 'x224';
      let requestedProtocols = types.PROTOCOL_SSL;
      if (this.config.security === 'nla' || this.config.security === 'any') {
        requestedProtocols = types.PROTOCOL_HYBRID | types.PROTOCOL_SSL;
      } else if (this.config.security === 'rdp') {
        requestedProtocols = types.PROTOCOL_RDP;
      }

      this.log(`Sending X.224 CR with requested protocols: 0x${requestedProtocols.toString(16)}`);
      const x224Req = protocol.buildX224ConnectionRequest(
        this.config.username || 'rdpea',
        requestedProtocols
      );
      this.transport.send(x224Req);
    } catch (err) {
      this.logError('Connect failed:', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async onPacket(data: Buffer): Promise<void> {
    try {
      if (this.phase === 'x224') {
        await this.handleX224Confirm(data);
        return;
      }

      // All post-X.224 packets: strip 3-byte X.224 Data header to get MCS payload
      const payload = data.subarray(3);
      if (payload.length === 0) return;

      const firstByte = payload[0];
      const pduType = firstByte >> 2;

      // During MCS setup, handle control PDUs (connect-response, attach, join confirms)
      if (this.phase === 'mcs') {
        await this.handleMCSPacket(payload);
        return;
      }

      // After MCS setup, still handle straggling join confirms
      if (pduType === types.MCSPDUType.CHANNEL_JOIN_CONFIRM) {
        this.log(`Late channel join confirm during ${this.phase} phase`);
        await this.handleMCSPacket(payload);
        return;
      }

      if (pduType === types.MCSPDUType.DISCONNECT_PROVIDER_ULTIMATUM) {
        this.log('Received DisconnectProviderUltimatum');
        this.connected = false;
        this.emit('close');
        return;
      }

      // Data PDUs (SendDataIndication)
      if (pduType === types.MCSPDUType.SEND_DATA_INDICATION) {
        await this.handleMCSData(payload);
        return;
      }

      this.log(`Unhandled TPKT packet in ${this.phase} phase, pduType=${pduType}, len=${data.length}`);
    } catch (err) {
      this.logError('onPacket error:', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async handleX224Confirm(data: Buffer): Promise<void> {
    const confirm = protocol.parseX224ConnectionConfirm(data);
    this.selectedProtocol = confirm.selectedProtocol;
    this.log(`X.224 CC received, selectedProtocol=0x${this.selectedProtocol.toString(16)}`);

    if (this.selectedProtocol === types.PROTOCOL_HYBRID) {
      this.log('Using NLA (CredSSP + TLS)');
      this.secState.useTls = true;
      this.phase = 'nla';
      await this.transport.upgradeToTls(this.config.host);
      this.log('TLS upgrade complete for NLA');
      this.log(`NLA: Credentials — domain="${this.config.domain}", hasUser=${!!this.config.username}, hasPassword=${!!this.config.password}`);
      this.ntlm = new NtlmAuth({
        username: this.config.username,
        password: this.config.password,
        domain: this.config.domain,
      });
      this.nlaStep = 0;
      this.sendNLANegotiate();
    } else if (this.selectedProtocol === types.PROTOCOL_SSL) {
      this.log('Using TLS-only security');
      this.secState.useTls = true;
      await this.transport.upgradeToTls(this.config.host);
      this.log('TLS upgrade complete');
      this.startMCS();
    } else {
      this.log('Using standard RDP security (no TLS)');
      this.startMCS();
    }
  }

  // ===== NLA/CredSSP Flow =====

  private sendNLANegotiate(): void {
    if (!this.ntlm) return;
    this.log('NLA: Sending NTLM Negotiate (Type 1)');
    const negoMsg = this.ntlm.createNegotiateMessage();
    const tsReq = buildTsRequest(6, negoMsg);
    this.transport.send(tsReq);
    this.nlaStep = 1;
  }

  private async onCredSSP(data: Buffer): Promise<void> {
    try {
      if (!this.ntlm) {
        this.logError('NLA: Received CredSSP data but NTLM not initialized');
        return;
      }
      const tsResp = parseTsRequest(data);

      if (tsResp.errorCode) {
        this.logError(`NLA: Server returned error code: 0x${tsResp.errorCode.toString(16)}`);
        this.emit('error', new Error(`NLA authentication failed: error 0x${tsResp.errorCode.toString(16)}`));
        return;
      }

      if (this.nlaStep === 1 && tsResp.negoToken) {
        const challenge = this.ntlm.parseChallengeMessage(tsResp.negoToken);
        const authMsg = this.ntlm.createAuthenticateMessage(challenge);

        // Initialize NTLM sealing after authentication
        this.ntlm.initializeSealing();

        // Build pubKeyAuth using NTLM SealMessage (EncryptMessage)
        const tlsSocket = this.transport.getTlsSocket();
        let pubKeyAuth: Buffer | undefined;
        let clientNonce: Buffer | undefined;
        const credsspVersion = tsResp.version || 6;

        if (tlsSocket) {
          const cert = tlsSocket.getPeerCertificate();
          if (cert && cert.pubkey) {
            // Convert SubjectPublicKeyInfo (SPKI) to raw PKCS#1 public key
            // Windows CredSSP uses the raw key (equivalent to i2d_PublicKey), not the full SPKI
            const keyObj = crypto.createPublicKey({ key: cert.pubkey, type: 'spki', format: 'der' });
            const serverPublicKey = keyObj.export({ type: 'pkcs1', format: 'der' }) as Buffer;
            if (credsspVersion >= 5) {
              // CredSSP v5+: nonce-based binding hash (CVE-2018-0886 fix)
              clientNonce = crypto.randomBytes(32);
              const bindingHash = crypto.createHash('sha256')
                .update('CredSSP Client-To-Server Binding Hash\0')
                .update(clientNonce)
                .update(serverPublicKey)
                .digest();
              pubKeyAuth = this.ntlm.sealMessage(bindingHash);
            } else {
              // CredSSP v2-4: seal raw server public key
              pubKeyAuth = this.ntlm.sealMessage(serverPublicKey);
            }
          } else {
            this.log('NLA: WARNING - No peer certificate pubkey available for pubKeyAuth');
          }
        } else {
          this.log('NLA: WARNING - No TLS socket available for pubKeyAuth');
        }

        const tsReq = buildTsRequest(credsspVersion, authMsg, undefined, pubKeyAuth, clientNonce);
        this.transport.send(tsReq);
        this.nlaStep = 2;
      } else if (this.nlaStep === 2) {
        if (tsResp.pubKeyAuth) {
          const tsCredentials = this.buildTSCredentials();
          // Use NTLM SealMessage for credential encryption (seqNum continues from pubKeyAuth)
          const encCredentials = this.ntlm.sealMessage(tsCredentials);
          const tsReq = buildTsRequest(tsResp.version || 6, undefined, encCredentials);
          this.transport.send(tsReq);
        } else {
          this.logError('NLA: Server did NOT confirm pubKeyAuth — authentication likely failed');
          this.emit('error', new Error('NLA authentication failed: server rejected pubKeyAuth'));
          return;
        }

        // NLA done, proceed to MCS
        this.log('NLA: Complete, proceeding to MCS');
        this.secState.useTls = true;
        this.nlaStep = 3;
        this.startMCS();
      } else {
        this.logError(`NLA: Unexpected nlaStep=${this.nlaStep} with data`);
      }
    } catch (err) {
      this.logError('NLA error:', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private buildTSCredentials(): Buffer {
    const { domain, username, password } = this.config;
    const domBuf = Buffer.from(domain, 'utf16le');
    const userBuf = Buffer.from(username, 'utf16le');
    const passBuf = Buffer.from(password, 'utf16le');

    // TSPasswordCreds ::= SEQUENCE { [0] domainName, [1] userName, [2] password }
    const pwdCreds = asn1Sequence([
      asn1Constructed(0xA0, asn1OctetString(domBuf)),
      asn1Constructed(0xA1, asn1OctetString(userBuf)),
      asn1Constructed(0xA2, asn1OctetString(passBuf)),
    ]);

    // TSCredentials ::= SEQUENCE { [0] credType INTEGER 1, [1] credentials OCTET STRING }
    return asn1Sequence([
      asn1Constructed(0xA0, asn1Integer(1)),
      asn1Constructed(0xA1, asn1OctetString(pwdCreds)),
    ]);
  }

  // ===== MCS Connection Sequence =====

  private startMCS(): void {
    this.phase = 'mcs';
    this.log('Starting MCS Connect-Initial');

    // Build GCC client data
    const clientCore = protocol.buildClientCoreData(this.config, this.selectedProtocol);
    const clientSecurity = protocol.buildClientSecurityData(
      this.secState.useTls ? types.ENCRYPTION_FLAG_NONE : types.ENCRYPTION_FLAG_128BIT
    );
    const clientNetwork = protocol.buildClientNetworkData(this.channels);
    const clientData = Buffer.concat([clientCore, clientSecurity, clientNetwork]);
    this.log(`GCC client data: core=${clientCore.length}B, security=${clientSecurity.length}B, network=${clientNetwork.length}B (${this.channels.length} channels)`);

    // Build GCC Conference Create Request
    const gccRequest = protocol.buildGCCConferenceCreateRequest(clientData);

    // Build MCS Connect-Initial
    const mcsConnectInitial = protocol.buildMCSConnectInitial(gccRequest);

    // Wrap in X.224 Data
    const x224Data = protocol.buildX224Data(mcsConnectInitial);
    this.transport.sendTpkt(x224Data);
  }

  private async handleMCSPacket(data: Buffer): Promise<void> {
    const firstByte = data[0];

    // Check for MCS Connect-Response (BER: 0x7F66)
    if (firstByte === 0x7F && data.length > 1 && data[1] === 0x66) {
      this.log('Received MCS Connect-Response');
      const resp = protocol.parseMCSConnectResponse(data);
      if (resp.result !== 0) {
        this.logError(`MCS Connect failed with result: ${resp.result}`);
        this.emit('error', new Error(`MCS Connect failed with result: ${resp.result}`));
        return;
      }
      // Parse GCC and server data
      const gccData = protocol.parseGCCConferenceCreateResponse(resp.gccData);
      const serverData = protocol.parseServerGCCData(gccData);

      // Store server security data
      this.secState.encryptionMethod = serverData.security.encryptionMethod;
      this.secState.encryptionLevel = serverData.security.encryptionLevel;

      // Map channel IDs
      this.mcsChannelId = serverData.network.MCSChannelId || 1003;
      this.ioChannelId = this.mcsChannelId;
      for (let i = 0; i < serverData.network.channelIds.length && i < this.channels.length; i++) {
        this.channels[i].id = serverData.network.channelIds[i];
        this.channelMap.set(serverData.network.channelIds[i], this.channels[i].name);
      }

      // If standard RDP security, set up encryption keys
      if (!this.secState.useTls && serverData.security.encryptionLevel > 0) {
        if (serverData.security.serverRandom && serverData.security.serverCertificate) {
          this.serverPubKey = security.parseServerCertificate(serverData.security.serverCertificate);
          this.clientRandom = crypto.randomBytes(32);

          const keys = security.generateSessionKeys(
            this.clientRandom,
            serverData.security.serverRandom,
            serverData.security.encryptionMethod
          );
          this.secState.macKey = keys.macKey;
          this.secState.encryptKey = keys.encryptKey;
          this.secState.decryptKey = keys.decryptKey;
          this.secState.encryptRC4 = crypto.createCipheriv('rc4', keys.encryptKey, '');
          this.secState.decryptRC4 = crypto.createDecipheriv('rc4', keys.decryptKey, '');

          // RSA-encrypt the client random for Security Exchange PDU
          this.encryptedClientRandom = security.rsaEncrypt(
            this.clientRandom,
            this.serverPubKey.modulus,
            this.serverPubKey.exponent
          );
        } else {
          this.logError('Server security data missing serverRandom or serverCertificate');
        }
      }

      // Send Erect Domain + Attach User
      this.sendMCSWrapped(protocol.buildMCSErectDomainRequest());
      this.sendMCSWrapped(protocol.buildMCSAttachUserRequest());
      return;
    }

    // Check PER-encoded MCS PDU type
    const pduType = firstByte >> 2;

    if (pduType === types.MCSPDUType.ATTACH_USER_CONFIRM) {
      const confirm = protocol.parseMCSAttachUserConfirm(data);
      if (confirm.result !== 0) {
        this.logError(`MCS Attach User failed: result=${confirm.result}`);
        this.emit('error', new Error(`MCS Attach User failed: ${confirm.result}`));
        return;
      }
      this.userId = confirm.userId;

      // Join channels: user channel, I/O channel, and virtual channels
      const channelsToJoin = [this.userId, this.ioChannelId];
      for (const ch of this.channels) {
        if (ch.id) channelsToJoin.push(ch.id);
      }
      // Track ALL pending joins
      this.pendingChannelJoins.clear();
      for (const chId of channelsToJoin) {
        this.pendingChannelJoins.add(chId);
      }
      for (const chId of channelsToJoin) {
        this.sendMCSWrapped(protocol.buildMCSChannelJoinRequest(this.userId, chId));
      }
      return;
    }

    if (pduType === types.MCSPDUType.CHANNEL_JOIN_CONFIRM) {
      const confirm = protocol.parseMCSChannelJoinConfirm(data);
      if (confirm.result !== 0) {
        this.logError(`Channel join failed for ${confirm.channelId}: result=${confirm.result}`);
        this.emit('error', new Error(`Channel join failed for ${confirm.channelId}: ${confirm.result}`));
        return;
      }
      this.pendingChannelJoins.delete(confirm.channelId);

      // Only proceed to security phase after ALL channels are joined
      if (this.pendingChannelJoins.size === 0) {
        this.phase = 'security';
        this.sendSecurityExchangeAndInfo();
      }
      return;
    }

    if (pduType === types.MCSPDUType.DISCONNECT_PROVIDER_ULTIMATUM) {
      this.log('Received DisconnectProviderUltimatum during MCS');
      this.connected = false;
      this.emit('close');
      return;
    }

    // SendDataIndication during MCS (e.g. auto-detect) — delegate to data handler
    if (pduType === types.MCSPDUType.SEND_DATA_INDICATION) {
      this.log('Received SendDataIndication during MCS phase');
      await this.handleMCSData(data);
      return;
    }

    this.log(`Unhandled MCS PDU type: ${pduType}, firstByte=0x${firstByte.toString(16)}`);
  }

  private sendSecurityExchangeAndInfo(): void {
    if (!this.secState.useTls && this.secState.encryptionLevel > 0) {
      // Standard RDP: send Security Exchange PDU with encrypted client random
      if (this.encryptedClientRandom) {
        this.log(`Sending Security Exchange PDU (${this.encryptedClientRandom.length} bytes encrypted random)`);
        const secExchangePdu = security.buildSecurityExchangePDU(this.encryptedClientRandom);
        this.sendOnIOChannel(secExchangePdu);
      } else {
        this.logError('Cannot send Security Exchange: no encrypted client random');
        this.emit('error', new Error('Security Exchange failed: encryption not set up'));
        return;
      }
    }

    // Send Client Info PDU
    const infoPdu = security.buildClientInfoPDU(
      this.config.username,
      this.config.password,
      this.config.domain,
      this.secState
    );
    this.sendOnIOChannel(infoPdu);
    this.phase = 'licensing';
    this.log('Waiting for server license response...');
  }

  // ===== Data Phase =====

  private async handleMCSData(data: Buffer): Promise<void> {
    const sdi = protocol.parseMCSSendDataIndication(data);
    const channelId = sdi.channelId;

    // Check if this is a virtual channel
    const channelName = this.channelMap.get(channelId);
    if (channelName) {
      this.handleVirtualChannelData(channelName, sdi.payload);
      return;
    }

    // Log if data arrives on unknown channel (not I/O, not mapped VC)
    if (channelId !== this.ioChannelId) {
      this.log(`Data on unmapped channel ${channelId} (ioChannel=${this.ioChannelId}, ${sdi.payload.length} bytes)`);
    }

    // I/O channel data
    let payload = sdi.payload;

    // Handle security layer decryption for standard RDP security
    if (!this.secState.useTls && this.secState.encryptionLevel > 0) {
      if (payload.length < 4) {
        this.logError(`IO channel payload too short: ${payload.length} bytes`);
        return;
      }
      const dec = security.decryptPDU(this.secState, payload);
      payload = dec.payload;

      if (dec.flags & types.SEC_LICENSE_PKT) {
        this.handleLicensing(payload);
        return;
      }
    } else if (!this.licensingDone) {
      // TLS or no-encryption mode: licensing PDUs still have a 4-byte Basic Security Header
      // (MS-RDPBCGR §5.3.2: even ENCRYPTION_LEVEL_NONE includes SEC_LICENSE_PKT header)
      if (payload.length >= 4) {
        const flags = payload.readUInt32LE(0);
        if (flags & types.SEC_LICENSE_PKT) {
          this.log(`License PDU received (flags=0x${flags.toString(16)}, ${payload.length} bytes)`);
          this.handleLicensing(payload.subarray(4));
          return;
        }
        // If we haven't seen a license PDU yet but this doesn't have SEC_LICENSE_PKT,
        // it might be a Demand Active (meaning server skipped licensing)
        this.log(`First post-info PDU flags=0x${flags.toString(16)} — not a license PDU, assuming licensing done`);
        this.licensingDone = true;
        this.phase = 'active';
        // Fall through to processSharePDU with the raw payload (no sec header to strip)
      }
    }

    this.processSharePDU(payload);
  }

  private handleLicensing(data: Buffer): void {
    // License PDUs — parse and respond as needed (MS-RDPELE)
    if (data.length >= 4) {
      const msgType = data.readUInt8(0);
      const flags = data.readUInt8(1);
      const size = data.readUInt16LE(2);
      // 0xFF = ERROR_ALERT, 0x02 = NEW_LICENSE, 0x03 = UPGRADE_LICENSE — licensing complete
      if (msgType === 0xFF || msgType === 0x02 || msgType === 0x03) {
        this.licensingDone = true;
        this.phase = 'active';
        return;
      }

      // 0x01 = LICENSE_REQUEST — server wants us to present a license.
      // Respond with ERROR_ALERT(STATUS_VALID_CLIENT) to skip full license exchange.
      // Required by xrdp; Windows servers don't wait for a response.
      if (msgType === 0x01) {
        this.sendLicenseValidClient();
        // Don't mark licensing done yet — wait for server's final license PDU
        return;
      }

      // 0x02 = PLATFORM_CHALLENGE — respond with a minimal challenge response
      // (rare path; most servers accept the ERROR_ALERT shortcut above)
    } else {
      this.log(`License PDU too short (${data.length} bytes) — treating as complete`);
    }

    this.licensingDone = true;
    this.phase = 'active';
    this.log('Phase → active, waiting for Demand Active PDU');
  }

  private sendLicenseValidClient(): void {
    // Build ERROR_ALERT PDU with STATUS_VALID_CLIENT (MS-RDPELE §2.2.2.7.1)
    const w = new BufferWriter(20);

    // License preamble (4 bytes)
    w.writeUInt8(0xFF);    // bMsgType = ERROR_ALERT
    w.writeUInt8(0x03);    // flags = PREAMBLE_VERSION_3_0
    w.writeUInt16LE(16);   // wMsgSize = 16 (preamble + error info + blob header)

    // Licensing Error Message (dwErrorCode + dwStateTransition + bbErrorInfo)
    w.writeUInt32LE(0x07); // dwErrorCode = STATUS_VALID_CLIENT
    w.writeUInt32LE(0x02); // dwStateTransition = ST_NO_TRANSITION
    w.writeUInt16LE(0x00); // bbErrorInfo.wBlobType = BB_ANY_BLOB
    w.writeUInt16LE(0x00); // bbErrorInfo.wBlobLen = 0

    const licensePdu = w.toBuffer();

    // Wrap with SEC_LICENSE_PKT security header
    const secHdr = new BufferWriter(licensePdu.length + 4);
    secHdr.writeUInt32LE(types.SEC_LICENSE_PKT);
    secHdr.writeBuffer(licensePdu);

    this.sendOnIOChannel(secHdr.toBuffer());
  }

  private processSharePDU(data: Buffer): void {
    if (data.length < 6) {
      this.log(`Share PDU too short: ${data.length} bytes`);
      return;
    }

    const share = security.parseShareControlHeader(data);

    switch (share.pduType) {
      case types.PDUType.DEMAND_ACTIVE:
        this.handleDemandActive(share.payload);
        break;
      case types.PDUType.DATA:
        this.handleDataPDU(share.payload);
        break;
      case types.PDUType.DEACTIVATE_ALL:
        this.log('Received Deactivate All — waiting for re-activation');
        this.phase = 'active';
        break;
      default:
        this.log(`Unknown Share Control PDU type: 0x${share.pduType.toString(16)}`);
        break;
    }
  }

  private handleDemandActive(data: Buffer): void {
    const r = new BufferReader(data);
    this.shareId = r.readUInt32LE();
    const lengthSourceDescriptor = r.readUInt16LE();
    const lengthCombinedCapabilities = r.readUInt16LE();
    r.skip(lengthSourceDescriptor); // sourceDescriptor
    // Skip server capabilities for now
    r.skip(lengthCombinedCapabilities);

    this.sendConfirmActive();
    this.sendSynchronize();
    this.sendControlCooperate();
    this.sendControlRequestControl();
    this.sendFontList();

    this.phase = 'data';
    this.connected = true;
    this.log('Connection ready');
    this.emit('ready');
  }

  private sendConfirmActive(): void {
    const caps = this.buildCapabilities();
    const sourceDescriptor = Buffer.from('rdpea', 'ascii');

    const w = new BufferWriter(caps.length + sourceDescriptor.length + 16);
    w.writeUInt32LE(this.shareId);
    w.writeUInt16LE(0x03EA); // originatorId
    w.writeUInt16LE(sourceDescriptor.length);
    w.writeUInt16LE(caps.length);
    w.writeBuffer(sourceDescriptor);
    w.writeBuffer(caps);

    const confirmPDU = security.buildShareControlPDU(
      types.PDUType.CONFIRM_ACTIVE,
      this.userId + 1001,
      w.toBuffer()
    );
    this.sendOnIOChannel(this.wrapSecurityHeader(confirmPDU));
  }

  private buildCapabilities(): Buffer {
    const capSets: Buffer[] = [];
    let numCaps = 0;

    // General capability
    const gen = new BufferWriter(32);
    gen.writeUInt16LE(types.CapabilitySetType.GENERAL);
    gen.writeUInt16LE(24);
    gen.writeUInt16LE(1); // osMajorType (Windows)
    gen.writeUInt16LE(3); // osMinorType
    gen.writeUInt16LE(0x0200); // protocolVersion
    gen.writeUInt16LE(0); // pad2octetsA
    gen.writeUInt16LE(0); // generalCompressionTypes
    gen.writeUInt16LE(0x041D); // extraFlags (FASTPATH_OUTPUT | NO_BITMAP_COMPRESSION_HDR | LONG_CREDENTIALS | AUTORECONNECT)
    gen.writeUInt16LE(0); // updateCapabilityFlag
    gen.writeUInt16LE(0); // remoteUnshareFlag
    gen.writeUInt16LE(0); // generalCompressionLevel
    gen.writeUInt8(0);    // refreshRectSupport
    gen.writeUInt8(0);    // suppressOutputSupport
    capSets.push(gen.toBuffer()); numCaps++;

    // Bitmap capability
    const bmp = new BufferWriter(32);
    bmp.writeUInt16LE(types.CapabilitySetType.BITMAP);
    bmp.writeUInt16LE(28);
    bmp.writeUInt16LE(this.config.colorDepth); // preferredBitsPerPixel
    bmp.writeUInt16LE(1); // receive1BitPerPixel
    bmp.writeUInt16LE(1); // receive4BitsPerPixel
    bmp.writeUInt16LE(1); // receive8BitsPerPixel
    bmp.writeUInt16LE(this.config.width);  // desktopWidth
    bmp.writeUInt16LE(this.config.height); // desktopHeight
    bmp.writeUInt16LE(0); // pad2octets
    bmp.writeUInt16LE(1); // desktopResizeFlag
    bmp.writeUInt16LE(1); // bitmapCompressionFlag
    bmp.writeUInt8(0);    // highColorFlags
    bmp.writeUInt8(1);    // drawingFlags
    bmp.writeUInt16LE(1); // multipleRectangleSupport
    bmp.writeUInt16LE(0); // pad2octetsB
    capSets.push(bmp.toBuffer()); numCaps++;

    // Order capability (minimal)
    const ord = new BufferWriter(88);
    ord.writeUInt16LE(types.CapabilitySetType.ORDER);
    ord.writeUInt16LE(88);
    ord.writePad(16); // terminalDescriptor
    ord.writeUInt32LE(0); // pad4octetsA
    ord.writeUInt16LE(1); // desktopSaveXGranularity
    ord.writeUInt16LE(20); // desktopSaveYGranularity
    ord.writeUInt16LE(0); // pad2octetsA
    ord.writeUInt16LE(1); // maximumOrderLevel
    ord.writeUInt16LE(0); // numberFonts
    ord.writeUInt16LE(0x002A); // orderFlags
    ord.writePad(32); // orderSupport (all zeros = bitmap only)
    ord.writeUInt16LE(0); // textFlags
    ord.writeUInt16LE(0); // orderSupportExFlags
    ord.writeUInt32LE(0); // pad4octetsB
    ord.writeUInt32LE(480 * 480); // desktopSaveSize
    ord.writeUInt16LE(0); // pad2octetsC
    ord.writeUInt16LE(0); // pad2octetsD
    ord.writeUInt16LE(0); // textANSICodePage
    ord.writeUInt16LE(0); // pad2octetsE
    capSets.push(ord.toBuffer()); numCaps++;

    // Input capability
    const inp = new BufferWriter(92);
    inp.writeUInt16LE(types.CapabilitySetType.INPUT);
    inp.writeUInt16LE(88);
    inp.writeUInt16LE(0x0035); // inputFlags (SCANCODES | MOUSEX | FASTPATH_INPUT2)
    inp.writeUInt16LE(0); // pad2octetsA
    inp.writeUInt32LE(0x00000409); // keyboardLayout
    inp.writeUInt32LE(4); // keyboardType
    inp.writeUInt32LE(0); // keyboardSubType
    inp.writeUInt32LE(12); // keyboardFunctionKey
    inp.writePad(64); // imeFileName
    capSets.push(inp.toBuffer()); numCaps++;

    // Sound capability (for audio)
    const snd = new BufferWriter(12);
    snd.writeUInt16LE(types.CapabilitySetType.SOUND);
    snd.writeUInt16LE(8);
    snd.writeUInt16LE(0x0001); // soundFlags = BEEPS
    snd.writeUInt16LE(0);
    capSets.push(snd.toBuffer()); numCaps++;

    // Virtual Channel capability
    const vc = new BufferWriter(12);
    vc.writeUInt16LE(types.CapabilitySetType.VIRTUAL_CHANNEL);
    vc.writeUInt16LE(12);
    vc.writeUInt32LE(0); // flags (VCCAPS_NO_COMPR)
    vc.writeUInt32LE(1600); // VCChunkSize
    capSets.push(vc.toBuffer()); numCaps++;

    // Combine
    const allCaps = Buffer.concat(capSets);
    const w = new BufferWriter(allCaps.length + 4);
    w.writeUInt16LE(numCaps);
    w.writeUInt16LE(0); // pad
    w.writeBuffer(allCaps);
    return w.toBuffer();
  }

  private sendSynchronize(): void {
    const w = new BufferWriter(4);
    w.writeUInt16LE(1); // messageType = SYNCMSGTYPE_SYNC
    w.writeUInt16LE(this.userId);
    const pdu = this.buildDataPDU(types.PDUType2.SYNCHRONIZE, w.toBuffer());
    this.sendOnIOChannel(pdu);
  }

  private sendControlCooperate(): void {
    const w = new BufferWriter(12);
    w.writeUInt16LE(types.CTRLACTION_COOPERATE);
    w.writeUInt16LE(0); // grantId
    w.writeUInt32LE(0); // controlId
    const pdu = this.buildDataPDU(types.PDUType2.CONTROL, w.toBuffer());
    this.sendOnIOChannel(pdu);
  }

  private sendControlRequestControl(): void {
    const w = new BufferWriter(12);
    w.writeUInt16LE(types.CTRLACTION_REQUEST_CONTROL);
    w.writeUInt16LE(0);
    w.writeUInt32LE(0);
    const pdu = this.buildDataPDU(types.PDUType2.CONTROL, w.toBuffer());
    this.sendOnIOChannel(pdu);
  }

  private sendFontList(): void {
    const w = new BufferWriter(8);
    w.writeUInt16LE(0); // numberFonts
    w.writeUInt16LE(0); // totalNumFonts
    w.writeUInt16LE(0x0003); // listFlags (FONTLIST_FIRST | FONTLIST_LAST)
    w.writeUInt16LE(0x0032); // entrySize
    const pdu = this.buildDataPDU(types.PDUType2.FONTLIST, w.toBuffer());
    this.sendOnIOChannel(pdu);
  }

  private handleDataPDU(data: Buffer): void {
    const shareData = security.parseShareDataHeader(data);

    switch (shareData.pduType2) {
      case types.PDUType2.UPDATE:
        this.handleUpdatePDU(shareData.payload);
        break;
      case types.PDUType2.SET_ERROR_INFO:
        this.handleErrorInfo(shareData.payload);
        break;
      case types.PDUType2.SAVE_SESSION_INFO:
        this.log('Received Save Session Info');
        break;
      case types.PDUType2.FONTMAP:
        this.log('Connection finalize complete');
        break;
      case types.PDUType2.CONTROL:
      case types.PDUType2.SYNCHRONIZE:
        break;
      default:
        break;
    }
  }

  private handleUpdatePDU(data: Buffer): void {
    const r = new BufferReader(data);
    const updateType = r.readUInt16LE();

    if (updateType === types.UpdateType.BITMAP) {
      const rects = bitmap.parseBitmapUpdateData(data);
      const processedRects = rects.map(rect => {
        let pixelData: Buffer;
        const bw = rect.bitmapWidth, bh = rect.bitmapHeight;
        if (rect.isCompressed) {
          const decompressed = bitmap.decompressBitmap(rect.data, bw, bh, rect.bitsPerPixel);
          pixelData = bitmap.bitmapToRGBA(decompressed, rect.width, rect.height, rect.bitsPerPixel, bw, bh);
        } else {
          pixelData = bitmap.bitmapToRGBA(rect.data, rect.width, rect.height, rect.bitsPerPixel, bw, bh);
        }
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, data: pixelData };
      });
      this.emit('bitmap', processedRects);
    }
  }

  private handleErrorInfo(data: Buffer): void {
    const r = new BufferReader(data);
    const errorInfo = r.readUInt32LE();
    if (errorInfo !== 0) {
      this.logError(`Server error info: 0x${errorInfo.toString(16)}`);
      this.emit('error', new Error(`RDP Error: 0x${errorInfo.toString(16)}`));
    }
  }

  private onFastPath(data: Buffer): void {
    try {
      const r = new BufferReader(data);
      const header = r.readUInt8();
      const action = header & 0x03;

      // Read length
      let length: number;
      const byte2 = r.readUInt8();
      if (byte2 & 0x80) {
        length = ((byte2 & 0x7F) << 8) | r.readUInt8();
      } else {
        length = byte2;
      }

      // Decrypt if needed
      let payload: Buffer;
      if (!this.secState.useTls && (header & 0x80)) {
        // Encrypted fast-path
        r.skip(8); // MAC
        payload = this.secState.decryptRC4 ? this.secState.decryptRC4.update(r.readBytes(r.remaining)) : r.readBytes(r.remaining);
        this.secState.decryptCount++;
      } else {
        payload = r.readBytes(r.remaining);
      }

      // Process fast-path update PDUs
      this.processFastPathUpdates(payload);
    } catch (err) {
      this.logError('Fast-path parse error (non-fatal):', err);
    }
  }

  private processFastPathUpdates(data: Buffer): void {
    const r = new BufferReader(data);
    while (r.remaining > 0) {
      const updateHeader = r.readUInt8();
      const updateCode = updateHeader & 0x0F;
      const fragmentation = (updateHeader >> 4) & 0x03;
      const compression = (updateHeader >> 6) & 0x03;

      let size: number;
      if (r.remaining < 2) break;
      size = r.readUInt16LE();

      if (r.remaining < size) break;
      const updateData = r.readBytes(size);

      if (updateCode === 0x00) {
        // FASTPATH_UPDATETYPE_ORDERS
      } else if (updateCode === 0x01) {
        // FASTPATH_UPDATETYPE_BITMAP
        const rects = bitmap.parseBitmapUpdateData(updateData);
        const processedRects = rects.map(rect => {
          let pixelData: Buffer;
          const bw = rect.bitmapWidth, bh = rect.bitmapHeight;
          if (rect.isCompressed) {
            const decompressed = bitmap.decompressBitmap(rect.data, bw, bh, rect.bitsPerPixel);
            pixelData = bitmap.bitmapToRGBA(decompressed, rect.width, rect.height, rect.bitsPerPixel, bw, bh);
          } else {
            pixelData = bitmap.bitmapToRGBA(rect.data, rect.width, rect.height, rect.bitsPerPixel, bw, bh);
          }
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, data: pixelData };
        });
        this.emit('bitmap', processedRects);
      } else if (updateCode === 0x04) {
        // FASTPATH_UPDATETYPE_POINTER_HIDDEN
      } else if (updateCode === 0x05) {
        // FASTPATH_UPDATETYPE_POINTER_DEFAULT
      }
    }
  }

  // ===== Virtual Channel Handling =====

  private vcBuffers: Map<string, Buffer[]> = new Map();

  private handleVirtualChannelData(channelName: string, data: Buffer): void {
    // Virtual channel PDU header (8 bytes)
    const r = new BufferReader(data);
    if (r.remaining < 8) return;
    const totalLength = r.readUInt32LE();
    const flags = r.readUInt32LE();
    const chunkData = r.readBytes(r.remaining);

    const isFirst = !!(flags & types.CHANNEL_FLAG_FIRST);
    const isLast = !!(flags & types.CHANNEL_FLAG_LAST);

    // Reassemble multi-chunk VC data
    let channelData: Buffer;
    if (isFirst && isLast) {
      // Single chunk — most common case
      channelData = chunkData;
      this.vcBuffers.delete(channelName);
    } else if (isFirst) {
      // First of multiple chunks
      this.vcBuffers.set(channelName, [chunkData]);
      return;
    } else if (isLast) {
      // Last chunk — reassemble
      const chunks = this.vcBuffers.get(channelName) || [];
      chunks.push(chunkData);
      channelData = Buffer.concat(chunks);
      this.vcBuffers.delete(channelName);
    } else {
      // Middle chunk
      const chunks = this.vcBuffers.get(channelName) || [];
      chunks.push(chunkData);
      this.vcBuffers.set(channelName, chunks);
      return;
    }

    if (channelName === types.RDPSND_CHANNEL_NAME) {
      const result = audio.processRdpSndData(channelData, this.audioState);
      if (result.response) {
        this.sendVirtualChannelData(channelName, result.response);
      }
      if (result.audioData) {
        this.emit('audio', result.audioData.pcmData, result.audioData.format);
      }
    } else if (channelName === types.CLIPRDR_CHANNEL_NAME) {
      this.handleClipRdrData(channelData);
    } else if (channelName === types.RDPDR_CHANNEL_NAME) {
      this.handleRdpDrData(channelData);
    }
  }

  // ===== CLIPRDR (Clipboard Redirection) =====
  private handleClipRdrData(data: Buffer): void {
    const result = clipboard.processClipData(data, this.clipState);
    for (const resp of result.responses) {
      this.sendVirtualChannelData(types.CLIPRDR_CHANNEL_NAME, resp);
    }
    if (result.remoteText !== undefined) {
      this.emit('clipboard', result.remoteText);
    }
  }

  // Called by main process when local clipboard text changes
  setClipboardText(text: string): void {
    if (!this.connected || !this.clipState.serverReady) return;
    this.clipState.pendingClientText = text;
    const formatList = clipboard.buildClientFormatList(this.clipState);
    this.sendVirtualChannelData(types.CLIPRDR_CHANNEL_NAME, formatList);
  }

  // Minimal RDPDR (Device Redirection) handshake — required by Windows before RDPSND
  private rdpdrInitDone = false;
  private handleRdpDrData(data: Buffer): void {
    if (data.length < 4) return;
    const component = data.readUInt16LE(0);
    const packetId = data.readUInt16LE(2);

    // RDPDR_CTYP_CORE = 0x4472
    if (component !== 0x4472) return;

    if (packetId === 0x496E && !this.rdpdrInitDone) {
      // PAKID_CORE_SERVER_ANNOUNCE (Server Announce Request)
      // Extract server version and clientId
      const serverMajor = data.length >= 6 ? data.readUInt16LE(4) : 1;
      const serverMinor = data.length >= 8 ? data.readUInt16LE(6) : 0;
      const clientId = data.length >= 12 ? data.readUInt32LE(8) : 0;

      // 1. Client Announce Reply
      const reply = new BufferWriter(24);
      reply.writeUInt16LE(0x4472); // RDPDR_CTYP_CORE
      reply.writeUInt16LE(0x4343); // PAKID_CORE_CLIENTID_CONFIRM
      reply.writeUInt16LE(1);      // versionMajor
      reply.writeUInt16LE(serverMinor >= 12 ? 12 : serverMinor); // versionMinor
      reply.writeUInt32LE(clientId);
      this.sendVirtualChannelData(types.RDPDR_CHANNEL_NAME, reply.toBuffer());

      // 2. Client Name Request
      const computerName = Buffer.from('RDPea\0', 'utf16le');
      const nameReq = new BufferWriter(16 + computerName.length);
      nameReq.writeUInt16LE(0x4472); // RDPDR_CTYP_CORE
      nameReq.writeUInt16LE(0x434E); // PAKID_CORE_CLIENT_NAME
      nameReq.writeUInt32LE(1);      // unicodeFlag
      nameReq.writeUInt32LE(0);      // codePage
      nameReq.writeUInt32LE(computerName.length);
      nameReq.writeBuffer(computerName);
      this.sendVirtualChannelData(types.RDPDR_CHANNEL_NAME, nameReq.toBuffer());

      this.rdpdrInitDone = true;
    } else if (packetId === 0x5350) {
      // PAKID_CORE_SERVER_CAPABILITY (Server Core Capability Request)
      // Respond with Client Core Capability Response — no device capabilities
      const capResp = new BufferWriter(16);
      capResp.writeUInt16LE(0x4472); // RDPDR_CTYP_CORE
      capResp.writeUInt16LE(0x4350); // PAKID_CORE_CLIENT_CAPABILITY
      capResp.writeUInt16LE(0);      // numCapabilities = 0
      capResp.writeUInt16LE(0);      // padding
      this.sendVirtualChannelData(types.RDPDR_CHANNEL_NAME, capResp.toBuffer());

      // Also send empty device list (Client Device List Announce)
      const devList = new BufferWriter(8);
      devList.writeUInt16LE(0x4472); // RDPDR_CTYP_CORE
      devList.writeUInt16LE(0x4441); // PAKID_CORE_DEVICELIST_ANNOUNCE
      devList.writeUInt32LE(0);      // deviceCount = 0
      this.sendVirtualChannelData(types.RDPDR_CHANNEL_NAME, devList.toBuffer());
    }
  }

  private sendVirtualChannelData(channelName: string, data: Buffer): void {
    const channel = this.channels.find(c => c.name === channelName);
    if (!channel || !channel.id) return;

    const w = new BufferWriter(data.length + 8);
    w.writeUInt32LE(data.length); // totalDataLength
    w.writeUInt32LE(types.CHANNEL_FLAG_FIRST | types.CHANNEL_FLAG_LAST | types.CHANNEL_FLAG_SHOW_PROTOCOL);
    w.writeBuffer(data);

    const mcsData = protocol.buildMCSSendDataRequest(this.userId, channel.id, w.toBuffer());
    const x224Data = protocol.buildX224Data(mcsData);
    this.transport.sendTpkt(x224Data);
  }

  // ===== Input Sending =====

  sendKeyboard(type: 'keydown' | 'keyup', scanCode: number, extended: boolean): void {
    if (!this.connected) return;
    const evt: input.KeyboardEvent = { type, scanCode, extended };
    const inputData = input.buildInputPDU([evt], this.shareId);
    const pdu = this.buildDataPDU(types.PDUType2.INPUT, inputData);
    this.sendOnIOChannel(pdu);
  }

  sendMouse(type: 'move' | 'down' | 'up' | 'wheel', x: number, y: number, button?: 'left' | 'right' | 'middle', wheelDelta?: number): void {
    if (!this.connected) return;
    const evt: input.MouseEvent = { type, x, y, button, wheelDelta };
    const inputData = input.buildInputPDU([evt], this.shareId);
    const pdu = this.buildDataPDU(types.PDUType2.INPUT, inputData);
    this.sendOnIOChannel(pdu);
  }

  // ===== Helpers =====

  private buildDataPDU(pduType2: number, payload: Buffer): Buffer {
    const shareData = security.buildShareDataPDU(this.shareId, pduType2, payload);
    const sharePDU = security.buildShareControlPDU(types.PDUType.DATA, this.userId + 1001, shareData);
    return this.wrapSecurityHeader(sharePDU);
  }

  private wrapSecurityHeader(data: Buffer): Buffer {
    if (this.secState.useTls) {
      // TLS mode: no security header needed for regular data
      return data;
    }
    if (this.secState.encryptRC4 && this.secState.macKey) {
      return security.encryptPDU(this.secState, 0, data);
    }
    return data;
  }

  private sendOnIOChannel(data: Buffer): void {
    const mcsData = protocol.buildMCSSendDataRequest(this.userId, this.ioChannelId, data);
    const x224Data = protocol.buildX224Data(mcsData);
    this.transport.sendTpkt(x224Data);
  }

  private sendMCSWrapped(mcsData: Buffer): void {
    const x224Data = protocol.buildX224Data(mcsData);
    this.transport.sendTpkt(x224Data);
  }

  disconnect(): void {
    this.connected = false;
    this.transport.close();
    // 'close' event emitted by transport close handler
  }

  isConnected(): boolean {
    return this.connected;
  }
}
