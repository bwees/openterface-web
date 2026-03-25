/**
 * WebSerial connection manager for Openterface KVM devices.
 * Handles port opening, reading responses, and writing command frames.
 */

import { parseResponse, type DeviceInfo, parseDeviceInfo, CMD } from './protocol';

const BAUD_RATE = 115200;

export class SerialConnection {
  port: SerialPort | null = null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readLoopActive = false;
  private rxBuffer = new Uint8Array(0);

  onResponse:
    | ((resp: { addr: number; cmd: number; isAck: boolean; data: Uint8Array }) => void)
    | null = null;
  onDeviceInfo: ((info: DeviceInfo) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  get isConnected(): boolean {
    return this.port !== null && this.port.readable !== null;
  }

  async connect(): Promise<void> {
    if (!('serial' in navigator)) {
      throw new Error('WebSerial is not supported in this browser. Use Chrome or Edge.');
    }

    const serialOpts: SerialOptions = {
      baudRate: BAUD_RATE,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    };

    // Try previously authorized ports first to skip browser prompt
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) {
        this.port = ports[0];
        await this.port.open(serialOpts);
      }
    } catch {
      this.port = null;
    }

    // Fall back to browser port picker
    if (!this.port) {
      this.port = await navigator.serial.requestPort();
      await this.port.open(serialOpts);
    }

    // Acquire a persistent writer — concurrent write() calls queue automatically
    if (this.port.writable) {
      this.writer = this.port.writable.getWriter();
    }

    this.port.addEventListener('disconnect', () => {
      this.readLoopActive = false;
      this.writer = null;
      this.port = null;
      this.reader = null;
      this.onDisconnect?.();
    });

    this.startReadLoop();
  }

  async disconnect(): Promise<void> {
    this.readLoopActive = false;
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch {
        // ignore
      }
      this.writer = null;
    }
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // ignore
      }
      this.reader = null;
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch {
        // ignore
      }
      this.port = null;
    }
    this.onDisconnect?.();
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('Serial port is not writable');
    }
    await this.writer.write(data);
  }

  private startReadLoop(): void {
    if (!this.port?.readable) return;

    this.readLoopActive = true;
    this.reader = this.port.readable.getReader();

    const loop = async () => {
      try {
        while (this.readLoopActive && this.reader) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.processIncoming(value);
        }
      } catch {
        // Port disconnected or read error
      } finally {
        this.reader?.releaseLock();
        this.reader = null;
      }
    };

    loop();
  }

  private processIncoming(chunk: Uint8Array): void {
    // Append to buffer
    const newBuf = new Uint8Array(this.rxBuffer.length + chunk.length);
    newBuf.set(this.rxBuffer);
    newBuf.set(chunk, this.rxBuffer.length);
    this.rxBuffer = newBuf;

    // Try to parse frames
    while (this.rxBuffer.length >= 6) {
      // Look for frame header
      if (this.rxBuffer[0] !== 0x57 || this.rxBuffer[1] !== 0xab) {
        // Skip one byte
        this.rxBuffer = this.rxBuffer.slice(1);
        continue;
      }

      const dataLen = this.rxBuffer[4];
      const frameLen = 5 + dataLen + 1;

      if (this.rxBuffer.length < frameLen) {
        break; // Wait for more data
      }

      const frame = this.rxBuffer.slice(0, frameLen);
      this.rxBuffer = this.rxBuffer.slice(frameLen);

      const resp = parseResponse(frame);
      if (resp) {
        this.onResponse?.(resp);

        // Auto-parse device info
        if (resp.cmd === CMD.GET_INFO && resp.isAck) {
          const info = parseDeviceInfo(resp.data);
          if (info) this.onDeviceInfo?.(info);
        }
      }
    }
  }
}
