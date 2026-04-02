import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { RdpConnection, ViewMode, SortField, SortDirection } from '../types';

const CONNECTION_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#e11d48',
];

function getRandomColor(): string {
  return CONNECTION_COLORS[Math.floor(Math.random() * CONNECTION_COLORS.length)];
}

export function createDefaultConnection(partial?: Partial<RdpConnection>): RdpConnection {
  return {
    id: uuidv4(),
    name: '',
    host: '',
    port: 3389,
    username: '',
    password: '',
    domain: '',
    gateway: '',
    width: 1920,
    height: 1080,
    colorDepth: 32,
    audioMode: 'local',
    redirectClipboard: true,
    redirectDrives: false,
    redirectPrinters: false,
    captureWindowsKey: false,
    hyperVEnabled: false,
    hyperVHost: '',
    hyperVVmName: '',
    group: 'Default',
    notes: '',
    tags: [],
    pinned: false,
    lastConnected: null,
    createdAt: new Date().toISOString(),
    color: getRandomColor(),
    ...partial,
  };
}

export function useConnections() {
  const [connections, setConnections] = useState<RdpConnection[]>([]);
  const [activeConnections, setActiveConnections] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load connections from encrypted storage
  useEffect(() => {
    async function load() {
      try {
        if (window.rdpea) {
          const loaded = await window.rdpea.loadConnections();
          setConnections(loaded || []);
        }
      } catch (e) {
        console.error('Failed to load connections:', e);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // Listen for disconnection events
  useEffect(() => {
    if (!window.rdpea) return;
    const unsub = window.rdpea.onDisconnected((connectionId: string) => {
      setActiveConnections((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    });
    return unsub;
  }, []);

  // Debounced save to encrypted storage
  const persistConnections = useCallback((conns: RdpConnection[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (window.rdpea) {
        window.rdpea.saveConnections(conns);
      }
    }, 500);
  }, []);

  const addConnection = useCallback((conn: RdpConnection) => {
    setConnections((prev) => {
      const next = [...prev, conn];
      persistConnections(next);
      return next;
    });
  }, [persistConnections]);

  const updateConnection = useCallback((id: string, updates: Partial<RdpConnection>) => {
    setConnections((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...updates } : c));
      persistConnections(next);
      return next;
    });
  }, [persistConnections]);

  const deleteConnection = useCallback((id: string) => {
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistConnections(next);
      return next;
    });
  }, [persistConnections]);

  const duplicateConnection = useCallback((id: string) => {
    setConnections((prev) => {
      const source = prev.find((c) => c.id === id);
      if (!source) return prev;
      const copy = {
        ...source,
        id: uuidv4(),
        name: `${source.name} (Copy)`,
        createdAt: new Date().toISOString(),
        lastConnected: null,
      };
      const next = [...prev, copy];
      persistConnections(next);
      return next;
    });
  }, [persistConnections]);

  const connectTo = useCallback(async (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn || !window.rdpea) return;

    const result = await window.rdpea.connect(conn);
    if (result.success) {
      setActiveConnections((prev) => new Set(prev).add(id));
      updateConnection(id, { lastConnected: new Date().toISOString() });
    }
    return result;
  }, [connections, updateConnection]);

  const disconnectFrom = useCallback(async (id: string) => {
    if (!window.rdpea) return;
    await window.rdpea.disconnect(id);
    setActiveConnections((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const togglePin = useCallback((id: string) => {
    setConnections((prev) => {
      const next = prev.map((c) =>
        c.id === id ? { ...c, pinned: !c.pinned } : c
      );
      persistConnections(next);
      return next;
    });
  }, [persistConnections]);

  // Derived: groups
  const groups = [...new Set(connections.map((c) => c.group || 'Default'))].sort();

  // Derived: filtered and sorted
  const filteredConnections = connections
    .filter((c) => {
      if (selectedGroup && c.group !== selectedGroup) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      // Pinned always first
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const dir = sortDirection === 'asc' ? 1 : -1;
      const av = a[sortField] || '';
      const bv = b[sortField] || '';
      return av < bv ? -dir : av > bv ? dir : 0;
    });

  return {
    connections: filteredConnections,
    allConnections: connections,
    activeConnections,
    groups,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
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
  };
}
