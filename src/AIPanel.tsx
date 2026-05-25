import { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, AlertCircle, Loader2, Wrench, Wifi, Eye, EyeOff } from 'lucide-react';
import {
  type AIFix,
  type AIConfig,
  type AIProvider,
  runAIAnalysis,
  testAIConnection,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
} from './aiService';
import type { ElementNode, WidgetType } from './converter';
import { WIDGET_LABELS } from './converter';

interface AIPanelProps {
  nodes: ElementNode[];
  htmlContent: string;
  onApplyFixes: (fixes: AIFix[]) => void;
  disabled: boolean;
}

const STORAGE_KEY = 'converwe_ai_config_v2';

function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { provider: 'openai', apiKey: '', model: 'gpt-4o-mini' };
}

function FixCard({ fix, selected, onToggle }: { fix: AIFix; selected: boolean; onToggle: () => void }) {
  const widgetLabel = fix.widgetType ? WIDGET_LABELS[fix.widgetType as WidgetType] : null;
  return (
    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all
      ${selected ? 'bg-blue-950/40 border-blue-700/50' : 'bg-slate-900/40 border-slate-700/50 hover:border-slate-600'}`}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} className="mt-0.5 accent-blue-500 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          {fix.field === 'widgetType' && widgetLabel && (
            <span className="text-[10px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/40 rounded px-1.5 py-0.5 leading-none">→ {widgetLabel}</span>
          )}
          {fix.field === 'settings' && (
            <span className="text-[10px] font-bold bg-emerald-900/50 text-emerald-400 border border-emerald-700/40 rounded px-1.5 py-0.5 leading-none">settings patch</span>
          )}
          <code className="text-[10px] text-slate-500 font-mono">{fix.id}</code>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">{fix.reason}</p>
      </div>
    </label>
  );
}

export default function AIPanel({ nodes, htmlContent, onApplyFixes, disabled }: AIPanelProps) {
  const [config, setConfig] = useState<AIConfig>(loadConfig);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [result, setResult] = useState<{ summary: string; fixes: AIFix[]; tokensUsed?: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
  }, [config]);

  const models = config.provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;

  function setProvider(p: AIProvider) {
    const defaultModel = p === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'gpt-4o-mini';
    setConfig(c => ({ ...c, provider: p, model: defaultModel }));
    setTestStatus('idle');
  }

  async function handleTest() {
    setTestStatus('testing');
    setTestError('');
    try {
      await testAIConnection(config);
      setTestStatus('ok');
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
      setTestStatus('error');
    }
  }

  async function handleAnalyze() {
    if (nodes.length === 0) return;
    setStatus('running');
    setResult(null);
    setErrorMsg('');
    setSelectedFixes(new Set());
    try {
      const res = await runAIAnalysis(htmlContent, nodes, config);
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleApply() {
    if (!result) return;
    onApplyFixes(result.fixes.filter(f => selectedFixes.has(f.id)));
    setResult(null);
    setStatus('idle');
    setSelectedFixes(new Set());
  }

  const canAnalyze = !disabled && nodes.length > 0 && !!config.apiKey;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-md flex items-center justify-center flex-shrink-0">
          <Sparkles size={12} className="text-white" />
        </div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Assistant</p>
      </div>

      {/* Provider */}
      <div className="flex gap-1.5">
        {(['openai', 'anthropic'] as AIProvider[]).map(p => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md border transition-all
              ${config.provider === p
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
          >
            {p === 'openai' ? 'OpenAI (GPT)' : 'Anthropic (Claude)'}
          </button>
        ))}
      </div>

      {/* Model */}
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Model</label>
        <select
          value={config.model}
          onChange={e => setConfig(c => ({ ...c, model: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
        >
          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      {/* API key */}
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
          {config.provider === 'anthropic' ? 'Anthropic API key' : 'OpenAI API key'}
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={e => { setConfig(c => ({ ...c, apiKey: e.target.value })); setTestStatus('idle'); }}
            placeholder={config.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            className="w-full bg-slate-900 border border-slate-700 rounded-md pl-2 pr-8 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowKey(s => !s)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-slate-600 mt-1">Stored locally in your browser. Never sent to our servers.</p>
      </div>

      <button
        onClick={handleTest}
        disabled={testStatus === 'testing' || !config.apiKey}
        className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border transition-all
          ${testStatus === 'ok' ? 'border-emerald-700 bg-emerald-950/40 text-emerald-400'
            : testStatus === 'error' ? 'border-red-800 bg-red-950/30 text-red-400'
            : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-300'}
          disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {testStatus === 'testing' ? <Loader2 size={12} className="animate-spin" />
          : testStatus === 'ok' ? <CheckCircle2 size={12} />
          : testStatus === 'error' ? <AlertCircle size={12} />
          : <Wifi size={12} />}
        Test connection
      </button>

      {testStatus === 'error' && (
        <div className="flex items-start gap-1.5 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
          <AlertCircle size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed break-all">{testError}</p>
        </div>
      )}

      <div className="border-t border-slate-800" />

      <button
        onClick={handleAnalyze}
        disabled={!canAnalyze || status === 'running'}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
          bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500
          text-white shadow-lg shadow-blue-900/30
          disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed"
      >
        {status === 'running' ? <><Loader2 size={14} className="animate-spin" /> Analysing...</> : <><Sparkles size={14} /> Re-analyse & Fix</>}
      </button>

      {!config.apiKey && (
        <p className="text-[10px] text-amber-500 text-center">Add an API key above to enable AI analysis</p>
      )}
      {config.apiKey && nodes.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center">Convert your HTML first</p>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-2 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2.5">
          <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed break-all">{errorMsg}</p>
        </div>
      )}

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
              <CheckCircle2 size={12} /> No fixes needed — looks good!
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
                  <FixCard key={fix.id} fix={fix} selected={selectedFixes.has(fix.id)} onToggle={() => toggleFix(fix.id)} />
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
