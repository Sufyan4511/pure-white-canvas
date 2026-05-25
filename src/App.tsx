import { useState, useRef, useCallback } from 'react';
import { Upload, X, Download, RotateCcw, Zap, FileText, Eye, GitBranch, AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { parseHTML, buildElementorJSON, countElements, type ElementNode, type WidgetType } from './converter';
import ElementTree from './ElementTree';
import AIPanel from './AIPanel';
import type { AIFix, AIConfig } from './aiService';
import { runAIAnalysis } from './aiService';

type AppState = 'idle' | 'fileSelected' | 'converting' | 'converted' | 'downloaded';
type ActiveTab = 'preview' | 'tree';
type SidebarTab = 'workflow' | 'ai';

interface FileInfo {
  name: string;
  size: number;
  content: string;
  url: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Deep-clone nodes and apply AI fixes to matching nodes
function applyAIFixes(nodes: ElementNode[], fixes: AIFix[]): { nodes: ElementNode[]; applied: number } {
  let applied = 0;
  const fixMap = new Map(fixes.map(f => [f.id, f]));

  function walk(ns: ElementNode[]): ElementNode[] {
    return ns.map(n => {
      const fix = fixMap.get(n.id);
      let updated = { ...n, children: walk(n.children) };
      if (fix) {
        if (fix.field === 'widgetType' && fix.widgetType) {
          updated = { ...updated, widgetType: fix.widgetType };
          applied++;
        } else if (fix.field === 'settings' && fix.settingsPatch) {
          updated = { ...updated, settings: { ...updated.settings, ...fix.settingsPatch } };
          applied++;
        }
      }
      return updated;
    });
  }

  return { nodes: walk(nodes), applied };
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [activeTab, setActiveTab] = useState<ActiveTab>('preview');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('workflow');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [nodes, setNodes] = useState<ElementNode[]>([]);
  const [overrides, setOverrides] = useState<Record<string, WidgetType>>({});
  const [elementCount, setElementCount] = useState(0);
  const [jsonOutput, setJsonOutput] = useState<string>('');
  const [aiFixBanner, setAiFixBanner] = useState<{ count: number; auto?: boolean } | null>(null);
  const [convertPhase, setConvertPhase] = useState<'parsing' | 'ai' | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const loadFile = useCallback((file: File) => {
    setUploadError(null);
    setConvertError(null);

    if (!file.name.match(/\.html?$/i)) {
      setUploadError('Invalid file. Please upload a valid .html file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content || content.trim().length === 0) {
        setUploadError('Invalid file. The HTML file appears to be empty.');
        return;
      }

      const prevUrl = fileInfo?.url;
      if (prevUrl) URL.revokeObjectURL(prevUrl);

      const blob = new Blob([content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      setFileInfo({ name: file.name, size: file.size, content, url });
      setAppState('fileSelected');
      setActiveTab('preview');
      setNodes([]);
      setOverrides({});
      setJsonOutput('');
      setAiFixBanner(null);
    };
    reader.onerror = () => setUploadError('Failed to read the file.');
    reader.readAsText(file);
  }, [fileInfo]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

  const handleRemoveFile = () => {
    if (fileInfo?.url) URL.revokeObjectURL(fileInfo.url);
    setFileInfo(null);
    setAppState('idle');
    setUploadError(null);
    setConvertError(null);
    setNodes([]);
    setOverrides({});
    setJsonOutput('');
    setActiveTab('preview');
    setAiFixBanner(null);
  };

  const handleConvert = async () => {
    if (!fileInfo) return;
    setAppState('converting');
    setConvertError(null);
    setAiFixBanner(null);
    setConvertPhase('parsing');

    await new Promise(r => setTimeout(r, 400));

    try {
      const parsed = parseHTML(fileInfo.content);
      if (parsed.length === 0) throw new Error('No parseable elements found.');

      let finalNodes = parsed;
      let autoFixed = 0;

      // Auto-run AI if a key is saved — improves widget detection before showing the tree
      if (aiConfig) {
        setConvertPhase('ai');
        try {
          const res = await runAIAnalysis(aiConfig, fileInfo.content, parsed, supabaseUrl, supabaseAnonKey);
          if (res.fixes.length > 0) {
            const { nodes: patched, applied } = applyAIFixes(parsed, res.fixes);
            finalNodes = patched;
            autoFixed = applied;
          }
        } catch {
          // AI failure is non-fatal — proceed with unpatched nodes
        }
      }

      setConvertPhase(null);
      const count = countElements(finalNodes);
      const json = buildElementorJSON(finalNodes, fileInfo.name);
      setNodes(finalNodes);
      setElementCount(count);
      setJsonOutput(json);
      setAppState('converted');
      setActiveTab('tree');
      if (autoFixed > 0) setAiFixBanner({ count: autoFixed, auto: true });
    } catch {
      setConvertPhase(null);
      setConvertError('Conversion failed. The file could not be parsed.');
      setAppState('fileSelected');
    }
  };

  const handleOverride = (id: string, widget: WidgetType) => {
    setOverrides(prev => ({ ...prev, [id]: widget }));
  };

  const applyOverridesToNodes = (ns: ElementNode[]): ElementNode[] => {
    return ns.map(n => ({
      ...n,
      widgetType: overrides[n.id] ?? n.widgetType,
      children: applyOverridesToNodes(n.children),
    }));
  };

  const handleApplyAIFixes = (fixes: AIFix[]) => {
    if (fixes.length === 0) return;
    const { nodes: patched, applied } = applyAIFixes(nodes, fixes);
    setNodes(patched);
    setAiFixBanner({ count: applied });
    setActiveTab('tree');
    // Rebuild JSON with new nodes
    const json = buildElementorJSON(patched, fileInfo?.name || 'page');
    setJsonOutput(json);
  };

  const handleDownload = () => {
    const finalNodes = applyOverridesToNodes(nodes);
    const json = buildElementorJSON(finalNodes, fileInfo?.name || 'page');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileInfo?.name || 'page').replace(/\.html?$/i, '') + '-elementor.json';
    a.click();
    URL.revokeObjectURL(url);
    setJsonOutput(json);
    setAppState('downloaded');
  };

  const handleReset = () => {
    if (fileInfo?.url) URL.revokeObjectURL(fileInfo.url);
    setFileInfo(null);
    setAppState('idle');
    setUploadError(null);
    setConvertError(null);
    setNodes([]);
    setOverrides({});
    setJsonOutput('');
    setActiveTab('preview');
    setAiFixBanner(null);
  };

  const showDownloadButton = appState === 'converted' || appState === 'downloaded';
  const hasConverted = nodes.length > 0;

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[#0f172a] shadow-lg flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <Zap size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">Converwe</span>
        </div>
        <span className="text-slate-400 text-xs font-medium">HTML → Elementor JSON Converter</span>
      </header>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <aside className="w-80 flex-shrink-0 bg-[#0f172a] border-r border-slate-800 flex flex-col overflow-hidden">

          {/* Sidebar tab switcher */}
          <div className="flex border-b border-slate-800 flex-shrink-0">
            <button
              onClick={() => setSidebarTab('workflow')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-all
                ${sidebarTab === 'workflow'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-400'}`}
            >
              <Zap size={12} />
              Workflow
            </button>
            <button
              onClick={() => setSidebarTab('ai')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-all relative
                ${sidebarTab === 'ai'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-slate-500 hover:text-slate-400'}`}
            >
              <Sparkles size={12} />
              AI Fix
              {aiFixBanner && (
                <span className="absolute top-1.5 right-3 w-2 h-2 bg-emerald-400 rounded-full" />
              )}
            </button>
          </div>

          {/* Scrollable sidebar content */}
          <div className="flex-1 overflow-y-auto">
            {sidebarTab === 'workflow' && (
              <div className="p-5 flex flex-col gap-5">

                {/* Section 1: Upload */}
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">1. Upload HTML File</p>

                  {appState === 'idle' && (
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                        ${isDragging
                          ? 'border-blue-500 bg-blue-950/30'
                          : 'border-slate-700 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50'
                        }`}
                    >
                      <Upload size={28} className={`mx-auto mb-3 ${isDragging ? 'text-blue-400' : 'text-slate-600'}`} />
                      <p className="text-sm text-slate-400 leading-relaxed">
                        Drag & drop your <span className="font-semibold text-slate-200">.html</span> file here
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        or <span className="text-blue-400 font-medium hover:underline">browse to upload</span>
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".html,.htm"
                        className="hidden"
                        onChange={handleFileInput}
                      />
                    </div>
                  )}

                  {appState !== 'idle' && fileInfo && (
                    <div
                      className={`flex items-center justify-between rounded-lg px-3.5 py-3 border transition-colors
                        ${appState === 'downloaded'
                          ? 'bg-emerald-950/30 border-emerald-800/50'
                          : 'bg-blue-950/30 border-blue-800/30'
                        }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={14} className={appState === 'downloaded' ? 'text-emerald-400 flex-shrink-0' : 'text-blue-400 flex-shrink-0'} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-200 truncate">{fileInfo.name}</p>
                          <p className="text-[10px] text-slate-500">{formatBytes(fileInfo.size)}</p>
                        </div>
                      </div>
                      {appState !== 'downloaded' && (
                        <button
                          onClick={handleRemoveFile}
                          className="text-red-500 hover:text-red-400 transition-colors ml-2 flex-shrink-0"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )}

                  {uploadError && (
                    <div className="flex items-start gap-2 mt-2 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2.5">
                      <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-400">{uploadError}</p>
                    </div>
                  )}
                </div>

                {/* Section 2: Convert */}
                {(appState === 'fileSelected' || appState === 'converting') && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">2. Convert</p>

                    {convertError && (
                      <div className="flex items-start gap-2 mb-3 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2.5">
                        <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-red-400">{convertError}</p>
                      </div>
                    )}

                    <button
                      onClick={handleConvert}
                      disabled={appState === 'converting'}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl py-3 transition-all shadow-sm"
                    >
                      {appState === 'converting' ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          {convertPhase === 'ai' ? 'AI analysing...' : 'Parsing...'}
                        </>
                      ) : (
                        <>
                          {aiConfig ? <Sparkles size={15} /> : <Zap size={15} />}
                          {aiConfig ? 'Smart Convert' : 'Convert to Elementor JSON'}
                        </>
                      )}
                    </button>
                    {aiConfig && appState !== 'converting' && (
                      <p className="text-[10px] text-cyan-600 text-center mt-1.5 flex items-center justify-center gap-1">
                        <Sparkles size={9} /> AI auto-analysis enabled
                      </p>
                    )}
                  </div>
                )}

                {/* AI fix banner */}
                {aiFixBanner && (
                  <div className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-700/40 rounded-xl px-3.5 py-3">
                    <Sparkles size={14} className="text-cyan-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-400">
                        {aiFixBanner.auto ? 'Auto-fixed' : 'AI applied'} {aiFixBanner.count} correction{aiFixBanner.count !== 1 ? 's' : ''}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {aiFixBanner.auto ? 'Applied automatically during conversion' : 'Tree updated — re-download for improved JSON'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Section 3: Converted */}
                {appState === 'converted' && (
                  <div className="flex flex-col gap-3">
                    <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 py-3.5 text-center">
                      <CheckCircle2 size={20} className="text-emerald-400 mx-auto mb-1.5" />
                      <p className="text-sm font-semibold text-emerald-400">Conversion complete</p>
                      <p className="text-xs text-slate-400 mt-0.5">{elementCount} element{elementCount !== 1 ? 's' : ''} mapped</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">3. Download</p>
                      <button
                        onClick={handleDownload}
                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl py-3 transition-all shadow-sm"
                      >
                        <Download size={15} />
                        Download Elementor JSON
                      </button>
                    </div>

                    <button
                      onClick={() => setSidebarTab('ai')}
                      className="w-full flex items-center justify-center gap-2 border border-cyan-800/50 bg-cyan-950/20 hover:bg-cyan-950/40 text-cyan-400 font-semibold text-sm rounded-xl py-2.5 transition-all"
                    >
                      <Sparkles size={14} />
                      Run AI Analysis
                    </button>
                  </div>
                )}

                {/* Section 4: Downloaded */}
                {appState === 'downloaded' && (
                  <div className="flex flex-col gap-3">
                    <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-4 py-4 text-center">
                      <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-2">
                        <CheckCircle2 size={20} className="text-emerald-400" />
                      </div>
                      <p className="text-sm font-bold text-emerald-400">Your JSON is ready!</p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">Import via Elementor → Templates → Import</p>
                    </div>

                    <button
                      onClick={handleDownload}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl py-2.5 transition-all"
                    >
                      <Download size={14} />
                      Re-download JSON
                    </button>

                    <button
                      onClick={() => setSidebarTab('ai')}
                      className="w-full flex items-center justify-center gap-2 border border-cyan-800/50 bg-cyan-950/20 hover:bg-cyan-950/40 text-cyan-400 font-semibold text-sm rounded-xl py-2.5 transition-all"
                    >
                      <Sparkles size={14} />
                      Run AI Analysis
                    </button>

                    <button
                      onClick={handleReset}
                      className="w-full flex items-center justify-center gap-2 border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 font-semibold text-sm rounded-xl py-2.5 transition-all"
                    >
                      <RotateCcw size={14} />
                      Convert another file
                    </button>
                  </div>
                )}
              </div>
            )}

            {sidebarTab === 'ai' && (
              <div className="p-5">
                <AIPanel
                  nodes={nodes}
                  htmlContent={fileInfo?.content ?? ''}
                  onApplyFixes={handleApplyAIFixes}
                  onConfigChange={setAiConfig}
                  disabled={!hasConverted}
                />
              </div>
            )}
          </div>
        </aside>

        {/* Right Panel */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-200 bg-white flex-shrink-0">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition-all
                ${activeTab === 'preview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              <Eye size={14} />
              HTML Preview
            </button>
            <button
              onClick={() => setActiveTab('tree')}
              disabled={nodes.length === 0}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed
                ${activeTab === 'tree'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              <GitBranch size={14} />
              Element Tree
              {nodes.length > 0 && (
                <span className="bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                  {elementCount}
                </span>
              )}
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'preview' && (
              fileInfo ? (
                <iframe
                  src={fileInfo.url}
                  className="w-full h-full border-0"
                  title="HTML Preview"
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                    <FileText size={28} className="text-slate-300" />
                  </div>
                  <div className="text-center">
                    <p className="text-slate-400 text-sm font-medium">Upload an HTML file to see the preview</p>
                    <p className="text-slate-300 text-xs mt-1">Your file will be rendered here before conversion</p>
                  </div>
                </div>
              )
            )}

            {activeTab === 'tree' && (
              nodes.length > 0 ? (
                <div className="h-full overflow-y-auto">
                  <ElementTree nodes={nodes} overrides={overrides} onOverride={handleOverride} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                    <GitBranch size={28} className="text-slate-300" />
                  </div>
                  <div className="text-center">
                    <p className="text-slate-400 text-sm font-medium">No element tree yet</p>
                    <p className="text-slate-300 text-xs mt-1">Convert your HTML file to see the widget mapping</p>
                  </div>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
