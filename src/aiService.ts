import type { ElementNode, WidgetType } from './converter';

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

  return `Analyze the raw HTML + parsed DOM tree and return corrected Elementor widget classifications.

VALID WIDGET TYPES (use ONLY these):
heading, text-editor, image, button, video, icon, icon-box, image-box, divider, spacer, nav-menu, image-carousel, google_maps, form, html, container

RULES:
1. ICON LOGIC (HIGHEST PRIORITY)
   A. Icon (<i>/<svg>/font-awesome/material icons) + title/text in the same block -> classify the PARENT as "icon-box".
   B. Icon alone with no meaningful text -> "icon".
   C. Icon inside a <button> stays part of "button". Icon inside a nav item stays part of "nav-menu".
   D. Raw SVG that wasn't captured -> use "html" widget with the SVG in settingsPatch.html.

2. LAYOUT: group heading+paragraph in same container; group repeated cards into row/grid container.

3. TEXT: don't split inline text. <p>Hello <strong>world</strong></p> stays a SINGLE "text-editor" with rich text preserved.

4. IMAGES: <img>, background-image, lazy-loaded (data-src) all count. single -> "image"; gallery -> "image-carousel"; image+text card -> "image-box".

5. NAV-MENU (STRICT): only when <nav> exists OR 4+ structured links.

6. FORM (STRICT): only when a real <form> tag exists. Do NOT guess forms from divs.

7. Use context (parent, siblings, children). Prefer accuracy over guesswork. If uncertain pick safer generic ("text-editor" or "container"). ALWAYS prioritize icon-box when icon + text coexist.

HTML snippet (first 3000 chars):
\`\`\`html
${htmlSnippet.slice(0, 3000)}
\`\`\`

Detected element tree:
\`\`\`
${tree}
\`\`\`

Respond ONLY with a JSON object in this EXACT format (no markdown fences, no commentary):
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
      "reason": "SVG icon was not captured"
    }
  ]
}

Only include fixes you're confident about. If nothing needs fixing, return an empty fixes array.`;
}

async function callGateway(
  body: Record<string, unknown>,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<{ content: string; tokensUsed?: number }> {
  const res = await fetch(`${supabaseUrl}/functions/v1/ai-analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `AI request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  return await res.json() as { content: string; tokensUsed?: number };
}

export async function testAIConnection(
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<void> {
  const data = await callGateway({ prompt: 'Reply with exactly: {"summary":"ok","fixes":[]}' }, supabaseUrl, supabaseAnonKey);
  if (!data.content) throw new Error('Empty response from AI');
}

export async function runAIAnalysis(
  htmlContent: string,
  nodes: ElementNode[],
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<AIAnalysisResult> {
  const prompt = buildPrompt(htmlContent, nodes);
  const data = await callGateway({ prompt }, supabaseUrl, supabaseAnonKey);

  let parsed: { summary: string; fixes: AIFix[] };
  try {
    const clean = data.content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
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
