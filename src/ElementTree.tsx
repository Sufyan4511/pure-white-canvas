import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ElementNode, type WidgetType, COMPATIBLE_WIDGETS, WIDGET_ICONS, WIDGET_LABELS } from './converter';

interface ElementTreeProps {
  nodes: ElementNode[];
  overrides: Record<string, WidgetType>;
  onOverride: (id: string, widget: WidgetType) => void;
}

interface TreeNodeProps {
  node: ElementNode;
  overrides: Record<string, WidgetType>;
  onOverride: (id: string, widget: WidgetType) => void;
}

function WidgetDropdown({ nodeId, current, onSelect, onClose }: {
  nodeId: string;
  current: WidgetType;
  onSelect: (id: string, w: WidgetType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-6 z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[180px]"
    >
      {COMPATIBLE_WIDGETS.map(w => (
        <button
          key={w}
          onClick={() => { onSelect(nodeId, w); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50 transition-colors ${w === current ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700'}`}
        >
          <span>{WIDGET_ICONS[w]}</span>
          <span>{WIDGET_LABELS[w]}</span>
        </button>
      ))}
    </div>
  );
}

function TreeNodeItem({ node, overrides, onOverride }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const effectiveWidget = overrides[node.id] ?? node.widgetType;
  const icon = WIDGET_ICONS[effectiveWidget];
  const label = WIDGET_LABELS[effectiveWidget];
  const isContainer = effectiveWidget === 'container';

  return (
    <div>
      <div
        className={`group relative flex items-start gap-2 px-3 py-2.5 rounded-lg mb-1 border transition-all
          ${isContainer
            ? 'bg-white border-blue-100 border-l-4 border-l-blue-500'
            : 'bg-white border-gray-100 border-l-4 border-l-emerald-400 ml-5'
          }`}
      >
        {hasChildren && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {!hasChildren && <span className="w-[14px] flex-shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm">{icon}</span>
            <span className="text-sm font-semibold text-gray-800">{label}</span>
            <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 rounded px-1.5 py-0.5 leading-none">
              {node.badge}
            </span>
            {isContainer && node.layoutDirection === 'row' && (
              <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 rounded px-1.5 py-0.5 leading-none">
                {node.columnCount}-col row
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{node.preview}</p>
        </div>

        <div className="relative flex-shrink-0">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="text-[11px] text-blue-500 hover:text-blue-700 font-medium flex items-center gap-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Change type <ChevronDown size={10} />
          </button>
          {dropdownOpen && (
            <WidgetDropdown
              nodeId={node.id}
              current={effectiveWidget}
              onSelect={onOverride}
              onClose={() => setDropdownOpen(false)}
            />
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="ml-4 pl-3 border-l border-gray-100">
          {node.children.map(child => (
            <TreeNodeItem key={child.id} node={child} overrides={overrides} onOverride={onOverride} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ElementTree({ nodes, overrides, onOverride }: ElementTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No elements found in the HTML file.
      </div>
    );
  }

  return (
    <div className="p-4">
      {nodes.map(node => (
        <TreeNodeItem key={node.id} node={node} overrides={overrides} onOverride={onOverride} />
      ))}
    </div>
  );
}
