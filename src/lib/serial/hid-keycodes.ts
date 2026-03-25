/**
 * Maps JavaScript KeyboardEvent.code values to USB HID Usage IDs.
 * Reference: USB HID Usage Tables, Section 10 (Keyboard/Keypad Page 0x07).
 */

export const HID_KEY: Record<string, number> = {
  KeyA: 0x04,
  KeyB: 0x05,
  KeyC: 0x06,
  KeyD: 0x07,
  KeyE: 0x08,
  KeyF: 0x09,
  KeyG: 0x0a,
  KeyH: 0x0b,
  KeyI: 0x0c,
  KeyJ: 0x0d,
  KeyK: 0x0e,
  KeyL: 0x0f,
  KeyM: 0x10,
  KeyN: 0x11,
  KeyO: 0x12,
  KeyP: 0x13,
  KeyQ: 0x14,
  KeyR: 0x15,
  KeyS: 0x16,
  KeyT: 0x17,
  KeyU: 0x18,
  KeyV: 0x19,
  KeyW: 0x1a,
  KeyX: 0x1b,
  KeyY: 0x1c,
  KeyZ: 0x1d,

  Digit1: 0x1e,
  Digit2: 0x1f,
  Digit3: 0x20,
  Digit4: 0x21,
  Digit5: 0x22,
  Digit6: 0x23,
  Digit7: 0x24,
  Digit8: 0x25,
  Digit9: 0x26,
  Digit0: 0x27,

  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  CapsLock: 0x39,

  F1: 0x3a,
  F2: 0x3b,
  F3: 0x3c,
  F4: 0x3d,
  F5: 0x3e,
  F6: 0x3f,
  F7: 0x40,
  F8: 0x41,
  F9: 0x42,
  F10: 0x43,
  F11: 0x44,
  F12: 0x45,

  PrintScreen: 0x46,
  ScrollLock: 0x47,
  Pause: 0x48,
  Insert: 0x49,
  Home: 0x4a,
  PageUp: 0x4b,
  Delete: 0x4c,
  End: 0x4d,
  PageDown: 0x4e,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,

  NumLock: 0x53,
  NumpadDivide: 0x54,
  NumpadMultiply: 0x55,
  NumpadSubtract: 0x56,
  NumpadAdd: 0x57,
  NumpadEnter: 0x58,
  Numpad1: 0x59,
  Numpad2: 0x5a,
  Numpad3: 0x5b,
  Numpad4: 0x5c,
  Numpad5: 0x5d,
  Numpad6: 0x5e,
  Numpad7: 0x5f,
  Numpad8: 0x60,
  Numpad9: 0x61,
  Numpad0: 0x62,
  NumpadDecimal: 0x63,

  IntlBackslash: 0x64,
  ContextMenu: 0x65,

  F13: 0x68,
  F14: 0x69,
  F15: 0x6a,
  F16: 0x6b,
  F17: 0x6c,
  F18: 0x6d,
  F19: 0x6e,
  F20: 0x6f,
  F21: 0x70,
  F22: 0x71,
  F23: 0x72,
  F24: 0x73,
};

/** Maps KeyboardEvent.code for modifier keys to their HID modifier bitmask. */
export const HID_MODIFIER: Record<string, number> = {
  ControlLeft: 0x01,
  ShiftLeft: 0x02,
  AltLeft: 0x04,
  MetaLeft: 0x08,
  ControlRight: 0x10,
  ShiftRight: 0x20,
  AltRight: 0x40,
  MetaRight: 0x80,
};

/** Check if a key code is a modifier key. */
export function isModifier(code: string): boolean {
  return code in HID_MODIFIER;
}

/** Get the HID keycode for a given KeyboardEvent.code. Returns 0 if not found. */
export function getHidKeycode(code: string): number {
  return HID_KEY[code] ?? 0;
}

/** Get the modifier bitmask for a given KeyboardEvent.code. Returns 0 if not a modifier. */
export function getModifierMask(code: string): number {
  return HID_MODIFIER[code] ?? 0;
}

/**
 * Maps a printable character to a HID keycode + modifier.
 * Used for text-paste: converts each character into the key combo needed to type it.
 * Assumes US keyboard layout.
 */
export function charToHidKey(char: string): { keycode: number; modifier: number } | null {
  const SHIFT = 0x02; // Left Shift

  // Lowercase letters
  if (char >= 'a' && char <= 'z') {
    return { keycode: 0x04 + (char.charCodeAt(0) - 'a'.charCodeAt(0)), modifier: 0 };
  }
  // Uppercase letters
  if (char >= 'A' && char <= 'Z') {
    return { keycode: 0x04 + (char.charCodeAt(0) - 'A'.charCodeAt(0)), modifier: SHIFT };
  }
  // Digits and their shifted symbols
  const digitMap: Record<string, { keycode: number; modifier: number }> = {
    '1': { keycode: 0x1e, modifier: 0 },
    '2': { keycode: 0x1f, modifier: 0 },
    '3': { keycode: 0x20, modifier: 0 },
    '4': { keycode: 0x21, modifier: 0 },
    '5': { keycode: 0x22, modifier: 0 },
    '6': { keycode: 0x23, modifier: 0 },
    '7': { keycode: 0x24, modifier: 0 },
    '8': { keycode: 0x25, modifier: 0 },
    '9': { keycode: 0x26, modifier: 0 },
    '0': { keycode: 0x27, modifier: 0 },
    '!': { keycode: 0x1e, modifier: SHIFT },
    '@': { keycode: 0x1f, modifier: SHIFT },
    '#': { keycode: 0x20, modifier: SHIFT },
    $: { keycode: 0x21, modifier: SHIFT },
    '%': { keycode: 0x22, modifier: SHIFT },
    '^': { keycode: 0x23, modifier: SHIFT },
    '&': { keycode: 0x24, modifier: SHIFT },
    '*': { keycode: 0x25, modifier: SHIFT },
    '(': { keycode: 0x26, modifier: SHIFT },
    ')': { keycode: 0x27, modifier: SHIFT },
  };
  if (digitMap[char]) return digitMap[char];

  // Special characters
  const specialMap: Record<string, { keycode: number; modifier: number }> = {
    '\n': { keycode: 0x28, modifier: 0 }, // Enter
    '\r': { keycode: 0x28, modifier: 0 },
    '\t': { keycode: 0x2b, modifier: 0 }, // Tab
    ' ': { keycode: 0x2c, modifier: 0 }, // Space
    '-': { keycode: 0x2d, modifier: 0 },
    _: { keycode: 0x2d, modifier: SHIFT },
    '=': { keycode: 0x2e, modifier: 0 },
    '+': { keycode: 0x2e, modifier: SHIFT },
    '[': { keycode: 0x2f, modifier: 0 },
    '{': { keycode: 0x2f, modifier: SHIFT },
    ']': { keycode: 0x30, modifier: 0 },
    '}': { keycode: 0x30, modifier: SHIFT },
    '\\': { keycode: 0x31, modifier: 0 },
    '|': { keycode: 0x31, modifier: SHIFT },
    ';': { keycode: 0x33, modifier: 0 },
    ':': { keycode: 0x33, modifier: SHIFT },
    "'": { keycode: 0x34, modifier: 0 },
    '"': { keycode: 0x34, modifier: SHIFT },
    '`': { keycode: 0x35, modifier: 0 },
    '~': { keycode: 0x35, modifier: SHIFT },
    ',': { keycode: 0x36, modifier: 0 },
    '<': { keycode: 0x36, modifier: SHIFT },
    '.': { keycode: 0x37, modifier: 0 },
    '>': { keycode: 0x37, modifier: SHIFT },
    '/': { keycode: 0x38, modifier: 0 },
    '?': { keycode: 0x38, modifier: SHIFT },
  };
  if (specialMap[char]) return specialMap[char];

  return null;
}
