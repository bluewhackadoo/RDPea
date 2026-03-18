import {
  Monitor, FolderOpen, Plus, Search, LayoutGrid, List,
  ChevronDown, ChevronRight, Settings,
} from 'lucide-react';
import { ViewMode } from '../types';

interface SidebarProps {
  groups: string[];
  selectedGroup: string | null;
  onSelectGroup: (group: string | null) => void;
  totalConnections: number;
  activeCount: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAddConnection: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function Sidebar({
  groups,
  selectedGroup,
  onSelectGroup,
  totalConnections,
  activeCount,
  viewMode,
  onViewModeChange,
  onAddConnection,
  searchQuery,
  onSearchChange,
}: SidebarProps) {
  return (
    <aside className="w-60 shrink-0 border-r border-surface-700/50 bg-surface-900/40 flex flex-col">
      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
          <input
            type="text"
            placeholder="Search connections..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input-field pl-8 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="px-3 pb-3 flex gap-2">
        <div className="flex-1 glass rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-surface-100">{totalConnections}</div>
          <div className="text-[10px] text-surface-500 uppercase tracking-wider">Saved</div>
        </div>
        <div className="flex-1 glass rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-emerald-400">{activeCount}</div>
          <div className="text-[10px] text-surface-500 uppercase tracking-wider">Active</div>
        </div>
      </div>

      {/* View toggle */}
      <div className="px-3 pb-2 flex gap-1">
        <button
          onClick={() => onViewModeChange('grid')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            viewMode === 'grid'
              ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
              : 'text-surface-400 hover:bg-surface-800'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Grid
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            viewMode === 'list'
              ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
              : 'text-surface-400 hover:bg-surface-800'
          }`}
        >
          <List className="w-3.5 h-3.5" /> List
        </button>
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="text-[10px] text-surface-500 uppercase tracking-wider font-semibold px-2 mb-1">
          Groups
        </div>

        <button
          onClick={() => onSelectGroup(null)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            selectedGroup === null
              ? 'bg-primary-600/15 text-primary-400'
              : 'text-surface-300 hover:bg-surface-800'
          }`}
        >
          <Monitor className="w-4 h-4" />
          <span>All Connections</span>
        </button>

        {groups.map((group) => (
          <button
            key={group}
            onClick={() => onSelectGroup(group)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
              selectedGroup === group
                ? 'bg-primary-600/15 text-primary-400'
                : 'text-surface-300 hover:bg-surface-800'
            }`}
          >
            {selectedGroup === group ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <FolderOpen className="w-4 h-4" />
            <span className="truncate">{group}</span>
          </button>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t border-surface-700/50 space-y-2">
        <button
          onClick={onAddConnection}
          className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
        >
          <Plus className="w-4 h-4" />
          New Connection
        </button>
      </div>
    </aside>
  );
}
