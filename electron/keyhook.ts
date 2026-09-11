// Low-level keyboard hook (Windows only).
//
// While a session window is focused the OS would otherwise act on the Windows key, Alt+Tab,
// Alt+Esc, Ctrl+Esc and Alt+F4 before the app ever sees them. A WH_KEYBOARD_LL hook lets us
// see those keystrokes first, forward them to the remote session and swallow them locally —
// the same technique mstsc uses. Implemented with the koffi FFI package; if koffi is not
// available (other platforms, packaging problem) the hook is simply not installed.

export interface HookedKeyEvent {
  vkCode: number;
  scanCode: number;
  extended: boolean;
  altDown: boolean;   // LLKHF_ALTDOWN — an Alt key is held
  down: boolean;      // key press (true) or release (false)
  injected: boolean;  // synthetic input (SendInput) — never capture these
}

/** Return true to swallow the key (the OS and every app, including ours, won't see it). */
export type KeyHookHandler = (evt: HookedKeyEvent) => boolean;

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_SYSKEYDOWN = 0x0104;
const LLKHF_EXTENDED = 0x01;
const LLKHF_INJECTED = 0x10;
const LLKHF_ALTDOWN = 0x20;

let koffi: any = null;
let user32: any = null;
let hookHandle: any = null;
let hookProcPtr: any = null;   // keep referenced — the OS calls into it for the hook's lifetime
let callNextHookEx: any = null;
let unhookWindowsHookEx: any = null;

export function isKeyHookInstalled(): boolean {
  return hookHandle != null;
}

export function installKeyHook(handler: KeyHookHandler): boolean {
  if (process.platform !== 'win32') return false;
  if (hookHandle) return true;

  try {
    // Resolved at runtime; externalised from the bundle and unpacked from the asar.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    koffi = require('koffi');
  } catch (err: any) {
    console.warn('[keyhook] koffi not available, system shortcuts will not be captured:', err?.message || err);
    return false;
  }

  try {
    const KBDLLHOOKSTRUCT = koffi.struct('RDPEA_KBDLLHOOKSTRUCT', {
      vkCode: 'uint32',
      scanCode: 'uint32',
      flags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr',
    });
    const HOOKPROC = koffi.proto('intptr __stdcall RDPEA_HOOKPROC(int nCode, uintptr wParam, intptr lParam)');

    user32 = koffi.load('user32.dll');
    const setWindowsHookExW = user32.func('void* __stdcall SetWindowsHookExW(int idHook, void* lpfn, void* hMod, uint32 dwThreadId)');
    callNextHookEx = user32.func('intptr __stdcall CallNextHookEx(void* hhk, int nCode, uintptr wParam, intptr lParam)');
    unhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void* hhk)');

    // Runs synchronously on the main thread whenever the OS delivers a keyboard event
    // (Chromium pumps the Win32 message loop there). It must return fast: Windows silently
    // removes hooks that take longer than a few hundred milliseconds.
    const proc = (nCode: number, wParam: any, lParam: any): any => {
      if (nCode >= 0) {
        try {
          const info = koffi.decode(lParam, KBDLLHOOKSTRUCT);
          const wp = Number(wParam);
          const evt: HookedKeyEvent = {
            vkCode: info.vkCode,
            scanCode: info.scanCode & 0xFF,
            extended: (info.flags & LLKHF_EXTENDED) !== 0,
            altDown: (info.flags & LLKHF_ALTDOWN) !== 0,
            down: wp === WM_KEYDOWN || wp === WM_SYSKEYDOWN,
            injected: (info.flags & LLKHF_INJECTED) !== 0,
          };
          if (handler(evt)) return 1;
        } catch (err) {
          console.error('[keyhook] handler error:', err);
        }
      }
      return callNextHookEx(null, nCode, wParam, lParam);
    };

    hookProcPtr = koffi.register(proc, koffi.pointer(HOOKPROC));
    hookHandle = setWindowsHookExW(WH_KEYBOARD_LL, hookProcPtr, null, 0);
    if (!hookHandle) {
      console.warn('[keyhook] SetWindowsHookExW failed');
      koffi.unregister(hookProcPtr);
      hookProcPtr = null;
      return false;
    }
    console.log('[keyhook] low-level keyboard hook installed');
    return true;
  } catch (err: any) {
    console.warn('[keyhook] failed to install hook:', err?.message || err);
    hookHandle = null;
    return false;
  }
}

export function uninstallKeyHook(): void {
  try {
    if (hookHandle && unhookWindowsHookEx) unhookWindowsHookEx(hookHandle);
    if (hookProcPtr && koffi) koffi.unregister(hookProcPtr);
  } catch {
    // best effort at shutdown
  }
  hookHandle = null;
  hookProcPtr = null;
}
