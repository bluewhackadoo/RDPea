import { useState } from 'react';
import {
  X, Save, Monitor, Globe, User, Lock, Shield, Volume2,
  Clipboard, HardDrive, Printer, Tag, FileText, Palette,
  Keyboard, Server,
} from 'lucide-react';
import { RdpConnection } from '../types';
import { createDefaultConnection } from '../hooks/useConnections';

interface ConnectionFormProps {
  connection?: RdpConnection | null;
  groups: string[];
  onSave: (connection: RdpConnection) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#e11d48',
  '#84cc16', '#a855f7',
];

type TabName = 'general' | 'display' | 'resources' | 'hyperv' | 'gateway' | 'notes';

export function ConnectionForm({ connection, groups, onSave, onCancel }: ConnectionFormProps) {
  const [form, setForm] = useState<RdpConnection>(
    connection || createDefaultConnection()
  );
  const [activeTab, setActiveTab] = useState<TabName>('general');
  const [newTag, setNewTag] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);

  const update = <K extends keyof RdpConnection>(key: K, value: RdpConnection[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addTag = () => {
    if (newTag.trim() && !form.tags.includes(newTag.trim())) {
      update('tags', [...form.tags, newTag.trim()]);
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    update('tags', form.tags.filter((t) => t !== tag));
  };

  const handleSave = () => {
    if (!form.host.trim()) return;
    if (!form.name.trim()) {
      form.name = form.host;
    }
    onSave(form);
  };

  const tabs: { key: TabName; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'display', label: 'Display' },
    { key: 'resources', label: 'Resources' },
    { key: 'hyperv', label: 'Hyper-V' },
    { key: 'gateway', label: 'Gateway' },
    { key: 'notes', label: 'Notes' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700/50">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: form.color }} />
            <h2 className="text-lg font-semibold text-surface-100">
              {connection ? 'Edit Connection' : 'New Connection'}
            </h2>
          </div>
          <button onClick={onCancel} className="btn-ghost p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700/50 px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'text-primary-400 border-primary-400'
                  : 'text-surface-400 border-transparent hover:text-surface-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'general' && (
            <>
              {/* Name & Color */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-surface-400 mb-1">
                    <Monitor className="w-3 h-3 inline mr-1" /> Connection Name
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="My Server"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">
                    <Palette className="w-3 h-3 inline mr-1" /> Color
                  </label>
                  <div className="flex gap-1 flex-wrap max-w-[140px]">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => update('color', c)}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          form.color === c ? 'scale-125 ring-2 ring-white/50' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Host & Port */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-surface-400 mb-1">
                    <Globe className="w-3 h-3 inline mr-1" /> Host / IP
                  </label>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => update('host', e.target.value)}
                    placeholder="192.168.1.100 or server.domain.com"
                    className="input-field"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-xs font-medium text-surface-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => update('port', parseInt(e.target.value) || 3389)}
                    className="input-field"
                  />
                </div>
              </div>

              {/* Username, Password, Domain */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">
                    <User className="w-3 h-3 inline mr-1" /> Username
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => update('username', e.target.value)}
                    placeholder="admin"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">
                    <Lock className="w-3 h-3 inline mr-1" /> Password
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    placeholder="••••••••"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">
                    <Shield className="w-3 h-3 inline mr-1" /> Domain
                  </label>
                  <input
                    type="text"
                    value={form.domain}
                    onChange={(e) => update('domain', e.target.value)}
                    placeholder="WORKGROUP"
                    className="input-field"
                  />
                </div>
              </div>

              {/* Group */}
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Group</label>
                {showNewGroup ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newGroup}
                      onChange={(e) => setNewGroup(e.target.value)}
                      placeholder="New group name"
                      className="input-field flex-1"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        if (newGroup.trim()) {
                          update('group', newGroup.trim());
                          setShowNewGroup(false);
                        }
                      }}
                      className="btn-primary text-sm"
                    >
                      Add
                    </button>
                    <button onClick={() => setShowNewGroup(false)} className="btn-ghost text-sm">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={form.group}
                      onChange={(e) => update('group', e.target.value)}
                      className="input-field flex-1"
                    >
                      {groups.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                      {!groups.includes(form.group) && (
                        <option value={form.group}>{form.group}</option>
                      )}
                    </select>
                    <button onClick={() => setShowNewGroup(true)} className="btn-ghost text-sm whitespace-nowrap">
                      + New Group
                    </button>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">
                  <Tag className="w-3 h-3 inline mr-1" /> Tags
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.tags.map((tag) => (
                    <span
                      key={tag}
                      className="badge bg-surface-700/60 text-surface-300 border border-surface-600/40 cursor-pointer hover:border-red-500/50 hover:text-red-400 transition-colors"
                      onClick={() => removeTag(tag)}
                    >
                      {tag} ×
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTag()}
                    placeholder="Add tag..."
                    className="input-field flex-1"
                  />
                  <button onClick={addTag} className="btn-ghost text-sm">Add</button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'display' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">Width</label>
                  <input
                    type="number"
                    value={form.width}
                    onChange={(e) => update('width', parseInt(e.target.value) || 1920)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1">Height</label>
                  <input
                    type="number"
                    value={form.height}
                    onChange={(e) => update('height', parseInt(e.target.value) || 1080)}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Color Depth</label>
                <select
                  value={form.colorDepth}
                  onChange={(e) => update('colorDepth', parseInt(e.target.value) as 16 | 24 | 32)}
                  className="input-field"
                >
                  <option value={16}>16-bit (High Color)</option>
                  <option value={24}>24-bit (True Color)</option>
                  <option value={32}>32-bit (Highest Quality)</option>
                </select>
              </div>

              <div className="p-3 glass rounded-lg text-sm text-surface-400">
                <p>Resolution will dynamically adapt when the session window is resized. The values above set the initial resolution.</p>
              </div>
            </>
          )}

          {activeTab === 'resources' && (
            <>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">
                  <Volume2 className="w-3 h-3 inline mr-1" /> Audio
                </label>
                <select
                  value={form.audioMode}
                  onChange={(e) => update('audioMode', e.target.value as 'local' | 'remote' | 'none')}
                  className="input-field"
                >
                  <option value="local">Play on this computer</option>
                  <option value="remote">Play on remote computer</option>
                  <option value="none">Do not play</option>
                </select>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form.redirectClipboard}
                    onChange={(e) => update('redirectClipboard', e.target.checked)}
                    className="w-4 h-4 rounded border-surface-500 bg-surface-800 text-primary-500 focus:ring-primary-500/50"
                  />
                  <Clipboard className="w-4 h-4 text-surface-400 group-hover:text-surface-200" />
                  <span className="text-sm text-surface-300 group-hover:text-surface-100">Clipboard</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form.redirectDrives}
                    onChange={(e) => update('redirectDrives', e.target.checked)}
                    className="w-4 h-4 rounded border-surface-500 bg-surface-800 text-primary-500 focus:ring-primary-500/50"
                  />
                  <HardDrive className="w-4 h-4 text-surface-400 group-hover:text-surface-200" />
                  <span className="text-sm text-surface-300 group-hover:text-surface-100">Drives</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form.redirectPrinters}
                    onChange={(e) => update('redirectPrinters', e.target.checked)}
                    className="w-4 h-4 rounded border-surface-500 bg-surface-800 text-primary-500 focus:ring-primary-500/50"
                  />
                  <Printer className="w-4 h-4 text-surface-400 group-hover:text-surface-200" />
                  <span className="text-sm text-surface-300 group-hover:text-surface-100">Printers</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form.captureWindowsKey}
                    onChange={(e) => update('captureWindowsKey', e.target.checked)}
                    className="w-4 h-4 rounded border-surface-500 bg-surface-800 text-primary-500 focus:ring-primary-500/50"
                  />
                  <Keyboard className="w-4 h-4 text-surface-400 group-hover:text-surface-200" />
                  <span className="text-sm text-surface-300 group-hover:text-surface-100">Capture Windows Key</span>
                </label>
              </div>
              <p className="text-xs text-surface-500 mt-1">
                When enabled, the Windows key is forwarded to the remote session (best in full-screen).
              </p>
            </>
          )}

          {activeTab === 'hyperv' && (
            <>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.hyperVEnabled}
                  onChange={(e) => update('hyperVEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-surface-500 bg-surface-800 text-primary-500 focus:ring-primary-500/50"
                />
                <Server className="w-4 h-4 text-surface-400 group-hover:text-surface-200" />
                <span className="text-sm text-surface-300 group-hover:text-surface-100">Enable Hyper-V VM Management</span>
              </label>

              {form.hyperVEnabled && (
                <div className="space-y-3 pl-7">
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1">VM Name</label>
                    <input
                      type="text"
                      value={form.hyperVVmName}
                      onChange={(e) => update('hyperVVmName', e.target.value)}
                      placeholder="My Virtual Machine"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1">Hyper-V Host (optional)</label>
                    <input
                      type="text"
                      value={form.hyperVHost}
                      onChange={(e) => update('hyperVHost', e.target.value)}
                      placeholder="Leave blank for localhost"
                      className="input-field"
                    />
                  </div>
                  <div className="p-3 glass rounded-lg text-sm text-surface-400">
                    <p>On connect the VM will be started or resumed. On disconnect it will be saved.</p>
                    <p className="mt-1 text-xs text-surface-500">Requires Hyper-V PowerShell module and appropriate permissions.</p>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'gateway' && (
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">
                <Shield className="w-3 h-3 inline mr-1" /> RD Gateway Server
              </label>
              <input
                type="text"
                value={form.gateway}
                onChange={(e) => update('gateway', e.target.value)}
                placeholder="gateway.domain.com (optional)"
                className="input-field"
              />
              <p className="text-xs text-surface-500 mt-2">
                Leave blank if not using an RD Gateway. The gateway will be used to tunnel the RDP connection.
              </p>
            </div>
          )}

          {activeTab === 'notes' && (
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">
                <FileText className="w-3 h-3 inline mr-1" /> Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Add any notes about this connection..."
                rows={6}
                className="input-field resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-surface-700/50">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!form.host.trim()}
            className="btn-primary flex items-center gap-2 disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            {connection ? 'Save Changes' : 'Create Connection'}
          </button>
        </div>
      </div>
    </div>
  );
}
