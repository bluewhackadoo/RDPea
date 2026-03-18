import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Pin, PinOff, Maximize2, Volume2, VolumeX,
  WifiOff, ArrowLeft, Loader2, Minus, Square, X,
  Monitor, PanelTopClose, PanelTop,
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

export function SessionView() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const mouseMoveTimeRef = useRef<number>(0);
  const lastHintRef = useRef(false);
  const imgBufRef = useRef<Uint8ClampedArray | null>(null);

  const [isPinned, setIsPinned] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true); // Start as connecting since window opens on connect
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [showToolbar, setShowToolbar] = useState(true);
  const [toolbarHint, setToolbarHint] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Frame rendering with requestAnimationFrame batching ─────────
  const pendingRectsRef = useRef<BitmapRectIPC[]>([]);
  const rafIdRef = useRef<number>(0);

  const flushFrames = useCallback(() => {
    rafIdRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canvasCtxRef.current) canvasCtxRef.current = canvas.getContext('2d');
    const ctx = canvasCtxRef.current;
    if (!ctx) return;

    const rects = pendingRectsRef.current;
    pendingRectsRef.current = [];

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      try {
        const src = rect.data;
        const needed = src.length;
        // Reuse buffer if same size, otherwise allocate new one
        let bytes = imgBufRef.current;
        if (!bytes || bytes.length !== needed) {
          bytes = new Uint8ClampedArray(new ArrayBuffer(needed));
          imgBufRef.current = bytes;
        }
        bytes.set(src);
        const imgData = new ImageData(new Uint8ClampedArray(bytes.buffer as ArrayBuffer), rect.width, rect.height);
        ctx.putImageData(imgData, rect.x, rect.y);
      } catch {
        // skip bad frame
      }
    }
  }, []);

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
        if (info?.width && info?.height) setCanvasSize({ width: info.width, height: info.height });
      }
    });
    const unsubDisconnected = window.rdpea.onDisconnected((id) => {
      if (id === connectionId) { setIsConnected(false); setIsConnecting(false); }
    });
    const unsubError = window.rdpea.onError((id, msg) => {
      if (id === connectionId) { setErrorMsg(msg); setIsConnecting(false); }
    });

    // Check initial status
    window.rdpea.getStatus(connectionId).then(setIsConnected);

    return () => {
      unsubFrame(); unsubAudio(); unsubConnected(); unsubDisconnected(); unsubError();
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
      window.rdpea.sendKeyboard(connectionId, type, mapping.code, mapping.extended);
    };

    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('keyup', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('keyup', handleKey, true);
    };
  }, [connectionId, isConnected, ensureAudioCtx]);

  // ── Mouse input ──────────────────────────────────────────────────
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
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

  const handleReconnect = async () => {
    if (!connectionId || !window.rdpea) return;
    setErrorMsg(null);
    setIsConnecting(true);
    try {
      const connections = await window.rdpea.loadConnections();
      const conn = connections.find((c: any) => c.id === connectionId);
      if (conn) {
        await window.rdpea.connect(conn);
      }
    } catch {
      setIsConnecting(false);
    }
  };

  // Cleanup hint timer
  useEffect(() => {
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-surface-950" onMouseMove={handleContainerMouseMove}>
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
              {isConnecting ? 'Connecting…' : isConnected ? 'Connected' : 'Disconnected'}
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
        className="flex-1 flex items-center justify-center bg-black relative overflow-hidden"
        tabIndex={0}
      >
        {isConnected ? (
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className="max-w-full max-h-full object-contain cursor-default"
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
            <p className="text-sm text-surface-500">Establishing RDP connection</p>
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
            <button
              onClick={handleReconnect}
              className="mt-5 px-6 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium transition-colors shadow-lg shadow-primary-900/30"
            >
              {errorMsg ? 'Retry Connection' : 'Reconnect'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
