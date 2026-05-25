import type { ElementNode, WidgetType } from './converter';

export type AIProvider = 'claude' | 'openai';

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

const CLAUDE_MODELS = ['claude-sonnet-4-5', 'claude-3-5-haiku-20241022', 'claude-opus-4-5'];
const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];

export const PROVIDER_MODELS: Record<AIProvider, string[]> = {
  claude: CLAUDE_MODELS,
  openai: OPENAI_MODELS,
};

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  claude: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
};

const SETTINGS_KEY = 'converwe_ai_config';

export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AIConfig;
  } catch {
    return null;
  }
}

export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
}

export function clearAIConfig(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

// Flatten the element tree into a compact representation for the prompt
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

  return `You are an expert HTML structure analyzer and Elementor (WordPress page builder) conversion engine.

Analyze the raw HTML + pre-parsed DOM tree and return corrected widget classifications and structural improvements.

GOAL: Improve accuracy of HTML -> Elementor widget mapping by correcting wrong classifications, improving layout grouping, ensuring proper widget selection, and fixing icon-related structures.

VALID WIDGET TYPES (use ONLY these):
heading, text-editor, image, button, video, icon, icon-box, image-box, divider, spacer, nav-menu, image-carousel, google_maps, form, html, container

CRITICAL RULES:

1. ICON LOGIC (HIGHEST PRIORITY)
   A. ICON + TEXT COMBINATION: If a block contains an icon (<i>, <svg>, font-awesome, material icons) AND a title/heading/text in the same logical block (same parent or grouped UI block), classify the PARENT as "icon-box" (NOT separate icon + heading + text widgets). Mark the inner icon/heading/text children as merged into the parent icon-box.
      Example:
        <div class="feature"><i class="fa fa-star"></i><h3>Premium</h3><p>Best</p></div>
        -> parent = icon-box
   B. ICON ONLY: If only an icon exists with no meaningful text in the block, classify as "icon".
   C. EDGE CASES:
      - Icon inside a <button> -> stays part of "button"
      - Icon inside a nav item -> part of "nav-menu"
      - Decorative-only icons -> ignore unless semantically important
   D. Raw SVG icons not captured should use "html" widget with the SVG in settingsPatch.html.

2. LAYOUT GROUPING
   - heading + paragraph in same block -> same container
   - icon + title + text -> icon-box (rule 1A)
   - repeated cards -> grid/row container

3. TEXT HANDLING
   - Do NOT split inline text. <p>Hello <strong>world</strong></p> stays a SINGLE "text-editor" with rich text preserved.

4. IMAGES
   - <img>, background-image, lazy-loaded (data-src) all count
   - single image -> "image"
   - gallery / repeated images -> "image-carousel"
   - image + text card -> "image-box"

5. NAV MENU (STRICT): Only classify as "nav-menu" if <nav> exists OR there is a structured list of 4+ links.

6. FORM (STRICT): Only classify as "form" if a real <form> tag exists. Do NOT guess forms from divs.

7. BUTTONS: CTA anchor tags or styled clickable links -> "button".

QUALITY RULES:
- Prefer structural accuracy over guesswork.
- Use context (siblings, parent, children).
- Do NOT over-split widgets.
- Do NOT hallucinate missing elements.
- If uncertain, choose the safer generic type ("text-editor" or "container").
- ALWAYS prioritize the icon-box rule when icon + text coexist.

HTML snippet (first 3000 chars):
\`\`\`html
${htmlSnippet.slice(0, 3000)}
\`\`\`

Detected element tree:
\`\`\`
${tree}
\`\`\`

Respond ONLY with a JSON object in this EXACT format (no markdown fences, no commentary outside JSON):
{
  "summary": "brief plain-English summary of what was fixed",
  "fixes": [
    {
      "id": "el_X_xxxxx",
      "field": "widgetType",
      "widgetType": "icon-box",
      "reason": "Icon + heading + paragraph in same block -> icon-box"
    },
    {
      "id": "el_Y_yyyyy",
      "field": "settings",
      "settingsPatch": { "html": "<svg>...</svg>" },
      "reason": "SVG icon was not captured, adding raw SVG to html widget"
    }
  ]
}

Only include fixes where you are confident. If nothing needs fixing, return an empty fixes array.`;
}


export async function testAIConnection(
  config: AIConfig,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/functions/v1/ai-analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      prompt: 'Reply with exactly: {"summary":"ok","fixes":[]}',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Connection failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { content?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.content) throw new Error('Empty response from API');
}

export async function runAIAnalysis(
  config: AIConfig,
  htmlContent: string,
  nodes: ElementNode[],
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<AIAnalysisResult> {
  const prompt = buildPrompt(htmlContent, nodes);

  const payload = {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    prompt,
  };

  const res = await fetch(`${supabaseUrl}/functions/v1/ai-analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI request failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { content: string; tokensUsed?: number };

  let parsed: { summary: string; fixes: AIFix[] };
  try {
    // Strip potential markdown fences the model might add despite instructions
    const clean = data.content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('AI returned invalid JSON. Try again.');
  }

  return {
    fixes: parsed.fixes || [],
    summary: parsed.summary || '',
    tokensUsed: data.tokensUsed,
  };
}
