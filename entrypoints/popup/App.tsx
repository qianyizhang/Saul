import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Cpu,
  Sliders,
  FileText,
  Check,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Zap,
  Database,
  Search,
  Trash2,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { UserSettings, ProviderType } from '../../src/types';
import type { HistoryItem } from '../../src/types/storage';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../../src/storage/settings';
import { isChromeAiAvailable } from '../../src/models/chrome-ai';
import { DEFAULT_SYSTEM_PROMPT } from '../../src/models/prompts';
import {
  fetchHistory,
  deleteHistorySelection,
  clearAllHistory,
  exportKnowledgeMarkdown,
} from '../../src/storage/client';

type Tab = 'provider' | 'context' | 'prompt' | 'history';

const PRESETS = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  { name: 'Moonshot/Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-haiku' },
];

export default function App() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<Tab>('provider');
  const [chromeAiReady, setChromeAiReady] = useState<boolean>(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testingStatus, setTestingStatus] = useState<string | null>(null);

  // History state
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
    isChromeAiAvailable().then(setChromeAiReady);
  }, []);

  const loadHistory = (query?: string) => {
    setLoadingHistory(true);
    fetchHistory(50, 0, query)
      .then((items) => {
        setHistoryItems(items);
      })
      .catch((err) => {
        console.error('Failed to load history:', err);
      })
      .finally(() => setLoadingHistory(false));
  };

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory(searchQuery);
    }
  }, [activeTab, searchQuery]);

  const handleSave = async () => {
    await saveSettings(settings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setSettings((prev) => ({
      ...prev,
      openaiCompatible: {
        ...prev.openaiCompatible,
        baseUrl: preset.baseUrl,
        model: preset.model,
      },
    }));
  };

  const handleTestConnection = async () => {
    setTestingStatus('Testing...');
    try {
      if (settings.activeProvider === 'chrome-ai') {
        const available = await isChromeAiAvailable();
        if (available) {
          setTestingStatus('✅ Chrome Built-in AI is ready!');
        } else {
          setTestingStatus('❌ Chrome Built-in AI not available in this browser.');
        }
      } else {
        const baseUrl = settings.openaiCompatible.baseUrl.replace(/\/+$/, '');
        const url = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;
        const headers: Record<string, string> = {};
        if (settings.openaiCompatible.apiKey) {
          headers['Authorization'] = `Bearer ${settings.openaiCompatible.apiKey}`;
        }
        const res = await fetch(url, { headers });
        if (res.ok) {
          setTestingStatus('✅ Connected successfully!');
        } else {
          setTestingStatus(`⚠️ Server responded with ${res.status}`);
        }
      }
    } catch (err: any) {
      setTestingStatus(`❌ Connection failed: ${err.message}`);
    }
    setTimeout(() => setTestingStatus(null), 4000);
  };

  const handleDeleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteHistorySelection(id);
    setHistoryItems((prev) => prev.filter((item) => item.selectionId !== id));
  };

  const handleClearAllHistory = async () => {
    if (window.confirm('Are you sure you want to clear all reading history?')) {
      await clearAllHistory();
      setHistoryItems([]);
    }
  };

  const handleExportMarkdown = async () => {
    const md = await exportKnowledgeMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saul-knowledge-export-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-[420px] min-h-[520px] bg-slate-50 text-slate-800 flex flex-col justify-between font-sans text-xs">
      {/* Header */}
      <div className="p-3.5 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">Saul</h1>
            <p className="text-[10px] text-slate-500">AI Concept & Reading Explorer</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          <button
            onClick={() => setActiveTab('provider')}
            title="Model & Provider"
            className={`p-1.5 rounded-md transition-all ${
              activeTab === 'provider' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('context')}
            title="Context Policies"
            className={`p-1.5 rounded-md transition-all ${
              activeTab === 'context' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            title="Prompt Template"
            className={`p-1.5 rounded-md transition-all ${
              activeTab === 'prompt' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('history')}
            title="SQLite Memory & FTS"
            className={`p-1.5 rounded-md transition-all ${
              activeTab === 'history' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        {/* Tab 1: Provider */}
        {activeTab === 'provider' && (
          <div className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1.5">
                Active Provider
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, activeProvider: 'openai-compatible' }))}
                  className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all ${
                    settings.activeProvider === 'openai-compatible'
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-medium ring-1 ring-indigo-600'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 mt-0.5 text-indigo-600" />
                  <div>
                    <div className="font-semibold">OpenAI Compatible</div>
                    <div className="text-[10px] text-slate-500">BYOK / Ollama / DeepSeek</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, activeProvider: 'chrome-ai' }))}
                  className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all ${
                    settings.activeProvider === 'chrome-ai'
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-medium ring-1 ring-indigo-600'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5 mt-0.5 text-indigo-600" />
                  <div>
                    <div className="font-semibold">Chrome Nano AI</div>
                    <div className="text-[10px] text-slate-500">
                      {chromeAiReady ? 'Ready (Offline)' : 'Not detected'}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {settings.activeProvider === 'openai-compatible' && (
              <>
                {/* Presets */}
                <div>
                  <label className="block text-[10px] font-medium text-slate-500 mb-1">
                    Quick Presets
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => applyPreset(p)}
                        className="px-2 py-1 rounded bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-[10px] text-slate-600 font-medium transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={settings.openaiCompatible.baseUrl}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        openaiCompatible: { ...s.openaiCompatible, baseUrl: e.target.value },
                      }))
                    }
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs text-slate-800"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={settings.openaiCompatible.apiKey}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          openaiCompatible: { ...s.openaiCompatible, apiKey: e.target.value },
                        }))
                      }
                      placeholder="sk-..."
                      className="w-full px-2.5 py-1.5 pr-8 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-mono text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Model & Temp */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Model Name
                    </label>
                    <input
                      type="text"
                      value={settings.openaiCompatible.model}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          openaiCompatible: { ...s.openaiCompatible, model: e.target.value },
                        }))
                      }
                      placeholder="gpt-4o-mini"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs text-slate-800"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[11px] font-semibold text-slate-700">Temperature</label>
                      <span className="text-[10px] text-slate-500">
                        {settings.openaiCompatible.temperature}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.openaiCompatible.temperature}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          openaiCompatible: {
                            ...s.openaiCompatible,
                            temperature: parseFloat(e.target.value),
                          },
                        }))
                      }
                      className="w-full mt-1 accent-indigo-600"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Test Connection */}
            <div className="pt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={handleTestConnection}
                className="px-2.5 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100 font-medium text-slate-700 transition-colors"
              >
                Test Connection
              </button>
              {testingStatus && <span className="text-[11px] font-medium">{testingStatus}</span>}
            </div>
          </div>
        )}

        {/* Tab 2: Context */}
        {activeTab === 'context' && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">
              Configure what webpage context Saul extracts and feeds into the model.
            </p>

            <div className="space-y-2 bg-white p-3 rounded-lg border border-slate-200">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-semibold text-slate-700">Containing Paragraph</div>
                  <div className="text-[10px] text-slate-400">
                    Extracts the surrounding paragraph to resolve pronouns & context
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.contextPolicy.includeContainingParagraph}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      contextPolicy: {
                        ...s.contextPolicy,
                        includeContainingParagraph: e.target.checked,
                      },
                    }))
                  }
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
              </label>

              <hr className="border-slate-100" />

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-semibold text-slate-700">Preceding Heading / Section</div>
                  <div className="text-[10px] text-slate-400">
                    Extracts the nearest H1-H6 heading above selection
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.contextPolicy.includeContainingHeading}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      contextPolicy: {
                        ...s.contextPolicy,
                        includeContainingHeading: e.target.checked,
                      },
                    }))
                  }
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
              </label>

              <hr className="border-slate-100" />

              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-semibold text-slate-700">Page Metadata (Title & URL)</div>
                  <div className="text-[10px] text-slate-400">
                    Helps the model know what website or article you are reading
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.contextPolicy.includePageMetadata}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      contextPolicy: {
                        ...s.contextPolicy,
                        includePageMetadata: e.target.checked,
                      },
                    }))
                  }
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
              </label>
            </div>
          </div>
        )}

        {/* Tab 3: Prompt */}
        {activeTab === 'prompt' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-700">System Prompt Template</span>
              <button
                type="button"
                onClick={() =>
                  setSettings((s) => ({ ...s, customPromptTemplate: DEFAULT_SYSTEM_PROMPT }))
                }
                className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to Default</span>
              </button>
            </div>

            <textarea
              rows={10}
              value={settings.customPromptTemplate || DEFAULT_SYSTEM_PROMPT}
              onChange={(e) =>
                setSettings((s) => ({ ...s, customPromptTemplate: e.target.value }))
              }
              className="w-full p-2.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-[11px] text-slate-800 leading-normal"
            />
            <p className="text-[10px] text-slate-400">
              Note: Retain the <code className="text-indigo-600">&lt;term note="..."&gt;</code> tag instruction so tooltips render correctly.
            </p>
          </div>
        )}

        {/* Tab 4: SQLite History & Memory */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {/* Search Bar */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search highlighted concepts (FTS5)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            </div>

            {/* List */}
            {loadingHistory ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                Searching SQLite storage...
              </div>
            ) : historyItems.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs bg-white rounded-lg border border-slate-200">
                <Database className="w-6 h-6 mx-auto mb-1.5 text-slate-300" />
                <p>No highlights recorded yet.</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Highlight text on any page and click Explain!
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {historyItems.map((item) => {
                  const isExpanded = expandedId === item.selectionId;
                  return (
                    <div
                      key={item.selectionId}
                      onClick={() => setExpandedId(isExpanded ? null : item.selectionId)}
                      className="p-2.5 bg-white rounded-lg border border-slate-200 hover:border-indigo-200 transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-slate-800 text-[11px] leading-snug line-clamp-2">
                          "{item.selectedText}"
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={(e) => handleDeleteHistoryItem(item.selectionId, e)}
                            title="Delete"
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="truncate max-w-[200px]" title={item.pageUrl}>
                          {item.pageTitle || new URL(item.pageUrl).hostname}
                        </span>
                        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-slate-100 text-slate-700 text-[11px] leading-relaxed bg-slate-50/50 p-2 rounded">
                          <p className="font-normal">{item.responseRaw}</p>
                          <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-400">
                            <span>Model: {item.model}</span>
                            {item.latencyMs ? (
                              <span>{(item.latencyMs / 1000).toFixed(2)}s</span>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* History Action Toolbar */}
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={handleExportMarkdown}
                disabled={historyItems.length === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-medium text-[10px] disabled:opacity-50 transition-colors"
              >
                <Download className="w-3 h-3" />
                <span>Export to Markdown</span>
              </button>

              <button
                type="button"
                onClick={handleClearAllHistory}
                disabled={historyItems.length === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-rose-600 hover:bg-rose-50 font-medium text-[10px] disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear All</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {activeTab !== 'history' && (
        <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between">
          <div className="text-[10px] text-slate-400">Changes saved locally</div>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-xs active:scale-95 transition-all"
          >
            {saveSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-300" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
