import { useEffect, useState } from 'react';
import { Download, CheckCircle, AlertCircle } from 'lucide-react';

type UpdateStatus = 
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'downloading'; percent: number }
  | { type: 'ready'; version: string }
  | { type: 'error'; message: string }
  | { type: 'none' };

export function UpdateNotification() {
  const [status, setStatus] = useState<UpdateStatus>({ type: 'none' });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsubChecking = window.rdpea.onUpdateChecking(() => {
      setStatus({ type: 'checking' });
      setVisible(true);
    });

    const unsubAvailable = window.rdpea.onUpdateAvailable((version: string) => {
      setStatus({ type: 'available', version });
      setVisible(true);
    });

    const unsubNotAvailable = window.rdpea.onUpdateNotAvailable(() => {
      setStatus({ type: 'none' });
      setVisible(false);
    });

    const unsubProgress = window.rdpea.onUpdateProgress((percent: number) => {
      setStatus({ type: 'downloading', percent });
      setVisible(true);
    });

    const unsubReady = window.rdpea.onUpdateReady((version: string) => {
      setStatus({ type: 'ready', version });
      setVisible(true);
    });

    const unsubError = window.rdpea.onUpdateError((message: string) => {
      setStatus({ type: 'error', message });
      setVisible(true);
      // Hide error after 10 seconds
      setTimeout(() => setVisible(false), 10000);
    });

    return () => {
      unsubChecking();
      unsubAvailable();
      unsubNotAvailable();
      unsubProgress();
      unsubReady();
      unsubError();
    };
  }, []);

  if (!visible || status.type === 'none') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-slate-800/95 backdrop-blur-sm border border-slate-700 rounded-lg shadow-xl px-4 py-3 min-w-[280px] max-w-[320px]">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0 mt-0.5">
            {status.type === 'checking' && (
              <Download className="w-4 h-4 text-blue-400 animate-pulse" />
            )}
            {status.type === 'available' && (
              <Download className="w-4 h-4 text-blue-400" />
            )}
            {status.type === 'downloading' && (
              <Download className="w-4 h-4 text-blue-400 animate-bounce" />
            )}
            {status.type === 'ready' && (
              <CheckCircle className="w-4 h-4 text-green-400" />
            )}
            {status.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-red-400" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {status.type === 'checking' && (
              <div className="text-xs text-slate-300">
                Checking for updates...
              </div>
            )}

            {status.type === 'available' && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-200">
                  Update Available
                </div>
                <div className="text-xs text-slate-400">
                  v{status.version} is downloading
                </div>
              </div>
            )}

            {status.type === 'downloading' && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-200">
                  Downloading Update
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                      style={{ width: `${status.percent}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    {status.percent}%
                  </div>
                </div>
              </div>
            )}

            {status.type === 'ready' && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-green-400">
                  Update Ready
                </div>
                <div className="text-xs text-slate-400">
                  v{status.version} will install on restart
                </div>
              </div>
            )}

            {status.type === 'error' && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-red-400">
                  Update Failed
                </div>
                <div className="text-xs text-slate-400 line-clamp-2">
                  {status.message}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
