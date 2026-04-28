import { useState, useEffect, useRef } from 'react';
import { Monitor, Plus, Zap, Bug, ChevronDown, ChevronUp } from 'lucide-react';
import { useConnections, createDefaultConnection } from '../hooks/useConnections';
import { RdpConnection } from '../types';
import { Sidebar } from './Sidebar';
import { ConnectionCard } from './ConnectionCard';
import { ConnectionForm } from './ConnectionForm';

import { tauri } from '../lib/tauri';
export function Dashboard() {
  const {
    connections,
    allConnections,
    activeConnections,
    groups,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    selectedGroup,
    setSelectedGroup,
    isLoading,
    addConnection,
    updateConnection,
    deleteConnection,
    duplicateConnection,
    connectTo,
    disconnectFrom,
    togglePin,
  } = useConnections();

  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RdpConnection | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [debugGlobal, setDebugGlobal] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const debugEndRef = useRef<HTMLDivElement>(null);
  const MAX_DEBUG_LINES = 500;

  useEffect(() => {
    tauri.getDebugGlobal().then(setDebugGlobal);
    const unsubGlobal = tauri.onDebugGlobal((enabled) => setDebugGlobal(enabled));
    const unsubLog = tauri.onDebugLog((_id, msg) => {
      setDebugLogs(prev => {
        const next = [...prev, msg];
        return next.length > MAX_DEBUG_LINES ? next.slice(-MAX_DEBUG_LINES) : next;
      });
    });
    return () => { unsubGlobal(); unsubLog(); };
  }, []);

  useEffect(() => {
    if (debugOpen && debugEndRef.current) {
      debugEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [debugLogs, debugOpen]);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSave = (conn: RdpConnection) => {
    if (editingConnection) {
      updateConnection(conn.id, conn);
      showNotification(`"${conn.name}" updated`);
    } else {
      addConnection(conn);
      showNotification(`"${conn.name}" created`);
    }
    setShowForm(false);
    setEditingConnection(null);
  };

  const handleEdit = (conn: RdpConnection) => {
    setEditingConnection(conn);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    const conn = allConnections.find((c) => c.id === id);
    deleteConnection(id);
    showNotification(`"${conn?.name}" deleted`);
  };

  const handleConnect = async (id: string) => {
    const result = await connectTo(id);
    if (result && !result.success) {
      showNotification(result.error || 'Connection failed', 'error');
    } else {
      const conn = allConnections.find((c) => c.id === id);
      showNotification(`Connecting to "${conn?.name}"...`);
    }
  };

  const handleOpenWindow = (id: string, name: string) => {
    tauri.openSessionWindow(id, name);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 animate-pulse-slow">
          <Monitor className="w-12 h-12 text-primary-400" />
          <span className="text-surface-400 text-sm">Loading connections...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <Sidebar
        groups={groups}
        selectedGroup={selectedGroup}
        onSelectGroup={setSelectedGroup}
        totalConnections={allConnections.length}
        activeCount={activeConnections.size}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAddConnection={() => { setEditingConnection(null); setShowForm(true); }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-surface-100">
              {selectedGroup || 'All Connections'}
            </h1>
            <p className="text-sm text-surface-500 mt-0.5">
              {connections.length} connection{connections.length !== 1 ? 's' : ''}
              {activeConnections.size > 0 && (
                <span className="text-emerald-400 ml-2">
                  <Zap className="w-3 h-3 inline" /> {activeConnections.size} active
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => { setEditingConnection(null); setShowForm(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Connection
          </button>
        </div>

        {/* Connection grid/list */}
        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-800/60 border border-surface-700/50 flex items-center justify-center mb-4">
              <Monitor className="w-8 h-8 text-surface-500" />
            </div>
            <h3 className="text-lg font-medium text-surface-300 mb-1">No connections yet</h3>
            <p className="text-sm text-surface-500 mb-4 max-w-sm">
              Add your first remote desktop connection to get started. Credentials are encrypted locally.
            </p>
            <button
              onClick={() => { setEditingConnection(null); setShowForm(true); }}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Connection
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                isActive={activeConnections.has(conn.id)}
                isGrid={true}
                onConnect={handleConnect}
                onDisconnect={disconnectFrom}
                onEdit={handleEdit}
                onDuplicate={duplicateConnection}
                onDelete={handleDelete}
                onTogglePin={togglePin}
                onOpenWindow={handleOpenWindow}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                isActive={activeConnections.has(conn.id)}
                isGrid={false}
                onConnect={handleConnect}
                onDisconnect={disconnectFrom}
                onEdit={handleEdit}
                onDuplicate={duplicateConnection}
                onDelete={handleDelete}
                onTogglePin={togglePin}
                onOpenWindow={handleOpenWindow}
              />
            ))}
          </div>
        )}
      </main>

      {/* Connection form modal */}
      {showForm && (
        <ConnectionForm
          connection={editingConnection}
          groups={groups.length > 0 ? groups : ['Default']}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingConnection(null); }}
        />
      )}

      {/* Notification toast */}
      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 animate-slide-up ${
          notification.type === 'error'
            ? 'bg-red-600/90 border-red-500/50'
            : 'bg-emerald-600/90 border-emerald-500/50'
        } backdrop-blur-lg border rounded-lg px-4 py-2.5 text-sm text-white shadow-xl`}>
          {notification.message}
        </div>
      )}
      {/* Debug log panel — shown at bottom when global debug is on */}
      {debugGlobal && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-950 border-t border-surface-700/50 shadow-2xl">
          <div
            className="flex items-center justify-between px-4 py-1.5 cursor-pointer select-none hover:bg-surface-900/60"
            onClick={() => setDebugOpen(prev => !prev)}
          >
            <div className="flex items-center gap-2">
              <Bug className="w-3 h-3 text-amber-400" />
              <span className="text-xs font-medium text-surface-400">Debug Log</span>
              <span className="text-xs text-surface-600">({debugLogs.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setDebugLogs([]); }}
                className="text-xs text-surface-500 hover:text-surface-300 px-1"
              >
                Clear
              </button>
              {debugOpen
                ? <ChevronDown className="w-3 h-3 text-surface-500" />
                : <ChevronUp className="w-3 h-3 text-surface-500" />}
            </div>
          </div>
          {debugOpen && (
            <div className="h-44 overflow-y-auto font-mono text-[10px] leading-4 text-surface-400 px-4 pb-2 scrollbar-thin">
              {debugLogs.length === 0
                ? <div className="text-surface-600 italic pt-1">Waiting for connection logs...</div>
                : debugLogs.map((line, i) => (
                  <div key={i} className={line.includes('failed') || line.includes('error') || line.includes('Error') ? 'text-red-400' : ''}>{line}</div>
                ))
              }
              <div ref={debugEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
