import { useState } from 'react';
import { Sparkles, CheckCircle2, AlertCircle, Loader2, Wrench, Wifi } from 'lucide-react';
import { type AIFix, runAIAnalysis, testAIConnection } from './aiService';
import type { ElementNode, WidgetType } from './converter';
import { WIDGET_LABELS } from './converter';

interface AIPanelProps {
  nodes: ElementNode[];
  htmlContent: string;
  onApplyFixes: (fixes: AIFix[]) => void;
  disabled: boolean;
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

export default function AIPanel({ nodes, htmlContent, onApplyFixes, disabled }: AIPanelProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [result, setResult] = useState<{ summary: string; fixes: AIFix[]; tokensUsed?: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  async function handleTest() {
    setTestStatus('testing');
    setTestError('');
    try {
      await testAIConnection(supabaseUrl, supabaseAnonKey);
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
      const res = await runAIAnalysis(htmlContent, nodes, supabaseUrl, supabaseAnonKey);
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

  const canAnalyze = !disabled && nodes.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-md flex items-center justify-center flex-shrink-0">
          <Sparkles size={12} className="text-white" />
        </div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Assistant</p>
      </div>

      <div className="bg-gradient-to-br from-blue-950/40 to-cyan-950/30 border border-cyan-800/40 rounded-lg px-3 py-2.5">
        <p className="text-[11px] text-cyan-200 leading-relaxed">
          <Sparkles size={10} className="inline mb-0.5" /> Powered by Lovable AI — no API keys needed.
          Analysis runs automatically during conversion to improve widget detection.
        </p>
      </div>

      <button
        onClick={handleTest}
        disabled={testStatus === 'testing'}
        className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border transition-all
          ${testStatus === 'ok'
            ? 'border-emerald-700 bg-emerald-950/40 text-emerald-400'
            : testStatus === 'error'
              ? 'border-red-800 bg-red-950/30 text-red-400'
              : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-300'}
          disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {testStatus === 'testing' ? <Loader2 size={12} className="animate-spin" />
          : testStatus === 'ok' ? <CheckCircle2 size={12} />
          : testStatus === 'error' ? <AlertCircle size={12} />
          : <Wifi size={12} />}
        Test AI connection
      </button>

      {testStatus === 'ok' && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 size={11} /> Lovable AI is reachable.
        </p>
      )}
      {testStatus === 'error' && (
        <div className="flex items-start gap-1.5 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
          <AlertCircle size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed">{testError}</p>
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
        {status === 'running'
          ? <><Loader2 size={14} className="animate-spin" /> Analysing...</>
          : <><Sparkles size={14} /> Re-analyse & Fix</>}
      </button>

      {!canAnalyze && nodes.length === 0 && (
        <p className="text-[10px] text-slate-600 text-center">Convert your HTML first to enable AI analysis</p>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-2 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2.5">
          <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400 leading-relaxed">{errorMsg}</p>
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
