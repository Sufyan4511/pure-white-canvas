import type { ElementNode, WidgetType } from './converter';

export type AIProvider = 'openai' | 'anthropic';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

export interface AIFix {
  id: string;
  field: 'widgetType' | 'settings';
  widgetType?: WidgetType;
  settingsPatch?: Record<string, unknown>;
  reason: string;
}

export interface AIAnalysisResult {
  fixes: AIFix[];
  summary: string;
  tokensUsed?: number;
}

export const OPENAI_MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
];

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
];

function flattenNodes(nodes: ElementNode[], depth = 0): Array<{ id: string; depth: number; widgetType: string; badge: string; preview: string; childCount: number }> {
  const result: ReturnType<typeof flattenNodes> = [];
  for (const node of nodes) {
    result.push({ id: node.id, depth, widgetType: node.widgetType, badge: node.badge, preview: node.preview, childCount: node.children.length });
    if (node.children.length > 0) result.push(...flattenNodes(node.children, depth + 1));
  }
  return result;
}

function buildPrompt(htmlSnippet: string, nodes: ElementNode[]): string {
  const flat = flattenNodes(nodes);
  const tree = flat.map(n =>
    `${'  '.repeat(n.depth)}[${n.id}] ${n.widgetType} <${n.badge}> "${n.preview}" (${n.childCount} children)`
  ).join('\n');

  return `Analyze the raw HTML + parsed DOM tree and return corrected Elementor widget classifications.

VALID WIDGET TYPES (use ONLY these):
heading, text-editor, image, button, video, icon, icon-box, image-box, divider, spacer, nav-menu, image-carousel, google_maps, form, html, container

RULES:
1. ICON-BOX (STRICT): only when a SMALL card (<=4 children, text < 280 chars) has a shallow icon + heading or short text.
   Do NOT classify <section>, <header>, <footer>, <main>, <article>, <aside>, <nav> as icon-box even if an icon exists somewhere inside.
2. Icon inside <button>/<a> stays part of the button. Icon inside nav stays part of nav-menu.
3. LAYOUT: keep heading+paragraph in the same container; repeated cards -> row/grid container.
4. TEXT: don't split inline text. <p>Hello <strong>world</strong></p> = ONE text-editor.
5. IMAGES: single -> image; gallery/carousel -> image-carousel; image+caption card -> image-box.
6. NAV-MENU: only <nav> or 4+ structured links.
7. FORM: only when a real <form> tag exists.
8. Prefer accuracy. If uncertain, pick safer generic (text-editor or container).

HTML snippet (first 3000 chars):
\`\`\`html
${htmlSnippet.slice(0, 3000)}
\`\`\`

Detected element tree:
\`\`\`
${tree}
\`\`\`

Respond ONLY with a JSON object (no markdown fences):
{"summary":"...","fixes":[{"id":"el_X","field":"widgetType","widgetType":"icon-box","reason":"..."}]}

Only include fixes you're confident about.`;
}

async function callOpenAI(prompt: string, config: AIConfig): Promise<{ content: string; tokensUsed?: number }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: 'You are an expert HTML→Elementor converter. Respond ONLY with valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? '', tokensUsed: data.usage?.total_tokens };
}

async function callAnthropic(prompt: string, config: AIConfig): Promise<{ content: string; tokensUsed?: number }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: 'You are an expert HTML→Elementor converter. Respond ONLY with a valid JSON object, no markdown fences or commentary.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic error (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = Array.isArray(data.content) ? data.content.map((c: { text?: string }) => c.text || '').join('') : '';
  const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  return { content, tokensUsed };
}

async function callAI(prompt: string, config: AIConfig) {
  if (!config.apiKey) throw new Error('Missing API key.');
  return config.provider === 'anthropic' ? callAnthropic(prompt, config) : callOpenAI(prompt, config);
}

export async function testAIConnection(config: AIConfig): Promise<void> {
  const data = await callAI('Reply with exactly: {"summary":"ok","fixes":[]}', config);
  if (!data.content) throw new Error('Empty response from AI.');
}

export async function runAIAnalysis(htmlContent: string, nodes: ElementNode[], config: AIConfig): Promise<AIAnalysisResult> {
  const prompt = buildPrompt(htmlContent, nodes);
  const data = await callAI(prompt, config);
  let parsed: { summary: string; fixes: AIFix[] };
  try {
    const clean = data.content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('AI returned invalid JSON. Try again.');
  }
  return { fixes: parsed.fixes || [], summary: parsed.summary || '', tokensUsed: data.tokensUsed };
}
