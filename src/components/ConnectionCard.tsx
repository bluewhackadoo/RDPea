import { useState } from 'react';
import {
  Play, Square, Pin, PinOff, Copy, Trash2, Edit3,
  ExternalLink, MoreHorizontal, Monitor, Globe, User,
  Clock, Volume2,
} from 'lucide-react';
import { RdpConnection } from '../types';

interface ConnectionCardProps {
  connection: RdpConnection;
  isActive: boolean;
  isGrid: boolean;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onEdit: (connection: RdpConnection) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onOpenWindow: (id: string, name: string) => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ConnectionCard({
  connection,
  isActive,
  isGrid,
  onConnect,
  onDisconnect,
  onEdit,
  onDuplicate,
  onDelete,
  onTogglePin,
  onOpenWindow,
}: ConnectionCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await onConnect(connection.id);
    } finally {
      setTimeout(() => setIsConnecting(false), 1500);
    }
  };

  const audioIcon = connection.audioMode !== 'none';

  if (!isGrid) {
    // ── List View ──
    return (
      <div className="glass glass-hover rounded-lg px-4 py-3 flex items-center gap-4 animate-fade-in group">
        {/* Color indicator */}
        <div
          className="w-1 h-10 rounded-full shrink-0"
          style={{ backgroundColor: connection.color }}
        />

        {/* Status dot */}
        <div className={isActive ? 'connection-dot-active' : 'connection-dot-idle'} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-surface-100 truncate">{connection.name || connection.host}</span>
            {connection.pinned && <Pin className="w-3 h-3 text-primary-400 shrink-0" />}
          </div>
          <div className="flex items-center gap-3 text-xs text-surface-500 mt-0.5">
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3" />
              {connection.host}:{connection.port}
            </span>
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {connection.username || '—'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(connection.lastConnected)}
            </span>
            {audioIcon && <Volume2 className="w-3 h-3 text-primary-400" />}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isActive ? (
            <button onClick={() => onDisconnect(connection.id)} className="btn-ghost text-red-400 text-xs flex items-center gap-1">
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="btn-primary text-xs flex items-center gap-1 py-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          <button onClick={() => onEdit(connection)} className="btn-ghost p-1.5">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onTogglePin(connection.id)} className="btn-ghost p-1.5">
            {connection.pinned ? <PinOff className="w-3.5 h-3.5 text-primary-400" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  // ── Grid View ──
  return (
    <div className="glass glass-hover rounded-xl overflow-hidden animate-slide-up group relative">
      {/* Header with color */}
      <div className="h-2" style={{ backgroundColor: connection.color }} />

      <div className="p-4">
        {/* Top row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`${isActive ? 'connection-dot-active' : 'connection-dot-idle'}`} />
            <Monitor className="w-5 h-5 text-surface-400" />
          </div>
          <div className="flex items-center gap-1">
            {connection.pinned && (
              <Pin className="w-3.5 h-3.5 text-primary-400" />
            )}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="btn-ghost p-1"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 glass rounded-lg py-1 z-50 shadow-xl animate-fade-in">
                  <button
                    onClick={() => { onEdit(connection); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-surface-300 hover:bg-surface-700 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => { onTogglePin(connection.id); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-surface-300 hover:bg-surface-700 transition-colors"
                  >
                    {connection.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    {connection.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    onClick={() => { onOpenWindow(connection.id, connection.name); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-surface-300 hover:bg-surface-700 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open Window
                  </button>
                  <button
                    onClick={() => { onDuplicate(connection.id); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-surface-300 hover:bg-surface-700 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" /> Duplicate
                  </button>
                  <hr className="border-surface-700 my-1" />
                  <button
                    onClick={() => { onDelete(connection.id); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Name */}
        <h3 className="text-base font-semibold text-surface-100 truncate mb-1">
          {connection.name || connection.host}
        </h3>

        {/* Details */}
        <div className="space-y-1 mb-4">
          <div className="flex items-center gap-1.5 text-xs text-surface-400">
            <Globe className="w-3 h-3" />
            <span className="truncate">{connection.host}:{connection.port}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-surface-400">
            <User className="w-3 h-3" />
            <span className="truncate">{connection.domain ? `${connection.domain}\\` : ''}{connection.username || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <Clock className="w-3 h-3" />
            <span>{timeAgo(connection.lastConnected)}</span>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {isActive && <span className="badge-success">Connected</span>}
          {audioIcon && (
            <span className="badge-info flex items-center gap-1">
              <Volume2 className="w-3 h-3" /> Audio
            </span>
          )}
          {connection.redirectClipboard && (
            <span className="badge-info">Clipboard</span>
          )}
          {connection.tags.map((tag) => (
            <span key={tag} className="badge bg-surface-700/60 text-surface-400 border border-surface-600/40">
              {tag}
            </span>
          ))}
        </div>

        {/* Connect button */}
        {isActive ? (
          <button
            onClick={() => onDisconnect(connection.id)}
            className="btn-danger w-full flex items-center justify-center gap-2 text-sm"
          >
            <Square className="w-4 h-4" /> Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-60"
          >
            <Play className="w-4 h-4" />
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}
