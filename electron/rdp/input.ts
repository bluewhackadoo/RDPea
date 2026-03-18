// RDP Input PDU encoding — keyboard scancodes & mouse events (MS-RDPBCGR §2.2.8.1.1.3)
import { BufferWriter } from './bufferWriter';
import * as types from './types';

export interface KeyboardEvent {
  type: 'keydown' | 'keyup';
  scanCode: number;
  extended: boolean;
}

export interface MouseEvent {
  type: 'move' | 'down' | 'up' | 'wheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  wheelDelta?: number;
}

// Build a Slow-Path Input PDU containing one or more input events
export function buildInputPDU(events: Array<KeyboardEvent | MouseEvent>, shareId: number): Buffer {
  const w = new BufferWriter(64 * events.length + 16);

  // Share Data Header fields (will be wrapped by caller)
  w.writeUInt16LE(events.length); // numEvents
  w.writeUInt16LE(0); // pad2Octets

  for (const evt of events) {
    // All input events have a 4-byte eventTime followed by 2-byte messageType
    w.writeUInt32LE(0); // eventTime (0 = let server decide)

    if ('scanCode' in evt) {
      w.writeUInt16LE(types.InputEventType.SCANCODE);
      let keyFlags = 0;
      if (evt.extended) keyFlags |= types.KBDFLAGS_EXTENDED;
      if (evt.type === 'keyup') keyFlags |= types.KBDFLAGS_RELEASE;
      w.writeUInt16LE(keyFlags); // keyboardFlags
      w.writeUInt16LE(evt.scanCode); // keyCode
      w.writeUInt16LE(0); // pad2Octets
    } else {
      w.writeUInt16LE(types.InputEventType.MOUSE);
      let pointerFlags = 0;

      if (evt.type === 'move') {
        pointerFlags = types.PTRFLAGS_MOVE;
      } else if (evt.type === 'wheel') {
        pointerFlags = types.PTRFLAGS_WHEEL;
        const delta = evt.wheelDelta || 0;
        if (delta < 0) {
          pointerFlags |= types.PTRFLAGS_WHEEL_NEGATIVE;
          pointerFlags |= (-delta) & 0x01FF;
        } else {
          pointerFlags |= delta & 0x01FF;
        }
      } else {
        // down or up
        if (evt.type === 'down') pointerFlags |= types.PTRFLAGS_DOWN;
        switch (evt.button) {
          case 'left': pointerFlags |= types.PTRFLAGS_BUTTON1; break;
          case 'right': pointerFlags |= types.PTRFLAGS_BUTTON2; break;
          case 'middle': pointerFlags |= types.PTRFLAGS_BUTTON3; break;
        }
      }

      w.writeUInt16LE(pointerFlags);
      w.writeUInt16LE(Math.max(0, Math.min(evt.x, 0xFFFF)));
      w.writeUInt16LE(Math.max(0, Math.min(evt.y, 0xFFFF)));
    }
  }

  return w.toBuffer();
}

// Build a fast-path input PDU for more efficient input delivery
export function buildFastPathInput(events: Array<KeyboardEvent | MouseEvent>): Buffer {
  const eventBuffers: Buffer[] = [];

  for (const evt of events) {
    if ('scanCode' in evt) {
      // Fast-path keyboard event
      let flags = 0x00; // FASTPATH_INPUT_EVENT_SCANCODE
      if (evt.type === 'keyup') flags |= 0x01; // FASTPATH_INPUT_KBDFLAGS_RELEASE
      if (evt.extended) flags |= 0x02; // FASTPATH_INPUT_KBDFLAGS_EXTENDED
      const header = (flags << 1) | (0x00 << 5); // eventCode = SCANCODE(0)
      const buf = Buffer.alloc(2);
      buf[0] = header;
      buf[1] = evt.scanCode & 0xFF;
      eventBuffers.push(buf);
    } else {
      // Fast-path mouse event
      let pointerFlags = 0;
      if (evt.type === 'move') {
        pointerFlags = types.PTRFLAGS_MOVE;
      } else if (evt.type === 'wheel') {
        pointerFlags = types.PTRFLAGS_WHEEL;
        const delta = evt.wheelDelta || 0;
        if (delta < 0) {
          pointerFlags |= types.PTRFLAGS_WHEEL_NEGATIVE;
          pointerFlags |= (-delta) & 0x01FF;
        } else {
          pointerFlags |= delta & 0x01FF;
        }
      } else {
        if (evt.type === 'down') pointerFlags |= types.PTRFLAGS_DOWN;
        switch (evt.button) {
          case 'left': pointerFlags |= types.PTRFLAGS_BUTTON1; break;
          case 'right': pointerFlags |= types.PTRFLAGS_BUTTON2; break;
          case 'middle': pointerFlags |= types.PTRFLAGS_BUTTON3; break;
        }
      }

      const header = (0x01 << 5); // eventCode = MOUSE(1)
      const buf = Buffer.alloc(7);
      buf[0] = header;
      buf.writeUInt16LE(pointerFlags, 1);
      buf.writeUInt16LE(Math.max(0, Math.min(evt.x, 0xFFFF)), 3);
      buf.writeUInt16LE(Math.max(0, Math.min(evt.y, 0xFFFF)), 5);
      eventBuffers.push(buf);
    }
  }

  const eventsData = Buffer.concat(eventBuffers);
  const numEvents = events.length;

  // Fast-path header: action(2 bits) + numEvents(4 bits) + length
  const fpHeader = (numEvents & 0x0F) << 2; // FASTPATH_INPUT_ACTION_FASTPATH = 0
  const totalLen = 1 + (eventsData.length + 1 < 0x80 ? 1 : 2) + eventsData.length;

  const w = new BufferWriter(totalLen + 4);
  w.writeUInt8(fpHeader);
  // Length
  if (totalLen < 0x80) {
    w.writeUInt8(totalLen);
  } else {
    w.writeUInt16BE(totalLen | 0x8000);
  }
  w.writeBuffer(eventsData);

  return w.toBuffer();
}

// Map DOM key codes to RDP scan codes
export const DOM_TO_SCANCODE: Record<string, { code: number; extended: boolean }> = {
  'Escape': { code: 0x01, extended: false },
  'Digit1': { code: 0x02, extended: false },
  'Digit2': { code: 0x03, extended: false },
  'Digit3': { code: 0x04, extended: false },
  'Digit4': { code: 0x05, extended: false },
  'Digit5': { code: 0x06, extended: false },
  'Digit6': { code: 0x07, extended: false },
  'Digit7': { code: 0x08, extended: false },
  'Digit8': { code: 0x09, extended: false },
  'Digit9': { code: 0x0A, extended: false },
  'Digit0': { code: 0x0B, extended: false },
  'Minus': { code: 0x0C, extended: false },
  'Equal': { code: 0x0D, extended: false },
  'Backspace': { code: 0x0E, extended: false },
  'Tab': { code: 0x0F, extended: false },
  'KeyQ': { code: 0x10, extended: false },
  'KeyW': { code: 0x11, extended: false },
  'KeyE': { code: 0x12, extended: false },
  'KeyR': { code: 0x13, extended: false },
  'KeyT': { code: 0x14, extended: false },
  'KeyY': { code: 0x15, extended: false },
  'KeyU': { code: 0x16, extended: false },
  'KeyI': { code: 0x17, extended: false },
  'KeyO': { code: 0x18, extended: false },
  'KeyP': { code: 0x19, extended: false },
  'BracketLeft': { code: 0x1A, extended: false },
  'BracketRight': { code: 0x1B, extended: false },
  'Enter': { code: 0x1C, extended: false },
  'ControlLeft': { code: 0x1D, extended: false },
  'KeyA': { code: 0x1E, extended: false },
  'KeyS': { code: 0x1F, extended: false },
  'KeyD': { code: 0x20, extended: false },
  'KeyF': { code: 0x21, extended: false },
  'KeyG': { code: 0x22, extended: false },
  'KeyH': { code: 0x23, extended: false },
  'KeyJ': { code: 0x24, extended: false },
  'KeyK': { code: 0x25, extended: false },
  'KeyL': { code: 0x26, extended: false },
  'Semicolon': { code: 0x27, extended: false },
  'Quote': { code: 0x28, extended: false },
  'Backquote': { code: 0x29, extended: false },
  'ShiftLeft': { code: 0x2A, extended: false },
  'Backslash': { code: 0x2B, extended: false },
  'KeyZ': { code: 0x2C, extended: false },
  'KeyX': { code: 0x2D, extended: false },
  'KeyC': { code: 0x2E, extended: false },
  'KeyV': { code: 0x2F, extended: false },
  'KeyB': { code: 0x30, extended: false },
  'KeyN': { code: 0x31, extended: false },
  'KeyM': { code: 0x32, extended: false },
  'Comma': { code: 0x33, extended: false },
  'Period': { code: 0x34, extended: false },
  'Slash': { code: 0x35, extended: false },
  'ShiftRight': { code: 0x36, extended: false },
  'NumpadMultiply': { code: 0x37, extended: false },
  'AltLeft': { code: 0x38, extended: false },
  'Space': { code: 0x39, extended: false },
  'CapsLock': { code: 0x3A, extended: false },
  'F1': { code: 0x3B, extended: false },
  'F2': { code: 0x3C, extended: false },
  'F3': { code: 0x3D, extended: false },
  'F4': { code: 0x3E, extended: false },
  'F5': { code: 0x3F, extended: false },
  'F6': { code: 0x40, extended: false },
  'F7': { code: 0x41, extended: false },
  'F8': { code: 0x42, extended: false },
  'F9': { code: 0x43, extended: false },
  'F10': { code: 0x44, extended: false },
  'NumLock': { code: 0x45, extended: false },
  'ScrollLock': { code: 0x46, extended: false },
  'Numpad7': { code: 0x47, extended: false },
  'Numpad8': { code: 0x48, extended: false },
  'Numpad9': { code: 0x49, extended: false },
  'NumpadSubtract': { code: 0x4A, extended: false },
  'Numpad4': { code: 0x4B, extended: false },
  'Numpad5': { code: 0x4C, extended: false },
  'Numpad6': { code: 0x4D, extended: false },
  'NumpadAdd': { code: 0x4E, extended: false },
  'Numpad1': { code: 0x4F, extended: false },
  'Numpad2': { code: 0x50, extended: false },
  'Numpad3': { code: 0x51, extended: false },
  'Numpad0': { code: 0x52, extended: false },
  'NumpadDecimal': { code: 0x53, extended: false },
  'F11': { code: 0x57, extended: false },
  'F12': { code: 0x58, extended: false },
  'NumpadEnter': { code: 0x1C, extended: true },
  'ControlRight': { code: 0x1D, extended: true },
  'NumpadDivide': { code: 0x35, extended: true },
  'PrintScreen': { code: 0x37, extended: true },
  'AltRight': { code: 0x38, extended: true },
  'Home': { code: 0x47, extended: true },
  'ArrowUp': { code: 0x48, extended: true },
  'PageUp': { code: 0x49, extended: true },
  'ArrowLeft': { code: 0x4B, extended: true },
  'ArrowRight': { code: 0x4D, extended: true },
  'End': { code: 0x4F, extended: true },
  'ArrowDown': { code: 0x50, extended: true },
  'PageDown': { code: 0x51, extended: true },
  'Insert': { code: 0x52, extended: true },
  'Delete': { code: 0x53, extended: true },
  'MetaLeft': { code: 0x5B, extended: true },
  'MetaRight': { code: 0x5C, extended: true },
  'ContextMenu': { code: 0x5D, extended: true },
};
