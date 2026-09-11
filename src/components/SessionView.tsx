import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Pin, PinOff, Maximize2, Volume2, VolumeX,
  WifiOff, ArrowLeft, Loader2, Minus, Square, X,
  Monitor, PanelTopClose, PanelTop, Bug, ChevronDown, ChevronUp,
} from 'lucide-react';
import { BitmapRectIPC, AudioDataIPC } from '../types';

// DOM key code → RDP scan code mapping (matches electron/rdp/input.ts)
const DOM_TO_SCANCODE: Record<string, { code: number; extended: boolean }> = {
  Escape: { code: 0x01, extended: false }, Digit1: { code: 0x02, extended: false },
  Digit2: { code: 0x03, extended: false }, Digit3: { code: 0x04, extended: false },
  Digit4: { code: 0x05, extended: false }, Digit5: { code: 0x06, extended: false },
  Digit6: { code: 0x07, extended: false }, Digit7: { code: 0x08, extended: false },
  Digit8: { code: 0x09, extended: false }, Digit9: { code: 0x0A, extended: false },
  Digit0: { code: 0x0B, extended: false }, Minus: { code: 0x0C, extended: false },
  Equal: { code: 0x0D, extended: false }, Backspace: { code: 0x0E, extended: false },
  Tab: { code: 0x0F, extended: false }, KeyQ: { code: 0x10, extended: false },
  KeyW: { code: 0x11, extended: false }, KeyE: { code: 0x12, extended: false },
  KeyR: { code: 0x13, extended: false }, KeyT: { code: 0x14, extended: false },
  KeyY: { code: 0x15, extended: false }, KeyU: { code: 0x16, extended: false },
  KeyI: { code: 0x17, extended: false }, KeyO: { code: 0x18, extended: false },
  KeyP: { code: 0x19, extended: false }, BracketLeft: { code: 0x1A, extended: false },
  BracketRight: { code: 0x1B, extended: false }, Enter: { code: 0x1C, extended: false },
  ControlLeft: { code: 0x1D, extended: false }, KeyA: { code: 0x1E, extended: false },
  KeyS: { code: 0x1F, extended: false }, KeyD: { code: 0x20, extended: false },
  KeyF: { code: 0x21, extended: false }, KeyG: { code: 0x22, extended: false },
  KeyH: { code: 0x23, extended: false }, KeyJ: { code: 0x24, extended: false },
  KeyK: { code: 0x25, extended: false }, KeyL: { code: 0x26, extended: false },
  Semicolon: { code: 0x27, extended: false }, Quote: { code: 0x28, extended: false },
  Backquote: { code: 0x29, extended: false }, ShiftLeft: { code: 0x2A, extended: false },
  Backslash: { code: 0x2B, extended: false }, KeyZ: { code: 0x2C, extended: false },
  KeyX: { code: 0x2D, extended: false }, KeyC: { code: 0x2E, extended: false },
  KeyV: { code: 0x2F, extended: false }, KeyB: { code: 0x30, extended: false },
  KeyN: { code: 0x31, extended: false }, KeyM: { code: 0x32, extended: false },
  Comma: { code: 0x33, extended: false }, Period: { code: 0x34, extended: false },
  Slash: { code: 0x35, extended: false }, ShiftRight: { code: 0x36, extended: false },
  AltLeft: { code: 0x38, extended: false }, Space: { code: 0x39, extended: false },
  CapsLock: { code: 0x3A, extended: false },
  F1: { code: 0x3B, extended: false }, F2: { code: 0x3C, extended: false },
  F3: { code: 0x3D, extended: false }, F4: { code: 0x3E, extended: false },
  F5: { code: 0x3F, extended: false }, F6: { code: 0x40, extended: false },
  F7: { code: 0x41, extended: false }, F8: { code: 0x42, extended: false },
  F9: { code: 0x43, extended: false }, F10: { code: 0x44, extended: false },
  F11: { code: 0x57, extended: false }, F12: { code: 0x58, extended: false },
  NumLock: { code: 0x45, extended: false }, ScrollLock: { code: 0x46, extended: false },
  NumpadMultiply: { code: 0x37, extended: false },
  Numpad7: { code: 0x47, extended: false }, Numpad8: { code: 0x48, extended: false },
  Numpad9: { code: 0x49, extended: false }, NumpadSubtract: { code: 0x4A, extended: false },
  Numpad4: { code: 0x4B, extended: false }, Numpad5: { code: 0x4C, extended: false },
  Numpad6: { code: 0x4D, extended: false }, NumpadAdd: { code: 0x4E, extended: false },
  Numpad1: { code: 0x4F, extended: false }, Numpad2: { code: 0x50, extended: false },
  Numpad3: { code: 0x51, extended: false }, Numpad0: { code: 0x52, extended: false },
  NumpadDecimal: { code: 0x53, extended: false },
  NumpadEnter: { code: 0x1C, extended: true }, ControlRight: { code: 0x1D, extended: true },
  NumpadDivide: { code: 0x35, extended: true }, PrintScreen: { code: 0x37, extended: true },
  AltRight: { code: 0x38, extended: true },
  Home: { code: 0x47, extended: true }, ArrowUp: { code: 0x48, extended: true },
  PageUp: { code: 0x49, extended: true }, ArrowLeft: { code: 0x4B, extended: true },
  ArrowRight: { code: 0x4D, extended: true }, End: { code: 0x4F, extended: true },
  ArrowDown: { code: 0x50, extended: true }, PageDown: { code: 0x51, extended: true },
  Insert: { code: 0x52, extended: true }, Delete: { code: 0x53, extended: true },
  MetaLeft: { code: 0x5B, extended: true }, MetaRight: { code: 0x5C, extended: true },
  ContextMenu: { code: 0x5D, extended: true },
  // Media / volume keys (extended scancodes)
  AudioVolumeMute: { code: 0x20, extended: true },
  AudioVolumeDown: { code: 0x2E, extended: true },
  AudioVolumeUp: { code: 0x30, extended: true },
  MediaTrackNext: { code: 0x19, extended: true },
  MediaTrackPrevious: { code: 0x10, extended: true },
  MediaStop: { code: 0x24, extended: true },
  MediaPlayPause: { code: 0x22, extended: true },
};

// Modifier key codes that can get "stuck" when focus leaves the window
const MODIFIER_CODES = [
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
];

const MAX_DEBUG_LINES = 500;

// ── Automatic reconnect policy ─────────────────────────────────────
// After a failed connection attempt, retry every 10 s for up to 5 minutes,
// then fall back to a manual "Retry Connection" button.
const AUTO_RETRY_INTERVAL_MS = 10_000;
const AUTO_RETRY_WINDOW_MS = 5 * 60_000;
const AUTO_RETRY_MAX_ATTEMPTS = Math.floor(AUTO_RETRY_WINDOW_MS / AUTO_RETRY_INTERVAL_MS);
// A connection attempt that produces neither "connected" nor an error within
// this time is treated as failed so the retry loop can continue.
const CONNECT_ATTEMPT_TIMEOUT_MS = 45_000;

export function SessionView() {
  const { connectionId } = useParams<{ connectionId: string }>();
  // Visible canvas: sized in *device* pixels to exactly match its on-screen footprint,
  // so the compositor never resamples it (that resampling is what made sessions look fuzzy).
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frontCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Back buffer: offscreen canvas at the remote desktop's native resolution.
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Device pixels per remote pixel on each axis (1 = pixel-perfect).
  const scaleRef = useRef({ x: 1, y: 1 });
  const canvasSizeRef = useRef({ width: 1920, height: 1080 });
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const mouseMoveTimeRef = useRef<number>(0);
  const lastHintRef = useRef(false);
  const pressedModifiersRef = useRef<Set<string>>(new Set());
  const debugEndRef = useRef<HTMLDivElement>(null);

  const [isPinned, setIsPinned] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true); // Start as connecting since window opens on connect
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failureSeq, setFailureSeq] = useState(0); // bumps on every failed attempt, even with an identical message
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [showToolbar, setShowToolbar] = useState(true);
  const [toolbarHint, setToolbarHint] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Auto-retry state
  const [retryState, setRetryState] = useState<{ attempt: number; secondsLeft: number } | null>(null);
  const [retryExhausted, setRetryExhausted] = useState(false);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true);
  const retryWindowStartRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Frame rendering with requestAnimationFrame batching ─────────
  const pendingRectsRef = useRef<BitmapRectIPC[]>([]);
  const rafIdRef = useRef<number>(0);

  const getBackCtx = useCallback((width: number, height: number) => {
    let back = backCanvasRef.current;
    if (!back) {
      back = document.createElement('canvas');
      backCanvasRef.current = back;
    }
    if (back.width !== width || back.height !== height) {
      back.width = width;
      back.height = height;
      backCtxRef.current = null;
    }
    if (!backCtxRef.current) backCtxRef.current = back.getContext('2d', { alpha: false });
    return backCtxRef.current;
  }, []);

  const getFrontCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (!frontCtxRef.current || frontCtxRef.current.canvas !== canvas) {
      frontCtxRef.current = canvas.getContext('2d', { alpha: false });
    }
    return frontCtxRef.current;
  }, []);

  // Copy a region (in remote-desktop pixels) from the back buffer to the visible canvas.
  // The destination is snapped to whole device pixels and the source recomputed through the
  // same scale, so adjacent blits sample consistently and never leave seams.
  const blit = useCallback((x: number, y: number, w: number, h: number) => {
    const canvas = canvasRef.current;
    const back = backCanvasRef.current;
    const ctx = getFrontCtx();
    if (!canvas || !back || !ctx) return;
    const { x: sx, y: sy } = scaleRef.current;

    if (sx === 1 && sy === 1) {
      ctx.drawImage(back, x, y, w, h, x, y, w, h);
      return;
    }

    // Exact integer upscales (2x, 3x…) look best with nearest-neighbour; everything else gets
    // the highest-quality resampling the browser offers (much sharper than the compositor's bilinear).
    const integerScale = Number.isInteger(sx) && Number.isInteger(sy);
    ctx.imageSmoothingEnabled = !integerScale;
    if (!integerScale) ctx.imageSmoothingQuality = 'high';

    const dx0 = Math.max(0, Math.floor(x * sx));
    const dy0 = Math.max(0, Math.floor(y * sy));
    const dx1 = Math.min(canvas.width, Math.ceil((x + w) * sx));
    const dy1 = Math.min(canvas.height, Math.ceil((y + h) * sy));
    if (dx1 <= dx0 || dy1 <= dy0) return;
    ctx.drawImage(
      back,
      dx0 / sx, dy0 / sy, (dx1 - dx0) / sx, (dy1 - dy0) / sy,
      dx0, dy0, dx1 - dx0, dy1 - dy0,
    );
  }, [getFrontCtx]);

  // Size and position the visible canvas so its backing store is exactly its device-pixel
  // footprint. Prefers pixel-perfect 1:1 (or exact integer) scales whenever they fit.
  const layoutViewport = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const { width: rdpW, height: rdpH } = canvasSizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    if (cssW <= 0 || cssH <= 0 || rdpW <= 0 || rdpH <= 0) return;

    const availW = Math.floor(cssW * dpr);
    const availH = Math.floor(cssH * dpr);
    let scale = Math.min(availW / rdpW, availH / rdpH);
    const nearest = Math.round(scale);
    if (nearest >= 1 && Math.abs(scale - nearest) / nearest < 0.02 && nearest * rdpW <= availW && nearest * rdpH <= availH) {
      scale = nearest;
    }

    const devW = Math.max(1, Math.round(rdpW * scale));
    const devH = Math.max(1, Math.round(rdpH * scale));
    if (canvas.width !== devW || canvas.height !== devH) {
      canvas.width = devW;
      canvas.height = devH;
    }
    // Place the canvas on a whole device pixel; fractional CSS offsets are what cause blur.
    canvas.style.width = `${devW / dpr}px`;
    canvas.style.height = `${devH / dpr}px`;
    canvas.style.left = `${Math.round((availW - devW) / 2) / dpr}px`;
    canvas.style.top = `${Math.round((availH - devH) / 2) / dpr}px`;
    scaleRef.current = { x: devW / rdpW, y: devH / rdpH };

    // Repaint everything from the back buffer at the new size
    if (backCanvasRef.current) blit(0, 0, rdpW, rdpH);
  }, [blit]);

  const flushFrames = useCallback(() => {
    rafIdRef.current = 0;
    const { width: rdpW, height: rdpH } = canvasSizeRef.current;
    const bctx = getBackCtx(rdpW, rdpH);
    if (!bctx) return;

    const rects = pendingRectsRef.current;
    pendingRectsRef.current = [];

    // Union of everything painted this frame → one scaled blit to the screen
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      try {
        const src = rect.data;
        const needed = rect.width * rect.height * 4;
        if (src.byteLength < needed) continue;
        // Zero-copy: wrap the IPC buffer directly as clamped RGBA
        const pixels = new Uint8ClampedArray(src.buffer as ArrayBuffer, src.byteOffset, needed);
        bctx.putImageData(new ImageData(pixels, rect.width, rect.height), rect.x, rect.y);
        if (rect.x < ux0) ux0 = rect.x;
        if (rect.y < uy0) uy0 = rect.y;
        if (rect.x + rect.width > ux1) ux1 = rect.x + rect.width;
        if (rect.y + rect.height > uy1) uy1 = rect.y + rect.height;
      } catch {
        // skip bad frame
      }
    }
    if (ux1 > ux0 && uy1 > uy0) blit(ux0, uy0, ux1 - ux0, uy1 - uy0);
  }, [getBackCtx, blit]);

  // Keep the viewport laid out: on connect, on resolution change, on window resize, on DPI change
  useLayoutEffect(() => {
    canvasSizeRef.current = canvasSize;
    if (!isConnected) return;
    layoutViewport();

    const container = containerRef.current;
    const observer = container ? new ResizeObserver(() => layoutViewport()) : null;
    if (container && observer) observer.observe(container);

    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDprChange = () => layoutViewport();
    dprQuery.addEventListener('change', onDprChange);
    window.addEventListener('resize', onDprChange);

    return () => {
      observer?.disconnect();
      dprQuery.removeEventListener('change', onDprChange);
      window.removeEventListener('resize', onDprChange);
    };
  }, [isConnected, canvasSize, layoutViewport]);

  const renderFrame = useCallback((rects: BitmapRectIPC[]) => {
    // Accumulate rects and schedule a single paint on next animation frame
    const pending = pendingRectsRef.current;
    for (let i = 0; i < rects.length; i++) pending.push(rects[i]);
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(flushFrames);
    }
  }, [flushFrames]);

  // ── Audio: create AudioContext eagerly so user gestures can resume it ──
  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current && audioEnabled) {
      audioCtxRef.current = new AudioContext();
      nextPlayTimeRef.current = 0;
    }
    // Resume from user gesture context (click/key) — Chrome requires this
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, [audioEnabled]);

  // ── Audio playback ───────────────────────────────────────────────
  const playAudio = useCallback((audioData: AudioDataIPC) => {
    if (!audioEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        nextPlayTimeRef.current = 0;
      }
      const ctx = audioCtxRef.current;

      const bytes = audioData.data instanceof Uint8Array
        ? audioData.data
        : new Uint8Array(audioData.data as any);

      const bytesPerSample = audioData.bitsPerSample / 8;
      const numSamples = Math.floor(bytes.length / bytesPerSample / audioData.channels);
      if (numSamples <= 0) return;
      const buffer = ctx.createBuffer(audioData.channels, numSamples, audioData.sampleRate);

      // Convert PCM to float samples
      for (let ch = 0; ch < audioData.channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let i = 0; i < numSamples; i++) {
          const offset = (i * audioData.channels + ch) * bytesPerSample;
          if (audioData.bitsPerSample === 16) {
            const sample = (bytes[offset + 1] << 8) | bytes[offset];
            channelData[i] = (sample > 32767 ? sample - 65536 : sample) / 32768;
          } else if (audioData.bitsPerSample === 8) {
            channelData[i] = (bytes[offset] - 128) / 128;
          }
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      // Schedule this chunk right after the previous one to avoid gaps/overlap
      const now = ctx.currentTime;
      if (nextPlayTimeRef.current < now) {
        nextPlayTimeRef.current = now;
      }
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;
    } catch {
      // audio errors are non-fatal
    }
  }, [audioEnabled]);

  // ── IPC event listeners ──────────────────────────────────────────
  useEffect(() => {
    if (!connectionId || !window.rdpea) return;

    const unsubFrame = window.rdpea.onFrame((id, rects) => {
      if (id === connectionId) renderFrame(rects);
    });
    const unsubAudio = window.rdpea.onAudio((id, audioData) => {
      if (id === connectionId) playAudio(audioData);
    });
    const unsubConnected = window.rdpea.onConnected((id, info) => {
      if (id === connectionId) {
        setIsConnected(true); setIsConnecting(false); setErrorMsg(null);
        // A successful connection resets the automatic retry budget
        retryWindowStartRef.current = null;
        retryAttemptRef.current = 0;
        setRetryExhausted(false);
        setAutoRetryEnabled(true);
        if (info?.width && info?.height) {
          canvasSizeRef.current = { width: info.width, height: info.height };
          setCanvasSize({ width: info.width, height: info.height });
        }
      }
    });
    const unsubDisconnected = window.rdpea.onDisconnected((id) => {
      if (id === connectionId) { setIsConnected(false); setIsConnecting(false); }
    });
    const unsubError = window.rdpea.onError((id, msg) => {
      if (id === connectionId) { setErrorMsg(msg); setIsConnecting(false); setFailureSeq((s) => s + 1); }
    });

    const unsubDebug = window.rdpea.onDebugLog((id, msg) => {
      if (id === connectionId) {
        setDebugLogs(prev => {
          const next = [...prev, msg];
          return next.length > MAX_DEBUG_LINES ? next.slice(-MAX_DEBUG_LINES) : next;
        });
      }
    });

    // Listen for global debug toggle from main window
    const unsubDebugGlobal = window.rdpea.onDebugGlobal((enabled) => {
      setDebugMode(enabled);
      setDebugOpen(enabled);
      if (connectionId) window.rdpea?.setDebug(connectionId, enabled);
    });

    // Check initial status (window may have been opened for a session that is already live)
    window.rdpea.getStatus(connectionId).then((connected) => {
      if (connected) { setIsConnected(true); setIsConnecting(false); }
    });

    // Check if global debug was already enabled before this window opened
    window.rdpea.getDebugGlobal().then((enabled) => {
      if (enabled) {
        setDebugMode(true);
        setDebugOpen(true);
        if (connectionId) window.rdpea?.setDebug(connectionId, true);
      }
    });

    return () => {
      unsubFrame(); unsubAudio(); unsubConnected(); unsubDisconnected(); unsubError(); unsubDebug(); unsubDebugGlobal();
      if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = 0; }
    };
  }, [connectionId, renderFrame, playAudio]);

  // ── Keyboard input ───────────────────────────────────────────────
  useEffect(() => {
    if (!connectionId || !isConnected) return;

    // Auto-focus the container so keyboard events are captured
    containerRef.current?.focus();

    const handleKey = (e: globalThis.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      ensureAudioCtx(); // Resume AudioContext from user gesture
      const mapping = DOM_TO_SCANCODE[e.code];
      if (!mapping) return;
      const type = e.type === 'keydown' ? 'keydown' : 'keyup';

      // Track modifier key state for stuck-key prevention
      if (MODIFIER_CODES.includes(e.code)) {
        if (type === 'keydown') pressedModifiersRef.current.add(e.code);
        else pressedModifiersRef.current.delete(e.code);
      }

      window.rdpea.sendKeyboard(connectionId, type, mapping.code, mapping.extended);
    };

    // Release all pressed modifiers when the window loses focus
    // (prevents Alt/Ctrl getting "stuck" after Alt-Tab etc.)
    const handleBlur = () => {
      pressedModifiersRef.current.forEach((code) => {
        const mapping = DOM_TO_SCANCODE[code];
        if (mapping) {
          window.rdpea.sendKeyboard(connectionId, 'keyup', mapping.code, mapping.extended);
        }
      });
      pressedModifiersRef.current.clear();
    };

    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('keyup', handleKey, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('keyup', handleKey, true);
      window.removeEventListener('blur', handleBlur);
      // Also release any stuck modifiers on cleanup
      handleBlur();
    };
  }, [connectionId, isConnected, ensureAudioCtx]);

  // ── Mouse input ──────────────────────────────────────────────────
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    // Map from on-screen CSS pixels to remote-desktop pixels
    const { width: rdpW, height: rdpH } = canvasSizeRef.current;
    const x = Math.round((e.clientX - rect.left) * (rdpW / rect.width));
    const y = Math.round((e.clientY - rect.top) * (rdpH / rect.height));
    return {
      x: Math.min(rdpW - 1, Math.max(0, x)),
      y: Math.min(rdpH - 1, Math.max(0, y)),
    };
  }, []);

  const buttonName = (b: number): string => {
    if (b === 0) return 'left';
    if (b === 2) return 'right';
    return 'middle';
  };

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectionId || !isConnected) return;
    // Throttle mouse moves to ~60fps to reduce IPC overhead
    const now = performance.now();
    if (now - mouseMoveTimeRef.current < 16) return;
    mouseMoveTimeRef.current = now;
    const { x, y } = getCanvasCoords(e);
    window.rdpea.sendMouse(connectionId, 'move', x, y);
  }, [connectionId, isConnected, getCanvasCoords]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectionId || !isConnected) return;
    e.preventDefault();
    containerRef.current?.focus();
    ensureAudioCtx(); // Resume AudioContext from user gesture
    const { x, y } = getCanvasCoords(e);
    window.rdpea.sendMouse(connectionId, 'down', x, y, buttonName(e.button));
  }, [connectionId, isConnected, getCanvasCoords, ensureAudioCtx]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!connectionId || !isConnected) return;
    const { x, y } = getCanvasCoords(e);
    window.rdpea.sendMouse(connectionId, 'up', x, y, buttonName(e.button));
  }, [connectionId, isConnected, getCanvasCoords]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!connectionId || !isConnected) return;
    const { x, y } = getCanvasCoords(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    const delta = e.deltaY > 0 ? -120 : 120;
    window.rdpea.sendMouse(connectionId, 'wheel', x, y, undefined, delta);
  }, [connectionId, isConnected, getCanvasCoords]);

  // ── UI actions ───────────────────────────────────────────────
  const handlePin = () => {
    const next = !isPinned;
    setIsPinned(next);
    window.rdpea?.pin(next);
  };

  const handleFullscreen = () => window.rdpea?.maximize();

  const toggleAudio = () => {
    setAudioEnabled(prev => {
      if (prev && audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      return !prev;
    });
  };

  const hideToolbar = () => {
    setShowToolbar(false);
    // Flash a brief hint so user knows how to get it back
    setToolbarHint(true);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setToolbarHint(false), 3000);
  };

  const handleContainerMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (showToolbar) return;
    // Show hint when mouse is within 6px of top edge
    const nearTop = e.clientY <= 6;
    // Only update state if changed to avoid unnecessary re-renders
    if (nearTop !== lastHintRef.current) {
      lastHintRef.current = nearTop;
      setToolbarHint(nearTop);
    }
  }, [showToolbar]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const fail = useCallback((message: string) => {
    setErrorMsg(message);
    setIsConnecting(false);
    setFailureSeq((s) => s + 1);
  }, []);

  const handleReconnect = useCallback(async () => {
    if (!connectionId || !window.rdpea) return;
    clearRetryTimer();
    setRetryState(null);
    setErrorMsg(null);
    setIsConnecting(true);
    try {
      const connections = await window.rdpea.loadConnections();
      const conn = connections.find((c: any) => c.id === connectionId);
      if (!conn) {
        fail('Connection profile no longer exists');
        return;
      }
      const result = await window.rdpea.connect(conn);
      if (!result?.success) fail(result?.error || 'Connection failed');
    } catch (e: any) {
      fail(e?.message || 'Connection failed');
    }
  }, [connectionId, clearRetryTimer, fail]);

  // Manual retry: the user explicitly wants to connect, so it also restarts the 5-minute auto-retry budget
  const handleManualRetry = useCallback(() => {
    retryWindowStartRef.current = null;
    retryAttemptRef.current = 0;
    setRetryExhausted(false);
    setAutoRetryEnabled(true);
    handleReconnect();
  }, [handleReconnect]);

  const stopAutoRetry = useCallback(() => {
    clearRetryTimer();
    setRetryState(null);
    setAutoRetryEnabled(false);
  }, [clearRetryTimer]);

  // Guard against attempts that never resolve (no "connected" and no error)
  useEffect(() => {
    if (!isConnecting || isConnected || !connectionId) return;
    const timer = setTimeout(() => {
      window.rdpea?.disconnect(connectionId).catch(() => {});
      fail(`Connection attempt timed out after ${CONNECT_ATTEMPT_TIMEOUT_MS / 1000}s`);
    }, CONNECT_ATTEMPT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isConnecting, isConnected, connectionId, fail]);

  // Automatic retry loop: after a failed attempt, retry every 10 s for up to 5 minutes
  useEffect(() => {
    if (!errorMsg || isConnected || isConnecting || !autoRetryEnabled) {
      clearRetryTimer();
      setRetryState(null);
      return;
    }

    const now = Date.now();
    if (retryWindowStartRef.current === null) {
      retryWindowStartRef.current = now;
      retryAttemptRef.current = 0;
    }
    const elapsed = now - retryWindowStartRef.current;
    if (retryAttemptRef.current >= AUTO_RETRY_MAX_ATTEMPTS || elapsed + AUTO_RETRY_INTERVAL_MS > AUTO_RETRY_WINDOW_MS) {
      // Budget spent — hand control back to the user
      setRetryExhausted(true);
      setRetryState(null);
      return;
    }

    const attempt = retryAttemptRef.current + 1;
    let secondsLeft = AUTO_RETRY_INTERVAL_MS / 1000;
    setRetryExhausted(false);
    setRetryState({ attempt, secondsLeft });
    retryTimerRef.current = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearRetryTimer();
        retryAttemptRef.current = attempt;
        handleReconnect();
      } else {
        setRetryState({ attempt, secondsLeft });
      }
    }, 1000);

    return clearRetryTimer;
  }, [errorMsg, failureSeq, isConnected, isConnecting, autoRetryEnabled, clearRetryTimer, handleReconnect]);

  // Auto-scroll debug panel when new logs arrive
  useEffect(() => {
    if (debugOpen && debugEndRef.current) {
      debugEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [debugLogs, debugOpen]);

  // Cleanup hint timer
  useEffect(() => {
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-surface-950 min-h-0" onMouseMove={handleContainerMouseMove}>
      {/* ── Title bar (visible by default) ── */}
      {showToolbar && (
        <div className="flex items-center justify-between h-10 bg-surface-900 border-b border-surface-700/50 shrink-0 drag-region select-none">
          {/* Left: app branding + connection info */}
          <div className="flex items-center gap-2.5 pl-3 no-drag">
            <Monitor className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-semibold text-surface-200 tracking-tight">RDPea</span>
            <span className="text-surface-600 text-xs">│</span>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-surface-600'}`} />
            <span className="text-xs text-surface-400 truncate max-w-[200px]">
              {isConnecting ? 'Connecting…' : isConnected ? 'Connected' : retryState ? `Retrying in ${retryState.secondsLeft}s` : 'Disconnected'}
              {connectionId && ` — ${connectionId.slice(0, 8)}`}
            </span>
          </div>

          {/* Center controls */}
          <div className="flex items-center gap-0.5 no-drag">
            <button
              onClick={toggleAudio}
              className={`p-1.5 rounded transition-colors ${
                audioEnabled ? 'text-primary-400 hover:bg-primary-500/20' : 'text-surface-500 hover:bg-surface-700'
              }`}
              title={audioEnabled ? 'Mute audio' : 'Unmute audio'}
            >
              {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handlePin}
              className={`p-1.5 rounded transition-colors ${
                isPinned ? 'text-primary-400 hover:bg-primary-500/20' : 'text-surface-400 hover:bg-surface-700'
              }`}
              title={isPinned ? 'Unpin window' : 'Pin window on top'}
            >
              {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={hideToolbar}
              className="p-1.5 rounded text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors"
              title="Hide toolbar (move mouse to top edge to show again)"
            >
              <PanelTopClose className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: window controls */}
          <div className="flex items-center no-drag">
            <button
              onClick={() => window.rdpea?.minimize()}
              className="px-3 h-10 text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors flex items-center justify-center"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFullscreen}
              className="px-3 h-10 text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors flex items-center justify-center"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={() => window.rdpea?.close()}
              className="px-3 h-10 text-surface-400 hover:bg-red-500/80 hover:text-white transition-colors flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Toolbar-hidden hint strip ── */}
      {!showToolbar && toolbarHint && (
        <div
          className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 h-8 bg-surface-900/90 backdrop-blur-sm border-b border-surface-700/50 cursor-pointer select-none transition-opacity"
          onClick={() => { setShowToolbar(true); setToolbarHint(false); }}
        >
          <PanelTop className="w-3.5 h-3.5 text-primary-400" />
          <span className="text-xs text-surface-300">Click to show toolbar</span>
        </div>
      )}

      {/* ── Session canvas / status area ── */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-black relative overflow-hidden min-h-0"
        tabIndex={0}
      >
        {isConnected ? (
          <canvas
            ref={canvasRef}
            className="absolute cursor-default"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : isConnecting ? (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-primary-400 mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-medium text-surface-300 mb-1">Connecting…</h3>
            <p className="text-sm text-surface-500">
              {retryAttemptRef.current > 0
                ? `Retry attempt ${retryAttemptRef.current} of ${AUTO_RETRY_MAX_ATTEMPTS}`
                : 'Establishing RDP connection'}
            </p>
          </div>
        ) : (
          <div className="text-center max-w-md">
            <div className="w-20 h-20 rounded-2xl bg-surface-900/60 border border-surface-700/50 flex items-center justify-center mx-auto mb-4">
              <WifiOff className="w-10 h-10 text-surface-600" />
            </div>
            <h3 className="text-lg font-medium text-surface-400 mb-1">
              {errorMsg ? 'Connection Failed' : 'Disconnected'}
            </h3>
            {errorMsg && (
              <p className="text-xs text-red-400/80 mt-3 font-mono bg-red-950/30 rounded px-3 py-2 text-left break-all">
                {errorMsg}
              </p>
            )}
            {retryState && (
              <p className="text-sm text-surface-400 mt-4">
                Retrying automatically in <span className="text-surface-200 tabular-nums">{retryState.secondsLeft}s</span>
                <span className="text-surface-600"> · attempt {retryState.attempt} of {AUTO_RETRY_MAX_ATTEMPTS}</span>
              </p>
            )}
            {!retryState && errorMsg && retryExhausted && (
              <p className="text-xs text-surface-500 mt-4">
                Automatic retries stopped after {AUTO_RETRY_WINDOW_MS / 60_000} minutes.
              </p>
            )}
            <div className="flex items-center justify-center gap-2 mt-5">
              <button
                onClick={handleManualRetry}
                className="px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium transition-colors shadow-lg shadow-primary-900/30"
              >
                {retryState ? 'Retry Now' : errorMsg ? 'Retry Connection' : 'Reconnect'}
              </button>
              {retryState && (
                <button
                  onClick={stopAutoRetry}
                  className="px-4 py-2.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 text-sm font-medium transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Debug log panel ── */}
      {debugMode && (
        <div className="shrink-0 bg-surface-950 border-t border-surface-700/50">
          <div
            className="flex items-center justify-between px-3 py-1 cursor-pointer select-none hover:bg-surface-900/60"
            onClick={() => setDebugOpen(prev => !prev)}
          >
            <div className="flex items-center gap-2">
              <Bug className="w-3 h-3 text-amber-400" />
              <span className="text-xs font-medium text-surface-400">Debug Log</span>
              <span className="text-xs text-surface-600">({debugLogs.length})</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); setDebugLogs([]); }}
                className="text-xs text-surface-500 hover:text-surface-300 px-1"
              >
                Clear
              </button>
              {debugOpen ? <ChevronDown className="w-3 h-3 text-surface-500" /> : <ChevronUp className="w-3 h-3 text-surface-500" />}
            </div>
          </div>
          {debugOpen && (
            <div className="h-40 overflow-y-auto font-mono text-[10px] leading-4 text-surface-400 px-3 pb-2 scrollbar-thin">
              {debugLogs.map((line, i) => (
                <div key={i} className={line.includes('ERROR') ? 'text-red-400' : ''}>{line}</div>
              ))}
              <div ref={debugEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
