/**
 * Svelte 5 rune-based state for the Openterface KVM application.
 */

import { SerialConnection } from '$lib/serial/connection';
import {
  buildKeyboardFrame,
  buildKeyReleaseFrame,
  buildAbsoluteMouseFrame,
  buildRelativeMouseFrame,
  buildGetInfoFrame,
  type DeviceInfo,
} from '$lib/serial/protocol';
import { getHidKeycode, getModifierMask, isModifier, charToHidKey } from '$lib/serial/hid-keycodes';

const SNIPPETS_STORAGE_KEY = 'openterface-snippets';
const AUTOCROP_STORAGE_KEY = 'openterface-autocrop';

export interface TextSnippet {
  id: string;
  name: string;
  text: string;
}

class KvmState {
  // Serial connection
  serial = new SerialConnection();
  connected = $state(false);
  deviceInfo = $state<DeviceInfo | null>(null);

  // Video
  videoStream = $state<MediaStream | null>(null);
  selectedVideoDeviceId = $state<string>('');
  videoDevices = $state<MediaDeviceInfo[]>([]);
  autoCropEnabled = $state(true);

  // Keyboard state
  pressedModifiers = $state(0);
  pressedKeys = $state<Set<number>>(new Set());

  // Mouse state
  mouseButtons = $state(0);
  useAbsoluteMouse = $state(true);
  mouseCaptured = $state(false);

  // Mouse write throttling (~120Hz max)
  private mouseWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMouseFrame: Uint8Array | null = null;
  private lastMouseWriteTime = 0;
  private readonly MOUSE_INTERVAL_MS = 8;

  // Paste state
  isPasting = $state(false);

  // Snippets
  snippets = $state<TextSnippet[]>([]);

  // UI state
  lastError = $state('');

  // Derived
  statusText = $derived(
    this.connected
      ? this.deviceInfo
        ? `Connected: ${this.deviceInfo.versionName}`
        : 'Connected'
      : 'Disconnected',
  );

  constructor() {
    this.serial.onDisconnect = () => {
      this.connected = false;
      this.deviceInfo = null;
    };

    this.serial.onDeviceInfo = (info) => {
      this.deviceInfo = info;
    };
  }

  /** Load persisted state from localStorage. Call once from a browser context. */
  loadPersistedState() {
    try {
      const stored = localStorage.getItem(SNIPPETS_STORAGE_KEY);
      if (stored) this.snippets = JSON.parse(stored);
    } catch {
      // ignore
    }
    try {
      const crop = localStorage.getItem(AUTOCROP_STORAGE_KEY);
      if (crop !== null) this.autoCropEnabled = crop === 'true';
    } catch {
      // ignore
    }
  }

  setAutoCrop(enabled: boolean) {
    this.autoCropEnabled = enabled;
    localStorage.setItem(AUTOCROP_STORAGE_KEY, String(enabled));
  }

  // Snippets
  private saveSnippets() {
    localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(this.snippets));
  }

  addSnippet(name: string, text: string) {
    this.snippets = [...this.snippets, { id: crypto.randomUUID(), name, text }];
    this.saveSnippets();
  }

  removeSnippet(id: string) {
    this.snippets = this.snippets.filter((s) => s.id !== id);
    this.saveSnippets();
  }

  // Serial
  async connectSerial() {
    try {
      await this.serial.connect();
      this.connected = true;
      await this.serial.write(buildGetInfoFrame());
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'Failed to connect serial';
      this.connected = false;
    }
  }

  async disconnectSerial() {
    await this.serial.disconnect();
    this.connected = false;
    this.deviceInfo = null;
  }

  // Video
  async refreshVideoDevices() {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      this.videoDevices = devices.filter((d) => d.kind === 'videoinput');

      // Auto-select Openterface device if available and nothing selected yet
      if (!this.selectedVideoDeviceId) {
        const openterface = this.videoDevices.find((d) =>
          d.label.toLowerCase().includes('openterface'),
        );
        if (openterface) {
          await this.startVideo(openterface.deviceId);
        }
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'Failed to enumerate video devices';
    }
  }

  async startVideo(deviceId?: string) {
    try {
      this.stopVideo();

      const constraints: MediaStreamConstraints = {
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 4096 },
          height: { ideal: 2160 },
        },
      };

      this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = this.videoStream.getVideoTracks()[0];
      if (track) {
        this.selectedVideoDeviceId = track.getSettings().deviceId ?? '';
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'Failed to start video';
    }
  }

  stopVideo() {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach((t) => t.stop());
      this.videoStream = null;
    }
  }

  // Throttled mouse frame write — coalesces rapid events to ~120Hz
  private async writeMouseFrame(frame: Uint8Array) {
    const now = performance.now();
    const elapsed = now - this.lastMouseWriteTime;

    if (elapsed >= this.MOUSE_INTERVAL_MS) {
      this.lastMouseWriteTime = now;
      this.pendingMouseFrame = null;
      if (this.mouseWriteTimer) {
        clearTimeout(this.mouseWriteTimer);
        this.mouseWriteTimer = null;
      }
      try {
        await this.serial.write(frame);
      } catch {
        // ignore
      }
    } else {
      this.pendingMouseFrame = frame;
      if (!this.mouseWriteTimer) {
        this.mouseWriteTimer = setTimeout(() => {
          this.mouseWriteTimer = null;
          if (this.pendingMouseFrame) {
            this.lastMouseWriteTime = performance.now();
            const pending = this.pendingMouseFrame;
            this.pendingMouseFrame = null;
            this.serial.write(pending).catch(() => {});
          }
        }, this.MOUSE_INTERVAL_MS - elapsed);
      }
    }
  }

  // Keyboard handling
  async handleKeyDown(e: KeyboardEvent) {
    if (!this.connected) return;

    e.preventDefault();
    e.stopPropagation();

    if (isModifier(e.code)) {
      this.pressedModifiers |= getModifierMask(e.code);
    } else {
      const hid = getHidKeycode(e.code);
      if (hid) this.pressedKeys.add(hid);
    }

    await this.sendKeyboardState();
  }

  async handleKeyUp(e: KeyboardEvent) {
    if (!this.connected) return;

    e.preventDefault();
    e.stopPropagation();

    if (isModifier(e.code)) {
      this.pressedModifiers &= ~getModifierMask(e.code);
    } else {
      const hid = getHidKeycode(e.code);
      if (hid) this.pressedKeys.delete(hid);
    }

    if (this.pressedModifiers === 0 && this.pressedKeys.size === 0) {
      await this.serial.write(buildKeyReleaseFrame());
    } else {
      await this.sendKeyboardState();
    }
  }

  private async sendKeyboardState() {
    const keycodes = Array.from(this.pressedKeys).slice(0, 6);
    const frame = buildKeyboardFrame(this.pressedModifiers, keycodes);
    try {
      await this.serial.write(frame);
    } catch {
      // Ignore write errors during rapid typing
    }
  }

  async releaseAllKeys() {
    this.pressedModifiers = 0;
    this.pressedKeys = new Set();
    if (this.connected) {
      try {
        await this.serial.write(buildKeyReleaseFrame());
      } catch {
        // ignore
      }
    }
  }

  // Text paste — types each character as sequential key press/release
  async pasteText(text: string) {
    if (!this.connected || this.isPasting) return;

    this.isPasting = true;
    try {
      for (const char of text) {
        const hid = charToHidKey(char);
        if (!hid) continue;

        const frame = buildKeyboardFrame(hid.modifier, [hid.keycode]);
        await this.serial.write(frame);
        // Small delay to let the target register the keystroke
        await new Promise((r) => setTimeout(r, 8));
        await this.serial.write(buildKeyReleaseFrame());
        await new Promise((r) => setTimeout(r, 8));
      }
    } finally {
      this.isPasting = false;
    }
  }

  async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) await this.pasteText(text);
    } catch {
      this.lastError = 'Failed to read clipboard';
    }
  }

  // Mouse handling — contentRect is the viewport rect of the visible video content area
  private absCoords(
    e: MouseEvent,
    contentRect: { left: number; top: number; width: number; height: number },
  ): { x: number; y: number } {
    const x = Math.round(((e.clientX - contentRect.left) / contentRect.width) * 4096);
    const y = Math.round(((e.clientY - contentRect.top) / contentRect.height) * 4096);
    return {
      x: Math.max(0, Math.min(4096, x)),
      y: Math.max(0, Math.min(4096, y)),
    };
  }

  async handleMouseMove(
    e: MouseEvent,
    contentRect: { left: number; top: number; width: number; height: number },
  ) {
    if (!this.connected) return;

    if (this.useAbsoluteMouse) {
      const { x, y } = this.absCoords(e, contentRect);
      const frame = buildAbsoluteMouseFrame(this.mouseButtons, x, y, 0);
      await this.writeMouseFrame(frame);
    } else if (this.mouseCaptured) {
      const dx = Math.max(-127, Math.min(127, e.movementX));
      const dy = Math.max(-127, Math.min(127, e.movementY));
      if (dx !== 0 || dy !== 0) {
        const frame = buildRelativeMouseFrame(this.mouseButtons, dx, dy, 0);
        await this.writeMouseFrame(frame);
      }
    }
  }

  async handleMouseDown(
    e: MouseEvent,
    contentRect: { left: number; top: number; width: number; height: number },
  ) {
    if (!this.connected) return;

    if (e.button === 0) this.mouseButtons |= 0x01;
    else if (e.button === 1) this.mouseButtons |= 0x04;
    else if (e.button === 2) this.mouseButtons |= 0x02;

    await this.sendMouseState(e, contentRect);
  }

  async handleMouseUp(
    e: MouseEvent,
    contentRect: { left: number; top: number; width: number; height: number },
  ) {
    if (!this.connected) return;

    if (e.button === 0) this.mouseButtons &= ~0x01;
    else if (e.button === 1) this.mouseButtons &= ~0x04;
    else if (e.button === 2) this.mouseButtons &= ~0x02;

    await this.sendMouseState(e, contentRect);
  }

  async handleWheel(
    e: WheelEvent,
    contentRect: { left: number; top: number; width: number; height: number },
  ) {
    if (!this.connected) return;
    e.preventDefault();

    const wheel = Math.max(-127, Math.min(127, -Math.sign(e.deltaY)));

    if (this.useAbsoluteMouse) {
      const { x, y } = this.absCoords(e, contentRect);
      const frame = buildAbsoluteMouseFrame(this.mouseButtons, x, y, wheel);
      await this.writeMouseFrame(frame);
    } else {
      const frame = buildRelativeMouseFrame(this.mouseButtons, 0, 0, wheel);
      await this.writeMouseFrame(frame);
    }
  }

  private async sendMouseState(
    e: MouseEvent,
    contentRect: { left: number; top: number; width: number; height: number },
  ) {
    if (this.useAbsoluteMouse) {
      const { x, y } = this.absCoords(e, contentRect);
      const frame = buildAbsoluteMouseFrame(this.mouseButtons, x, y, 0);
      try {
        await this.serial.write(frame);
      } catch {
        // ignore
      }
    } else {
      const frame = buildRelativeMouseFrame(this.mouseButtons, 0, 0, 0);
      try {
        await this.serial.write(frame);
      } catch {
        // ignore
      }
    }
  }

  async requestPointerLock(element: HTMLElement) {
    try {
      await element.requestPointerLock();
      this.mouseCaptured = true;
    } catch {
      this.lastError = 'Failed to capture mouse pointer';
    }
  }

  releasePointerLock() {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.mouseCaptured = false;
  }
}

export const kvm = new KvmState();
