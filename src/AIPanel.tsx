import { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Eye, EyeOff, ChevronDown, CheckCircle2, AlertCircle, Loader2, Cpu, Wrench, Wifi } from 'lucide-react';
import {
  type AIConfig, type AIFix,
  type AIProvider,
  PROVIDER_MODELS, DEFAULT_MODELS,
  loadAIConfig, saveAIConfig, clearAIConfig,
  runAIAnalysis, testAIConnection,
} from './aiService';
import type { ElementNode, WidgetType } from './converter';
import { WIDGET_LABELS } from './converter';

interface AIPanelProps {
  nodes: ElementNode[];
  htmlContent: string;
  onApplyFixes: (fixes: AIFix[]) => void;
  onConfigChange: (config: AIConfig | null) => void;
  disabled: boolean;
}

function ModelDropdown({ provider, value, onChange }: { provider: AIProvider; value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const models = PROVIDER_MODELS[provider];

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 hover:border-slate-500 transition-colors"
      >
        <span className="truncate font-mono">{value}</span>
        <ChevronDown size={12} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto">
          {models.map(m => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors
                ${m === value ? 'bg-blue-900/60 text-blue-300' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FixCard({ fix, selected, onToggle }: { fix: AIFix; selected: boolean; onToggle: () => void }) {
  const widgetLabel = fix.widgetType ? WIDGET_LABELS[fix.widgetType as WidgetType] : null;
  return (
    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all
      ${selected ? 'bg-blue-950/40 border-blue-700/50' : 'bg-slate-900/40 border-slate-700/50 hover:border-slate-600'}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-0.5 accent-blue-500 flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          {fix.field === 'widgetType' && widgetLabel && (
            <span className="text-[10px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/40 rounded px-1.5 py-0.5 leading-none">
              → {widgetLabel}
            </span>
          )}
          {fix.field === 'settings' && (
            <span className="text-[10px] font-bold bg-emerald-900/50 text-emerald-400 border border-emerald-700/40 rounded px-1.5 py-0.5 leading-none">
              settings patch
            </span>
          )}
          <code className="text-[10px] text-slate-500 font-mono">{fix.id}</code>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">{fix.reason}</p>
      </div>
    </label>
  );
}

export default function AIPanel({ nodes, htmlContent, onApplyFixes, onConfigChange, disabled }: AIPanelProps) {
  const [config, setConfig] = useState<AIConfig>(() => loadAIConfig() ?? {
    provider: 'claude',
    apiKey: '',
    model: DEFAULT_MODELS['claude'],
  });
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [result, setResult] = useState<{ summary: string; fixes: AIFix[]; tokensUsed?: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());
  const [configSaved, setConfigSaved] = useState(!!loadAIConfig());

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  // Notify parent whenever config changes so it can use it for auto-analysis
  useEffect(() => {
    onConfigChange(configSaved && config.apiKey.trim() ? config : null);
  }, [config, configSaved, onConfigChange]);

  function updateConfig(next: AIConfig) {
    setConfig(next);
    setTestStatus('idle');
  }

  function handleProviderChange(p: AIProvider) {
    updateConfig({ ...config, provider: p, model: DEFAULT_MODELS[p] });
  }

  function handleModelChange(m: string) {
    updateConfig({ ...config, model: m });
  }

  function handleKeyChange(k: string) {
    updateConfig({ ...config, apiKey: k });
  }

  function handleSaveConfig() {
    saveAIConfig(config);
    setConfigSaved(true);
    onConfigChange(config.apiKey.trim() ? config : null);
  }

  function handleClearConfig() {
    clearAIConfig();
    const reset = { provider: 'claude' as AIProvider, apiKey: '', model: DEFAULT_MODELS['claude'] };
    setConfig(reset);
    setConfigSaved(false);
    setResult(null);
    setStatus('idle');
    setTestStatus('idle');
    onConfigChange(null);
  }

  async function handleTest() {
    if (!config.apiKey.trim()) return;
    setTestStatus('testing');
    setTestError('');
    try {
      await testAIConnection(config, supabaseUrl, supabaseAnonKey);
      setTestStatus('ok');
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
      setTestStatus('error');
    }
  }

  async function handleAnalyze() {
    if (!config.apiKey.trim()) {
      setErrorMsg('Please enter your API key first.');
      setStatus('error');
      return;
    }
    if (nodes.length === 0) return;

    setStatus('running');
    setResult(null);
    setErrorMsg('');
    setSelectedFixes(new Set());

    try {
      const res = await runAIAnalysis(config, htmlContent, nodes, supabaseUrl, supabaseAnonKey);
      setResult(res);
      setSelectedFixes(new Set(res.fixes.map(f => f.id)));
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  function toggleFix(id: string) {
    setSelectedFixes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApply() {
    if (!result) return;
    const toApply = result.fixes.filter(f => selectedFixes.has(f.id));
    onApplyFixes(toApply);
    setResult(null);
    setStatus('idle');
    setSelectedFixes(new Set());
  }

  const canAnalyze = !disabled && nodes.length > 0 && config.apiKey.trim().length > 0;
  const canTest = config.apiKey.trim().length > 0 && testStatus !== 'testing';

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-md flex items-center justify-center flex-shrink-0">
          <Sparkles size={12} className="text-white" />
        </div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Assistant</p>
      </div>

      {/* Auto-analysis notice */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2.5">
        <p className="text-[11px] text-slate-400 leading-relaxed">
          When a key is saved, AI analysis runs automatically during conversion to improve widget detection accuracy.
        </p>
      </div>

      {/* Provider selector */}
      <div>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Provider</label>
        <div className="flex gap-2">
          {(['claude', 'openai'] as AIProvider[]).map(p => (
            <button
              key={p}
              onClick={() => handleProviderChange(p)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-semibold transition-all
                ${config.provider === p
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
            >
              <Cpu size={11} />
              {p === 'claude' ? 'Claude' : 'GPT'}
            </button>
          ))}
        </div>
      </div>

      {/* Model */}
      <div>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Model</label>
        <ModelDropdown provider={config.provider} value={config.model} onChange={handleModelChange} />
      </div>

      {/* API Key */}
      <div>
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={e => handleKeyChange(e.target.value)}
            placeholder={config.provider === 'claude' ? 'sk-ant-api03-...' : 'sk-proj-...'}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 pr-8 placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowKey(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>

      {/* Save / Clear / Test row */}
      <div className="flex gap-2">
        <button
          onClick={handleSaveConfig}
          disabled={!config.apiKey.trim()}
          className="flex-1 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Save key
        </button>
        <button
          onClick={handleTest}
          disabled={!canTest}
          className={`flex items-center gap-1 py-1.5 px-3 text-[11px] font-semibold rounded-lg border transition-all
            ${testStatus === 'ok'
              ? 'border-emerald-700 bg-emerald-950/40 text-emerald-400'
              : testStatus === 'error'
                ? 'border-red-800 bg-red-950/30 text-red-400'
                : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-300'
            }
            disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {testStatus === 'testing' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : testStatus === 'ok' ? (
            <CheckCircle2 size={11} />
          ) : testStatus === 'error' ? (
            <AlertCircle size={11} />
          ) : (
            <Wifi size={11} />
          )}
          Test
        </button>
        {configSaved && (
          <button
            onClick={handleClearConfig}
            className="py-1.5 px-2.5 text-[11px] font-semibold rounded-lg border border-slate-700 bg-slate-900 text-red-400 hover:bg-red-950/30 hover:border-red-800 transition-all"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Test feedback */}
      {testStatus === 'ok' && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <CheckCircle2 size={11} />
          Connection successful — API key works
        </div>
      )}
      {testStatus === 'error' && (
        <div className="flex items-start gap-1.5 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
          <AlertCircle size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed">{testError}</p>
        </div>
      )}

      {configSaved && testStatus === 'idle' && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-500">
          <CheckCircle2 size={10} />
          Key saved — auto-analysis enabled on next convert
        </div>
      )}

      <div className="border-t border-slate-800" />

      {/* Analyse button */}
      <button
        onClick={handleAnalyze}
        disabled={!canAnalyze || status === 'running'}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
          bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500
          text-white shadow-lg shadow-blue-900/30
          disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed"
      >
        {status === 'running' ? (
          <><Loader2 size={14} className="animate-spin" /> Analysing...</>
        ) : (
          <><Sparkles size={14} /> Analyse & Fix</>
        )}
      </button>

      {!canAnalyze && nodes.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center">Convert your HTML first to enable AI analysis</p>
      )}
      {!canAnalyze && nodes.length > 0 && !config.apiKey.trim() && (
        <p className="text-[10px] text-slate-600 text-center">Enter an API key to enable analysis</p>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="flex items-start gap-2 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2.5">
          <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed">{errorMsg}</p>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div className="flex flex-col gap-3">
          <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg px-3 py-2.5">
            <p className="text-[11px] text-blue-300 leading-relaxed">{result.summary || 'Analysis complete.'}</p>
            {result.tokensUsed && (
              <p className="text-[10px] text-slate-600 mt-1">{result.tokensUsed.toLocaleString()} tokens used</p>
            )}
          </div>

          {result.fixes.length === 0 ? (
            <div className="flex items-center gap-2 text-[11px] text-emerald-500">
              <CheckCircle2 size={12} />
              No fixes needed — looks good!
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {result.fixes.length} fix{result.fixes.length !== 1 ? 'es' : ''} suggested
                </p>
                <button
                  onClick={() => {
                    if (selectedFixes.size === result.fixes.length) setSelectedFixes(new Set());
                    else setSelectedFixes(new Set(result.fixes.map(f => f.id)));
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {selectedFixes.size === result.fixes.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                {result.fixes.map(fix => (
                  <FixCard
                    key={fix.id}
                    fix={fix}
                    selected={selectedFixes.has(fix.id)}
                    onToggle={() => toggleFix(fix.id)}
                  />
                ))}
              </div>

              <button
                onClick={handleApply}
                disabled={selectedFixes.size === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
                  bg-emerald-600 hover:bg-emerald-500 text-white
                  disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                <Wrench size={13} />
                Apply {selectedFixes.size} fix{selectedFixes.size !== 1 ? 'es' : ''}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
