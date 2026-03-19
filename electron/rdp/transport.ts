// TCP/TLS transport layer for RDP protocol
import * as net from 'net';
import * as tls from 'tls';
import { EventEmitter } from 'events';

export class RdpTransport extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private rawSocket: net.Socket | null = null;
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private tlsSocket: tls.TLSSocket | null = null;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(host: string, port: number): Promise<void> {
    console.log(`[RDP:Transport] Connecting to ${host}:${port}`);

    // Happy-eyeballs: try default (may be IPv6) with a short timeout,
    // then fall back to explicit IPv4 if it fails or takes too long.
    const tryConnect = (family?: 4 | 6): Promise<net.Socket> => {
      return new Promise((resolve, reject) => {
        const opts: net.NetConnectOpts = { host, port };
        if (family) (opts as any).family = family;
        const sock = net.createConnection(opts, () => resolve(sock));
        sock.once('error', (err: Error) => {
          sock.destroy();
          reject(err);
        });
      });
    };

    let socket: net.Socket;
    try {
      // Race default connect against a 2-second timeout
      socket = await Promise.race([
        tryConnect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout (IPv6?)')), 2000)
        ),
      ]);
    } catch (firstErr) {
      console.warn(`[RDP:Transport] Default connect failed (${(firstErr as Error).message}), retrying IPv4…`);
      try {
        socket = await tryConnect(4);
      } catch (v4Err) {
        const err = v4Err as Error;
        console.error(`[RDP:Transport] IPv4 fallback also failed: ${err.message}`);
        this.emit('error', err);
        throw err;
      }
    }

    this._connected = true;
    console.log(`[RDP:Transport] TCP connected to ${host}:${port}`);

    socket.on('data', (data: Buffer) => this.onData(data));
    socket.on('error', (err: Error) => {
      console.error(`[RDP:Transport] Socket error: ${err.message}`);
      this._connected = false;
      this.emit('error', err);
    });
    socket.on('close', () => {
      this._connected = false;
      this.emit('close');
    });

    this.socket = socket;
    this.rawSocket = socket;
    this.emit('connect');
  }

  // Upgrade the current TCP connection to TLS
  async upgradeToTls(host: string): Promise<void> {
    if (!this.socket || this.socket instanceof tls.TLSSocket) {
      throw new Error('Cannot upgrade: no raw socket or already TLS');
    }

    return new Promise((resolve, reject) => {
      const tlsOptions: tls.ConnectionOptions = {
        socket: this.socket as net.Socket,
        servername: host,
        rejectUnauthorized: false, // RDP servers often use self-signed certs
        checkServerIdentity: () => undefined, // Skip all server identity checks
        minVersion: 'TLSv1' as tls.SecureVersion,
        maxVersion: 'TLSv1.2' as tls.SecureVersion, // TLS 1.3 always uses ECDHE → needs digitalSignature
        // RSA key-exchange ciphers ONLY — RDP server certs typically only have
        // keyEncipherment usage; ECDHE suites need digitalSignature which triggers
        // BoringSSL's KEY_USAGE_BIT_INCORRECT error in Electron
        ciphers: [
          'AES256-GCM-SHA384',
          'AES128-GCM-SHA256',
          'AES256-SHA256',
          'AES128-SHA256',
          'AES256-SHA',
          'AES128-SHA',
        ].join(':'),
      };

      const tlsSocket = tls.connect(tlsOptions, () => {
        // Remove old raw socket listeners to prevent double-fire
        if (this.rawSocket) {
          this.rawSocket.removeAllListeners('data');
          this.rawSocket.removeAllListeners('close');
          this.rawSocket.removeAllListeners('error');
        }
        this.tlsSocket = tlsSocket;
        this.socket = tlsSocket;
        this.emit('tlsconnect');
        resolve();
      });

      tlsSocket.on('data', (data: Buffer) => this.onData(data));
      tlsSocket.on('error', (err: Error) => {
        console.error(`[RDP:Transport] TLS error: ${err.message}`);
        this.emit('error', err);
        reject(err);
      });
      tlsSocket.on('close', () => {
        this._connected = false;
        this.emit('close');
      });
    });
  }

  private onData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
    this.processBuffer();
  }

  private processBuffer(): void {
    // Process complete TPKT packets
    while (this.receiveBuffer.length >= 4) {
      const version = this.receiveBuffer.readUInt8(0);

      if (version === 3) {
        // TPKT packet
        const length = this.receiveBuffer.readUInt16BE(2);
        if (this.receiveBuffer.length < length) break; // incomplete

        const packet = this.receiveBuffer.subarray(0, length);
        this.receiveBuffer = this.receiveBuffer.subarray(length);

        // Strip TPKT header, emit X.224 data
        const x224Data = packet.subarray(4);
        this.emit('packet', x224Data);
      } else if (version === 0x30) {
        // CredSSP/ASN.1 packet - read the BER length
        if (this.receiveBuffer.length < 2) break;
        let totalLen: number;
        let headerLen: number;

        const lenByte = this.receiveBuffer.readUInt8(1);
        if (lenByte < 0x80) {
          totalLen = lenByte + 2;
          headerLen = 2;
        } else if (lenByte === 0x81) {
          if (this.receiveBuffer.length < 3) break;
          totalLen = this.receiveBuffer.readUInt8(2) + 3;
          headerLen = 3;
        } else if (lenByte === 0x82) {
          if (this.receiveBuffer.length < 4) break;
          totalLen = this.receiveBuffer.readUInt16BE(2) + 4;
          headerLen = 4;
        } else {
          this.emit('error', new Error(`Invalid ASN.1 length: 0x${lenByte.toString(16)}`));
          return;
        }

        if (this.receiveBuffer.length < totalLen) break;

        const packet = this.receiveBuffer.subarray(0, totalLen);
        this.receiveBuffer = this.receiveBuffer.subarray(totalLen);
        this.emit('credssp', packet);
      } else {
        // Fast-path packet (version byte is the action/flags)
        if (this.receiveBuffer.length < 2) break;
        let length: number;
        const byte2 = this.receiveBuffer.readUInt8(1);
        if (byte2 & 0x80) {
          if (this.receiveBuffer.length < 3) break;
          length = ((byte2 & 0x7F) << 8) | this.receiveBuffer.readUInt8(2);
        } else {
          length = byte2;
        }

        if (length === 0 || this.receiveBuffer.length < length) break;

        const packet = this.receiveBuffer.subarray(0, length);
        this.receiveBuffer = this.receiveBuffer.subarray(length);
        // console.log(`[RDP:Transport] Fast-path packet: ${length} bytes`);
        this.emit('fastpath', packet);
      }
    }
  }

  send(data: Buffer): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Socket not connected');
    }
    this.socket.write(data);
  }

  // Send raw data with TPKT header
  sendTpkt(x224Data: Buffer): void {
    const tpkt = Buffer.alloc(4 + x224Data.length);
    tpkt.writeUInt8(3, 0);                      // version
    tpkt.writeUInt8(0, 1);                      // reserved
    tpkt.writeUInt16BE(4 + x224Data.length, 2); // length
    x224Data.copy(tpkt, 4);
    this.send(tpkt);
  }

  close(): void {
    this._connected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.receiveBuffer = Buffer.alloc(0);
  }

  // Get the TLS socket for CredSSP public key extraction
  getTlsSocket(): tls.TLSSocket | null {
    return this.tlsSocket;
  }
}
