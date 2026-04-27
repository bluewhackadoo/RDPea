import { useState, useEffect } from 'react';
import { Minus, Square, X, Pin, PinOff, Monitor, Bug } from 'lucide-react';

import { tauri } from '../lib/tauri';
export function TitleBar() {
  const [isPinned, setIsPinned] = useState(false);
  const [debugGlobal, setDebugGlobal] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.rdpea?.getAppVersion().then((v: string) => setAppVersion(v));
  }, []);

  const handlePin = () => {
    const next = !isPinned;
    setIsPinned(next);
    window.rdpea?.pin(next);
  };

  const handleDebugToggle = () => {
    const next = !debugGlobal;
    setDebugGlobal(next);
    window.rdpea?.setDebugGlobal(next);
  };

  return (
    <div className="drag-region flex items-center justify-between h-9 bg-surface-900/80 border-b border-surface-700/50 px-3 select-none shrink-0">
      <div className="flex items-center gap-2 no-drag">
        <div className="flex items-center gap-1.5">
          <Monitor className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-semibold text-surface-200 tracking-tight">
            RDPea
          </span>
          {appVersion && (
            <span className="text-[10px] text-surface-500 font-medium">v{appVersion}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 no-drag">
        <button
          onClick={handleDebugToggle}
          className={`p-1.5 rounded transition-colors ${
            debugGlobal ? 'text-amber-400 hover:bg-amber-500/20' : 'text-surface-400 hover:bg-surface-700 hover:text-surface-200'
          }`}
          title={debugGlobal ? 'Disable debug logging (all sessions)' : 'Enable debug logging (all sessions)'}
        >
          <Bug className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handlePin}
          className={`p-1.5 rounded transition-colors ${
            isPinned
              ? 'text-primary-400 hover:bg-primary-500/20'
              : 'text-surface-400 hover:bg-surface-700 hover:text-surface-200'
          }`}
          title={isPinned ? 'Unpin window' : 'Pin window on top'}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => window.rdpea?.minimize()}
          className="p-1.5 rounded text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => window.rdpea?.maximize()}
          className="p-1.5 rounded text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>

        <button
          onClick={() => window.rdpea?.close()}
          className="p-1.5 rounded text-surface-400 hover:bg-red-500/80 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
