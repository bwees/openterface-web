/**
 * CH9329-compatible serial protocol for Openterface KVM devices.
 *
 * Frame format:
 *   HEAD1(0x57) HEAD2(0xAB) ADDR CMD DATA_LEN DATA[0..N] CHECKSUM
 *
 * Checksum = sum of all preceding bytes (uint8 truncation).
 */

// Frame header bytes
const HEAD1 = 0x57;
const HEAD2 = 0xab;

// Command codes
export const CMD = {
  GET_INFO: 0x01,
  SEND_KB_GENERAL_DATA: 0x02,
  SEND_KB_MEDIA_DATA: 0x03,
  SEND_MS_ABS_DATA: 0x04,
  SEND_MS_REL_DATA: 0x05,
  GET_PARA_CFG: 0x08,
  SD_SWITCH: 0x17,
  DS18B20_GET_TEMP: 0x18,
} as const;

// Response status codes
export const STATUS = {
  SUCCESS: 0x00,
  ERR_TIMEOUT: 0xe1,
  ERR_HEADER: 0xe2,
  ERR_CMD: 0xe3,
  ERR_CHECKSUM: 0xe4,
  ERR_PARAM: 0xe5,
  ERR_FRAME: 0xe6,
} as const;

// Device versions
export const DEVICE_VERSION = {
  KVM_GO: 0x01,
  MINI_KVM: 0x02,
} as const;

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xff;
  }
  return sum;
}

/** Build a CH9329-compatible frame. */
export function buildFrame(addr: number, cmd: number, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + data.length + 1);
  frame[0] = HEAD1;
  frame[1] = HEAD2;
  frame[2] = addr;
  frame[3] = cmd;
  frame[4] = data.length;
  frame.set(data, 5);
  frame[frame.length - 1] = checksum(frame.subarray(0, frame.length - 1));
  return frame;
}

/** Build a keyboard HID report frame (CMD 0x02). 8-byte HID report. */
export function buildKeyboardFrame(modifier: number, keycodes: number[], addr = 0x00): Uint8Array {
  const data = new Uint8Array(8);
  data[0] = modifier;
  data[1] = 0x00; // reserved
  for (let i = 0; i < Math.min(keycodes.length, 6); i++) {
    data[2 + i] = keycodes[i];
  }
  return buildFrame(addr, CMD.SEND_KB_GENERAL_DATA, data);
}

/** Build a key release frame (all zeros). */
export function buildKeyReleaseFrame(addr = 0x00): Uint8Array {
  return buildKeyboardFrame(0, [], addr);
}

/**
 * Build an absolute mouse frame (CMD 0x04).
 * x, y are in range 0-4096 (firmware shifts << 3 to get 0-32767).
 * data[0] = 0x02 (Report ID for absolute mouse, matching macOS client).
 */
export function buildAbsoluteMouseFrame(
  buttons: number,
  x: number,
  y: number,
  wheel: number,
  addr = 0x00,
): Uint8Array {
  const data = new Uint8Array(7);
  data[0] = 0x02; // Report ID for absolute mouse
  data[1] = buttons & 0x07;
  data[2] = x & 0xff;
  data[3] = (x >> 8) & 0xff;
  data[4] = y & 0xff;
  data[5] = (y >> 8) & 0xff;
  data[6] = wheel & 0xff;
  return buildFrame(addr, CMD.SEND_MS_ABS_DATA, data);
}

/**
 * Build a relative mouse frame (CMD 0x05).
 * dx, dy, wheel are signed int8 (-127 to 127).
 * data[0] = 0x01 (Report ID for relative mouse, matching macOS client).
 */
export function buildRelativeMouseFrame(
  buttons: number,
  dx: number,
  dy: number,
  wheel: number,
  addr = 0x00,
): Uint8Array {
  const data = new Uint8Array(5);
  data[0] = 0x01; // Report ID for relative mouse
  data[1] = buttons & 0x07;
  data[2] = dx & 0xff;
  data[3] = dy & 0xff;
  data[4] = wheel & 0xff;
  return buildFrame(addr, CMD.SEND_MS_REL_DATA, data);
}

/** Build a get-info request frame (CMD 0x01). */
export function buildGetInfoFrame(addr = 0x00): Uint8Array {
  return buildFrame(addr, CMD.GET_INFO, new Uint8Array(0));
}

export interface DeviceInfo {
  version: number;
  usbConnected: boolean;
  ledStatus: number;
  versionName: string;
}

/** Parse a response frame from the device. Returns null if invalid. */
export function parseResponse(buf: Uint8Array): {
  addr: number;
  cmd: number;
  isAck: boolean;
  data: Uint8Array;
} | null {
  if (buf.length < 6) return null;
  if (buf[0] !== HEAD1 || buf[1] !== HEAD2) return null;

  const addr = buf[2];
  const cmdByte = buf[3];
  const dataLen = buf[4];
  const expectedLen = 5 + dataLen + 1;

  if (buf.length < expectedLen) return null;

  const expected = checksum(buf.subarray(0, expectedLen - 1));
  if (buf[expectedLen - 1] !== expected) return null;

  const isAck = (cmdByte & 0x80) !== 0;
  const cmd = cmdByte & 0x3f;
  const data = buf.slice(5, 5 + dataLen);

  return { addr, cmd, isAck, data };
}

/** Parse device info from a CMD_GET_INFO response payload. */
export function parseDeviceInfo(data: Uint8Array): DeviceInfo | null {
  if (data.length < 8) return null;

  const version = data[0];
  let versionName: string;
  switch (version) {
    case DEVICE_VERSION.KVM_GO:
      versionName = 'KVM-GO';
      break;
    case DEVICE_VERSION.MINI_KVM:
      versionName = 'Mini-KVM';
      break;
    default:
      versionName = `Unknown (${version})`;
  }

  return {
    version,
    usbConnected: data[1] === 0x01,
    ledStatus: data[2] & 0x07,
    versionName,
  };
}
