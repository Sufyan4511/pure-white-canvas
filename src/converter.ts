export type WidgetType =
  | 'heading'
  | 'text-editor'
  | 'image'
  | 'button'
  | 'video'
  | 'icon'
  | 'icon-box'
  | 'image-box'
  | 'divider'
  | 'spacer'
  | 'nav-menu'
  | 'image-carousel'
  | 'google_maps'
  | 'form'
  | 'html'
  | 'container';

export const WIDGET_LABELS: Record<WidgetType, string> = {
  'heading': 'Heading',
  'text-editor': 'Text Editor',
  'image': 'Image',
  'button': 'Button',
  'video': 'Video',
  'icon': 'Icon',
  'icon-box': 'Icon Box',
  'image-box': 'Image Box',
  'divider': 'Divider',
  'spacer': 'Spacer',
  'nav-menu': 'Nav Menu',
  'image-carousel': 'Image Carousel',
  'google_maps': 'Map',
  'form': 'Form',
  'html': 'HTML',
  'container': 'Container',
};

export const WIDGET_ICONS: Record<WidgetType, string> = {
  'heading': '🔤',
  'text-editor': '📝',
  'image': '🖼',
  'button': '🔘',
  'video': '▶️',
  'icon': '✨',
  'icon-box': '📦',
  'image-box': '🖼',
  'divider': '➖',
  'spacer': '⬜',
  'nav-menu': '☰',
  'image-carousel': '🎠',
  'google_maps': '🗺',
  'form': '📋',
  'html': '🔲',
  'container': '📦',
};

export const COMPATIBLE_WIDGETS: WidgetType[] = [
  'heading', 'text-editor', 'image', 'button', 'video', 'icon', 'icon-box',
  'image-box', 'divider', 'spacer', 'nav-menu', 'image-carousel', 'google_maps',
  'form', 'html', 'container',
];

export interface ElementNode {
  id: string;
  widgetType: WidgetType;
  badge: string;
  preview: string;
  children: ElementNode[];
  depth: number;
  htmlElement: string;
  settings: Record<string, unknown>;
  layoutDirection: 'row' | 'column';
  columnCount: number;
}

let idCounter = 0;
function nextId(): string {
  return `el_${++idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

// Generate an 8-character hex ID matching Elementor's format
function elementorId(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0').slice(0, 8);
}

// Elementor dimension object with sizes[] array (required format)
function dim(size: number, unit = 'px'): Record<string, unknown> {
  return { unit, size, sizes: [] };
}

// Elementor spacing object (padding/margin/border)
function spacing(top: string, right: string, bottom: string, left: string, unit = 'px', isLinked = false): Record<string, unknown> {
  return { unit, top, right, bottom, left, isLinked };
}

function spacingLinked(val: string, unit = 'px'): Record<string, unknown> {
  return { unit, top: val, right: val, bottom: val, left: val, isLinked: true };
}

function spacingZero(): Record<string, unknown> {
  return spacingLinked('0');
}

// Elementor flex_gap object (correct format with column/row/isLinked)
function flexGap(size: number, unit = 'px'): Record<string, unknown> {
  return { unit, size, column: String(size), row: String(size), isLinked: true };
}

// --- Style extraction ---

interface ParsedStyles {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  textTransform?: string;
  textDecoration?: string;
  lineHeight?: string;
  letterSpacing?: string;
  borderRadius?: string;
  borderColor?: string;
  borderWidth?: string;
  borderStyle?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  width?: string;
  maxWidth?: string;
  height?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  opacity?: string;
  boxShadow?: string;
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  gridTemplateColumns?: string;
}

function parseInlineStyle(raw: string): ParsedStyles {
  const styles: ParsedStyles = {};
  if (!raw) return styles;
  raw.split(';').forEach(decl => {
    const colonIdx = decl.indexOf(':');
    if (colonIdx < 0) return;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    let val = decl.slice(colonIdx + 1).trim();
    if (!prop || !val) return;

    // Handle font shorthand: "font: bold 16px/1.5 Arial" → extract components
    if (prop === 'font') {
      // Extract line-height from size/line-height pair
      const lhMatch = val.match(/(\d[\d.]*(?:px|em|rem|%)?)\/(\d[\d.]*(?:px|em|rem|%)?)/);
      if (lhMatch) {
        styles.fontSize = lhMatch[1];
        styles.lineHeight = lhMatch[2];
      }
      // Extract font-weight keyword
      const weightMatch = val.match(/\b(bold|bolder|lighter|100|200|300|400|500|600|700|800|900)\b/);
      if (weightMatch) styles.fontWeight = weightMatch[1];
      return;
    }

    const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) as keyof ParsedStyles;
    (styles as Record<string, string>)[camel] = val;
  });
  return styles;
}

interface StyleMapResult {
  computedStyles: Map<Element, ParsedStyles>;
  // Full custom_css string per element (using Elementor's "selector" placeholder)
  customCssPerElement: Map<Element, string>;
}

// Tokenise raw CSS into a flat list of top-level blocks (handles nested @rules)
interface CssBlock {
  selector: string;    // e.g. ".foo:hover" or "@keyframes spin" or "@media (max-width:768px)"
  body: string;        // the raw text between the outermost { }
  isAtRule: boolean;
}

function parseCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  let i = 0;
  const len = css.length;

  while (i < len) {
    // Skip whitespace and comments
    const commentStart = css.indexOf('/*', i);
    const nextBrace = css.indexOf('{', i);
    if (nextBrace === -1) break;

    // Skip over comment if it comes before the next brace
    if (commentStart !== -1 && commentStart < nextBrace) {
      const commentEnd = css.indexOf('*/', commentStart + 2);
      i = commentEnd === -1 ? len : commentEnd + 2;
      continue;
    }

    const selectorRaw = css.slice(i, nextBrace).trim();
    // Find the matching closing brace, accounting for nesting
    let depth = 0;
    let j = nextBrace;
    while (j < len) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const body = css.slice(nextBrace + 1, j).trim();
    const isAtRule = selectorRaw.startsWith('@');
    blocks.push({ selector: selectorRaw, body, isAtRule });
    i = j + 1;
  }
  return blocks;
}

// Build Elementor custom_css for an element:
// - Rules that directly target this element become "selector { ... }"
// - Pseudo-selectors/states become "selector:hover { ... }" etc.
// - @keyframes referenced by the element's animation are included verbatim
// - @media rules whose inner rules target this element are included
function buildCustomCss(el: Element, blocks: CssBlock[]): string {
  const parts: string[] = [];
  const referencedKeyframes = new Set<string>();

  // Collect all classes and id for matching
  const elClasses = Array.from(el.classList);
  const elId = el.id;

  function selectorMatchesEl(sel: string): boolean {
    // Clean up whitespace-only descendant selectors — only match direct element selectors
    // (we don't want ancestor rules to pollute the element's own custom_css)
    const trimmed = sel.trim();
    // Skip rules with descendant combinators (space), child (>), sibling (+~)
    // unless it's a pseudo-selector of a direct match
    const withoutPseudo = trimmed.replace(/::?[\w-]+(\([^)]*\))?/g, '');
    if (/[\s>+~]/.test(withoutPseudo)) return false;
    try { return el.matches(trimmed); } catch { return false; }
  }

  function selectorToElementor(sel: string): string {
    // Replace the base selector part with "selector", keep pseudo-selectors
    const trimmed = sel.trim();
    // Extract pseudo part (e.g. ":hover", "::before", ":nth-child(2)")
    const pseudoMatch = trimmed.match(/(:{1,2}[\w-]+(?:\([^)]*\))?)+$/);
    const pseudo = pseudoMatch ? pseudoMatch[0] : '';
    return `selector${pseudo}`;
  }

  // Process regular (non-@) rules first
  for (const block of blocks) {
    if (block.isAtRule) continue;
    const selectors = block.selector.split(',').map(s => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      if (!selectorMatchesEl(sel)) continue;
      const elementorSel = selectorToElementor(sel);
      parts.push(`${elementorSel} {\n${block.body}\n}`);
    }
  }

  // Collect animation names used on this element to pull in @keyframes
  const computedAnim = (el.getAttribute('style') || '').match(/animation(?:-name)?\s*:\s*([\w-]+)/)?.[1];
  if (computedAnim) referencedKeyframes.add(computedAnim);

  // Check class-based animations already captured
  for (const block of blocks) {
    if (block.isAtRule) continue;
    const selectors = block.selector.split(',').map(s => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      if (!selectorMatchesEl(sel)) continue;
      const animMatch = block.body.match(/animation(?:-name)?\s*:\s*([\w-]+)/);
      if (animMatch) referencedKeyframes.add(animMatch[1]);
    }
  }

  // Add @keyframes blocks that are referenced
  for (const block of blocks) {
    if (!block.isAtRule) continue;
    const keyframeMatch = block.selector.match(/^@keyframes\s+([\w-]+)/);
    if (keyframeMatch && referencedKeyframes.has(keyframeMatch[1])) {
      parts.push(`${block.selector} {\n${block.body}\n}`);
    }
  }

  // Process @media blocks — extract inner rules that match this element
  for (const block of blocks) {
    if (!block.isAtRule) continue;
    if (!block.selector.startsWith('@media')) continue;

    // Parse inner rules of the @media block
    const innerBlocks = parseCssBlocks(block.body);
    const matchedInner: string[] = [];

    for (const inner of innerBlocks) {
      if (inner.isAtRule) continue;
      const selectors = inner.selector.split(',').map(s => s.trim()).filter(Boolean);
      for (const sel of selectors) {
        if (!selectorMatchesEl(sel)) {
          // Also check descendant rules that contain this element's classes
          const hasClass = elClasses.some(cls => sel.includes(`.${cls}`));
          const hasId = elId && sel.includes(`#${elId}`);
          if (!hasClass && !hasId) continue;
        }
        const elementorSel = selectorToElementor(sel);
        matchedInner.push(`  ${elementorSel} {\n${inner.body.split('\n').map(l => '    ' + l).join('\n')}\n  }`);
        break;
      }
    }

    if (matchedInner.length > 0) {
      parts.push(`${block.selector} {\n${matchedInner.join('\n')}\n}`);
    }
  }

  return parts.join('\n\n');
}

function buildStyleMap(doc: Document): StyleMapResult {
  const computedStyles = new Map<Element, ParsedStyles>();
  const customCssPerElement = new Map<Element, string>();

  interface Rule { selector: string; declarations: ParsedStyles }
  const rules: Rule[] = [];
  let allRawCss = '';

  doc.querySelectorAll('style').forEach(styleEl => {
    const text = styleEl.textContent || '';
    allRawCss += text + '\n';
    // Extract flat rules for computed style merging (single-level only)
    const flatRuleRegex = /^([^@{][^{]*)\{([^{}]*)\}/gm;
    let match: RegExpExecArray | null;
    while ((match = flatRuleRegex.exec(text)) !== null) {
      const selectors = match[1].split(',').map(s => s.trim()).filter(Boolean);
      const declarations = parseInlineStyle(match[2]);
      selectors.forEach(sel => rules.push({ selector: sel, declarations }));
    }
  });

  // Parse all CSS blocks once for custom_css building
  const allBlocks = parseCssBlocks(allRawCss);

  doc.body.querySelectorAll('*').forEach(el => {
    const merged: ParsedStyles = {};
    for (const rule of rules) {
      try {
        if (el.matches(rule.selector)) Object.assign(merged, rule.declarations);
      } catch { /* invalid selector */ }
    }
    const inline = el.getAttribute('style');
    if (inline) Object.assign(merged, parseInlineStyle(inline));
    if (Object.keys(merged).length > 0) computedStyles.set(el, merged);

    // Build custom_css for this element (works for both containers and widgets)
    const css = buildCustomCss(el, allBlocks);
    if (css) customCssPerElement.set(el, css);
  });

  return { computedStyles, customCssPerElement };
}

// --- Style → Elementor settings conversion ---

function parseSize(val: string | undefined): { size: number; unit: string } | null {
  if (!val) return null;
  const trimmed = val.trim();
  // Handle bare zero with no unit
  if (trimmed === '0') return { size: 0, unit: 'px' };
  const match = trimmed.match(/^(-?[\d.]+)\s*(px|em|rem|%|vw|vh|fr|deg)?$/);
  if (!match) return null;
  return { size: parseFloat(match[1]), unit: match[2] || 'px' };
}

function normalizeColor(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'transparent' || trimmed === 'inherit' || trimmed === 'initial' || trimmed === 'currentcolor') return undefined;
  // Skip CSS variables — Elementor won't resolve them
  if (trimmed.startsWith('var(')) return undefined;
  return trimmed;
}

// Parse a line-height value — unitless numbers like 1.5 mean "em" in Elementor
function parseLineHeight(val: string | undefined): { size: number; unit: string } | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (trimmed === 'normal') return null;
  // Unitless decimal/integer (e.g. "1.5", "2") → treat as em in Elementor
  const unitless = trimmed.match(/^(-?[\d.]+)$/);
  if (unitless) return { size: parseFloat(unitless[1]), unit: 'em' };
  return parseSize(trimmed);
}

function extractTypography(styles: ParsedStyles): Record<string, unknown> {
  const typo: Record<string, unknown> = {};
  if (styles.fontFamily) typo.font_family = styles.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  const fs = parseSize(styles.fontSize);
  if (fs) typo.font_size = { unit: fs.unit, size: fs.size, sizes: [] };
  if (styles.fontWeight) typo.font_weight = styles.fontWeight;
  if (styles.fontStyle) typo.font_style = styles.fontStyle;
  if (styles.textTransform) typo.text_transform = styles.textTransform;
  if (styles.textDecoration) typo.text_decoration = styles.textDecoration;
  const lh = parseLineHeight(styles.lineHeight);
  if (lh) typo.line_height = { unit: lh.unit, size: lh.size, sizes: [] };
  const ls = parseSize(styles.letterSpacing);
  if (ls) typo.letter_spacing = { unit: ls.unit, size: ls.size, sizes: [] };
  return Object.keys(typo).length > 0 ? typo : {};
}

function parseSpacingShorthand(val: string): Record<string, unknown> | null {
  const parts = val.trim().split(/\s+/);
  const parsed = parts.map(p => parseSize(p));
  if (parsed.some(p => p === null)) return null;
  const ps = parsed as Array<{ size: number; unit: string }>;
  // Use the dominant (first non-zero) unit; fall back to px
  const unit = ps.find(p => p.size !== 0)?.unit || ps[0]?.unit || 'px';
  if (ps.length === 1) return spacing(String(ps[0].size), String(ps[0].size), String(ps[0].size), String(ps[0].size), unit, true);
  if (ps.length === 2) return spacing(String(ps[0].size), String(ps[1].size), String(ps[0].size), String(ps[1].size), unit, false);
  if (ps.length === 3) return spacing(String(ps[0].size), String(ps[1].size), String(ps[2].size), String(ps[1].size), unit, false);
  if (ps.length === 4) return spacing(String(ps[0].size), String(ps[1].size), String(ps[2].size), String(ps[3].size), unit, false);
  return null;
}

function extractSpacing(styles: ParsedStyles, prefix: 'padding' | 'margin'): Record<string, unknown> | null {
  const shorthand = prefix === 'padding' ? styles.padding : styles.margin;
  if (shorthand) return parseSpacingShorthand(shorthand);
  const t = parseSize(prefix === 'padding' ? styles.paddingTop : styles.marginTop);
  const r = parseSize(prefix === 'padding' ? styles.paddingRight : styles.marginRight);
  const b = parseSize(prefix === 'padding' ? styles.paddingBottom : styles.marginBottom);
  const l = parseSize(prefix === 'padding' ? styles.paddingLeft : styles.marginLeft);
  if (t !== null || r !== null || b !== null || l !== null) {
    // Use the dominant unit from whichever sides are defined
    const unit = [t, r, b, l].find(v => v !== null && v.size !== 0)?.unit
      || [t, r, b, l].find(v => v !== null)?.unit
      || 'px';
    return spacing(
      String(t?.size ?? 0),
      String(r?.size ?? 0),
      String(b?.size ?? 0),
      String(l?.size ?? 0),
      unit,
      false
    );
  }
  return null;
}

function extractBorderRadius(styles: ParsedStyles): Record<string, unknown> | null {
  if (!styles.borderRadius) return null;
  const parts = styles.borderRadius.split(/\s+/);
  const parsed = parts.map(p => parseSize(p)).filter(Boolean);
  if (!parsed.length) return null;
  const unit = parsed[0]!.unit;
  if (parsed.length === 1) return spacing(String(parsed[0]!.size), String(parsed[0]!.size), String(parsed[0]!.size), String(parsed[0]!.size), unit, true);
  if (parsed.length === 4) return spacing(String(parsed[0]!.size), String(parsed[1]!.size), String(parsed[2]!.size), String(parsed[3]!.size), unit, false);
  return spacing(String(parsed[0]!.size), String(parsed[0]!.size), String(parsed[0]!.size), String(parsed[0]!.size), unit, true);
}

function extractBoxShadow(val: string | undefined): Record<string, unknown> | null {
  if (!val || val === 'none') return null;
  const match = val.match(/([-\d.]+)px\s+([-\d.]+)px\s+([\d.]+)px\s*(?:([-\d.]+)px)?\s*(.*)/);
  if (!match) return null;
  return {
    horizontal: parseFloat(match[1]),
    vertical: parseFloat(match[2]),
    blur: parseFloat(match[3]),
    spread: match[4] ? parseFloat(match[4]) : 0,
    color: match[5]?.trim() || 'rgba(0,0,0,0.15)',
    position: 'outset',
  };
}

// Map styles to Elementor settings with CORRECT key names per widget type
function stylesToElementorSettings(styles: ParsedStyles, widgetType: WidgetType): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const isWidget = widgetType !== 'container';
  const isButton = widgetType === 'button';

  // Text color
  const color = normalizeColor(styles.color);
  if (color) {
    if (widgetType === 'heading') s.title_color = color;
    else if (isButton) s.button_text_color = color;
    else s.text_color = color;
  }

  // Background color
  const bgColor = normalizeColor(styles.backgroundColor);
  if (bgColor) {
    if (isButton) {
      // Buttons use background_color directly (no background_background wrapper)
      s.background_color = bgColor;
    } else {
      s.background_background = 'classic';
      s.background_color = bgColor;
    }
  }

  // Background image (containers only)
  if (!isWidget && styles.backgroundImage && styles.backgroundImage !== 'none') {
    const urlMatch = styles.backgroundImage.match(/url\(['"]?(.+?)['"]?\)/);
    if (urlMatch) {
      s.background_background = 'classic';
      s.background_image = { url: urlMatch[1], id: '', size: '' };
      if (styles.backgroundSize) s.background_size = styles.backgroundSize;
      if (styles.backgroundPosition) s.background_position = styles.backgroundPosition;
    }
  }

  // Typography
  const typo = extractTypography(styles);
  if (Object.keys(typo).length > 0) {
    s.typography_typography = 'custom';
    Object.entries(typo).forEach(([k, v]) => { s[`typography_${k}`] = v; });
  }

  // Text align
  if (styles.textAlign) s.align = styles.textAlign;

  // Padding
  const pad = extractSpacing(styles, 'padding');
  if (pad) {
    if (isButton) {
      s.text_padding = pad;
    } else if (isWidget) {
      s._padding = pad;
    } else {
      s.padding = pad;
    }
  }

  // Margin
  const mar = extractSpacing(styles, 'margin');
  if (mar) {
    if (isWidget) s._margin = mar;
    else s.margin = mar;
  }

  // Border radius
  const radius = extractBorderRadius(styles);
  if (radius) {
    if (isWidget) {
      s.border_radius = radius; // both buttons and other widgets use border_radius
    } else {
      s.border_radius = radius; // containers too
    }
  }

  // Border
  if (styles.borderWidth || styles.borderColor || styles.borderStyle) {
    const bw = parseSize(styles.borderWidth);
    if (isWidget) {
      s._border_border = styles.borderStyle || 'solid';
      if (bw) s._border_width = spacing(String(bw.size), String(bw.size), String(bw.size), String(bw.size), bw.unit, true);
      if (styles.borderColor) s._border_color = normalizeColor(styles.borderColor);
    } else {
      s.border_border = styles.borderStyle || 'solid';
      if (bw) s.border_width = spacing(String(bw.size), String(bw.size), String(bw.size), String(bw.size), bw.unit, true);
      if (styles.borderColor) s.border_color = normalizeColor(styles.borderColor);
    }
  }

  // Box shadow
  const shadow = extractBoxShadow(styles.boxShadow);
  if (shadow) {
    s.box_shadow_box_shadow_type = 'yes';
    s.box_shadow_box_shadow = shadow;
  }

  // Opacity
  if (styles.opacity && styles.opacity !== '1') {
    const opVal = parseFloat(styles.opacity);
    if (!isNaN(opVal)) s.opacity = { size: opVal, unit: '' };
  }

  // Width/max-width
  const widthSize = parseSize(styles.width);
  if (widthSize && !isButton && widgetType !== 'container') {
    s._element_width = 'initial';
    s._element_custom_width = dim(widthSize.size, widthSize.unit);
  }
  if (widthSize && widgetType === 'container') {
    s.width = dim(widthSize.size, widthSize.unit);
  }
  const maxWidthSize = parseSize(styles.maxWidth);
  if (maxWidthSize && widgetType === 'container') {
    s.max_width = dim(maxWidthSize.size, maxWidthSize.unit);
  }

  return s;
}

// --- Detection helpers ---

function isYoutubeOrVimeo(src: string): boolean {
  return /youtube\.com|youtu\.be|vimeo\.com/.test(src);
}

function isGoogleMaps(src: string): boolean {
  return /maps\.google\.com|google\.com\/maps/.test(src);
}

function hasIconClass(el: Element): boolean {
  const cls = el.className || '';
  return /fa-|fa |icon|glyphicon|material-icons/.test(cls);
}

function isEmptySpacingDiv(el: Element): boolean {
  if (el.children.length > 0) return false;
  const text = el.textContent?.trim() || '';
  if (text.length > 0) return false;
  const style = el.getAttribute('style') || '';
  return /height|min-height|padding-top|padding-bottom/.test(style);
}

function isContainerTag(tag: string): boolean {
  return ['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure', 'figcaption'].includes(tag);
}

function hasDirectTextContent(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent?.trim() || '').length > 0) return true;
  }
  return false;
}

function detectLayoutDirection(el: Element, childCount: number, styles: ParsedStyles): { direction: 'row' | 'column'; columns: number } {
  const cls = (el.getAttribute('class') || '').toLowerCase();

  if (styles.display === 'flex' || styles.display === 'inline-flex') {
    const dir = styles.flexDirection || 'row';
    return dir.startsWith('row') ? { direction: 'row', columns: childCount } : { direction: 'column', columns: 1 };
  }

  if (styles.display === 'grid' || styles.display === 'inline-grid') {
    const cols = styles.gridTemplateColumns || '';
    const colCount = cols.split(/\s+/).filter(v => v && v !== '/' && v !== 'none').length;
    return { direction: 'row', columns: colCount > 0 ? colCount : childCount };
  }

  if (/\b(row|flex-row|d-flex|flex|grid|columns|cols)\b/.test(cls)) {
    const colMatch = cls.match(/\b(?:grid-cols-|columns-|col-)(\d+)\b/);
    if (colMatch) return { direction: 'row', columns: parseInt(colMatch[1]) };
    if (/\b(row|flex-row|d-flex)\b/.test(cls)) return { direction: 'row', columns: childCount };
    if (/\bgrid\b/.test(cls)) {
      const gridColMatch = cls.match(/grid-cols-(\d+)/);
      if (gridColMatch) return { direction: 'row', columns: parseInt(gridColMatch[1]) };
      return { direction: 'row', columns: childCount };
    }
  }

  if (childCount >= 2 && childCount <= 6) {
    const children = Array.from(el.children);
    const allDivLike = children.every(c => ['div', 'article', 'section', 'aside'].includes(c.tagName.toLowerCase()));
    const childrenHaveColClasses = children.some(c => {
      const ccls = (c.getAttribute('class') || '').toLowerCase();
      return /\b(col|column|cell|grid-item|card)\b/.test(ccls);
    });
    if (allDivLike && childrenHaveColClasses) return { direction: 'row', columns: childCount };
    if (allDivLike && /\b(features|cards|services|pricing|team|testimonials|benefits|grid|gallery|items|list|columns|row|wrapper)\b/.test(cls)) {
      return { direction: 'row', columns: childCount };
    }
  }

  return { direction: 'column', columns: 1 };
}

function detectWidgetType(el: Element, styles: ParsedStyles): { widget: WidgetType; badge: string; preview: string; settings: Record<string, unknown> } {
  const tag = el.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    const ss = stylesToElementorSettings(styles, 'heading');
    return {
      widget: 'heading',
      badge: tag.toUpperCase(),
      preview: `"${(el.textContent?.trim() || '').slice(0, 80)}"`,
      settings: { title: el.innerHTML, header_size: tag, ...ss },
    };
  }

  if (tag === 'hr') {
    const ss = stylesToElementorSettings(styles, 'divider');
    return { widget: 'divider', badge: 'hr', preview: 'Horizontal rule', settings: { ...ss } };
  }

  if (tag === 'form') {
    return { widget: 'form', badge: 'form', preview: 'Form element', settings: { form_html: el.outerHTML } };
  }

  if (tag === 'nav') {
    const items = el.querySelectorAll('a');
    const links = Array.from(items).map(a => ({ text: a.textContent?.trim(), url: a.getAttribute('href') || '' }));
    const ss = stylesToElementorSettings(styles, 'nav-menu');
    return { widget: 'nav-menu', badge: 'nav', preview: `Navigation — ${items.length} links`, settings: { menu_items: links, ...ss } };
  }

  if (tag === 'img') {
    const src = el.getAttribute('src') || '';
    const alt = (el as HTMLImageElement).alt || '';
    const ss = stylesToElementorSettings(styles, 'image');
    return {
      widget: 'image',
      badge: 'img',
      preview: src.split('/').pop() || alt || 'image',
      settings: { image: { url: src, id: '', size: '', alt, source: 'library' }, ...ss },
    };
  }

  if (tag === 'picture') {
    const img = el.querySelector('img');
    const src = img?.getAttribute('src') || '';
    const alt = img?.getAttribute('alt') || '';
    return {
      widget: 'image',
      badge: 'picture',
      preview: src.split('/').pop() || alt || 'image',
      settings: { image: { url: src, id: '', size: '', alt, source: 'library' } },
    };
  }

  if (tag === 'svg') {
    // Inline SVG — serialize to HTML widget so it renders exactly as-is in Elementor
    const svgHtml = el.outerHTML;
    const svgPreview = el.getAttribute('aria-label') || el.querySelector('title')?.textContent || 'SVG icon';
    // Check if it's a small decorative icon (width/height <= 64px or no explicit size)
    const w = parseFloat(el.getAttribute('width') || styles.width || '0');
    const h = parseFloat(el.getAttribute('height') || styles.height || '0');
    const isSmallIcon = (w > 0 && w <= 64) || (h > 0 && h <= 64) || (!w && !h);
    if (isSmallIcon) {
      // Use html widget to preserve the SVG inline
      return {
        widget: 'html',
        badge: 'svg',
        preview: svgPreview.slice(0, 60),
        settings: { html: svgHtml },
      };
    }
    // Large SVG — still use html widget
    return {
      widget: 'html',
      badge: 'svg',
      preview: svgPreview.slice(0, 60),
      settings: { html: svgHtml },
    };
  }

  if (tag !== 'div' && hasIconClass(el)) {
    const text = el.textContent?.trim();
    // Extract Font Awesome class if present
    const cls = el.getAttribute('class') || '';
    const faMatch = cls.match(/\b(fa[sr]?\s+fa-[\w-]+|fas\s+fa-[\w-]+|far\s+fa-[\w-]+|fab\s+fa-[\w-]+|fa-[\w-]+)\b/);
    const iconValue = faMatch ? faMatch[0].trim() : cls.trim();
    if (text && text.length > 2) {
      return { widget: 'icon-box', badge: tag, preview: `icon + "${text.slice(0, 40)}"`, settings: { title: text, selected_icon: { value: iconValue, library: 'fa-solid' } } };
    }
    return { widget: 'icon', badge: tag, preview: iconValue || 'icon', settings: { selected_icon: { value: iconValue, library: 'fa-solid' } } };
  }

  if (tag === 'video') {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    return { widget: 'video', badge: 'video', preview: src.split('/').pop() || 'video', settings: { video_type: 'hosted', link: { url: src } } };
  }

  if (tag === 'iframe') {
    const src = el.getAttribute('src') || '';
    if (isYoutubeOrVimeo(src)) return { widget: 'video', badge: 'iframe', preview: src.slice(0, 60), settings: { video_type: 'youtube', youtube_url: src } };
    if (isGoogleMaps(src)) return { widget: 'google_maps', badge: 'iframe', preview: 'Google Maps', settings: { address: src } };
    return { widget: 'html', badge: 'iframe', preview: `iframe: ${src.slice(0, 50)}`, settings: { html: el.outerHTML } };
  }

  if (tag === 'a') {
    const text = (el.textContent?.trim() || '');
    const href = el.getAttribute('href') || '';
    const innerImg = el.querySelector('img');
    if (innerImg && !text.replace(innerImg.getAttribute('alt') || '', '').trim()) {
      const src = innerImg.getAttribute('src') || '';
      return {
        widget: 'image',
        badge: 'a>img',
        preview: src.split('/').pop() || 'linked image',
        settings: { image: { url: src, id: '', size: '', alt: innerImg.getAttribute('alt') || '', source: 'library' }, link: { url: href } },
      };
    }
    const ss = stylesToElementorSettings(styles, 'button');
    return {
      widget: 'button',
      badge: 'a',
      preview: `"${text.slice(0, 50)}"${href ? ` → ${href}` : ''}`,
      settings: { text, button_type: 'default', link: { url: href }, ...ss },
    };
  }

  if (tag === 'button') {
    const text = el.textContent?.trim() || '';
    const ss = stylesToElementorSettings(styles, 'button');
    return { widget: 'button', badge: 'button', preview: `"${text.slice(0, 50)}"`, settings: { text, button_type: 'default', ...ss } };
  }

  if (tag === 'p') {
    const ss = stylesToElementorSettings(styles, 'text-editor');
    return {
      widget: 'text-editor',
      badge: 'p',
      preview: `"${(el.textContent?.trim() || '').slice(0, 80)}"`,
      settings: { editor: `<p>${el.innerHTML}</p>`, ...ss },
    };
  }

  if (['span', 'label', 'small', 'em', 'strong', 'b', 'i'].includes(tag)) {
    const ss = stylesToElementorSettings(styles, 'text-editor');
    return {
      widget: 'text-editor',
      badge: tag,
      preview: `"${(el.textContent?.trim() || '').slice(0, 80)}"`,
      settings: { editor: el.innerHTML, ...ss },
    };
  }

  if (tag === 'blockquote') {
    const ss = stylesToElementorSettings(styles, 'text-editor');
    return {
      widget: 'text-editor',
      badge: 'blockquote',
      preview: `"${(el.textContent?.trim() || '').slice(0, 60)}"`,
      settings: { editor: `<blockquote>${el.innerHTML}</blockquote>`, ...ss },
    };
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(el.querySelectorAll('li'));
    const hasOnlyImages = items.length > 1 && items.every(li => li.querySelector('img') && !li.textContent?.trim().replace(li.querySelector('img')?.alt || '', '').trim());
    if (hasOnlyImages) {
      const images = items.map(li => {
        const img = li.querySelector('img')!;
        return { url: img.getAttribute('src') || '', id: '', size: '', alt: img.getAttribute('alt') || '', source: 'library' };
      });
      return { widget: 'image-carousel', badge: tag, preview: `${items.length} images`, settings: { carousel: images } };
    }
    const hasLinks = items.some(li => li.querySelector('a'));
    if (hasLinks) {
      const links = items.map(li => {
        const a = li.querySelector('a');
        return { text: a?.textContent?.trim() || li.textContent?.trim() || '', url: a?.getAttribute('href') || '' };
      });
      return { widget: 'nav-menu', badge: tag, preview: `${items.length} nav items`, settings: { menu_items: links } };
    }
    const ss = stylesToElementorSettings(styles, 'text-editor');
    return { widget: 'text-editor', badge: tag, preview: `List — ${items.length} items`, settings: { editor: el.outerHTML, ...ss } };
  }

  if (tag === 'table') {
    return { widget: 'html', badge: 'table', preview: 'Table element', settings: { html: el.outerHTML } };
  }

  if (isContainerTag(tag)) {
    if (isEmptySpacingDiv(el)) {
      const h = parseSize(styles.height || styles.maxWidth || '');
      return { widget: 'spacer', badge: tag, preview: 'Spacing element', settings: { space: dim(h?.size || 30) } };
    }

    const childElements = Array.from(el.children).filter(c => !['script', 'style', 'meta', 'link', 'br'].includes(c.tagName.toLowerCase()));

    // Image-box pattern
    if (childElements.length <= 3) {
      const childImgs = el.querySelectorAll(':scope > img, :scope > picture > img');
      const text = el.textContent?.trim() || '';
      if (childImgs.length === 1 && text.length > 0) {
        const imgSrc = childImgs[0].getAttribute('src') || '';
        const ss = stylesToElementorSettings(styles, 'image-box');
        return {
          widget: 'image-box',
          badge: tag,
          preview: `${imgSrc.split('/').pop()} + "${text.slice(0, 30)}"`,
          settings: { image: { url: imgSrc, id: '', size: '', alt: '', source: 'library' }, title_text: text, ...ss },
        };
      }
    }

    const { direction, columns } = detectLayoutDirection(el, childElements.length, styles);
    const badge = direction === 'row' ? `${columns}-col` : 'stack';
    const preview = tag === 'header' ? 'Header section' : tag === 'footer' ? 'Footer section' : tag === 'section' ? 'Section' : direction === 'row' ? `${columns}-column layout` : 'Container';
    const ss = stylesToElementorSettings(styles, 'container');
    return { widget: 'container', badge, preview, settings: { ...ss } };
  }

  return { widget: 'html', badge: tag, preview: el.outerHTML?.slice(0, 80) || tag, settings: { html: el.outerHTML } };
}

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'head', 'title', 'noscript', 'template']);

interface ParseContext {
  computedStyles: Map<Element, ParsedStyles>;
  customCssPerElement: Map<Element, string>;
}

function parseElement(el: Element, depth: number, ctx: ParseContext): ElementNode | null {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return null;

  const styles = ctx.computedStyles.get(el) || {};
  const { widget, badge, preview, settings } = detectWidgetType(el, styles);

  // Attach custom_css to ALL elements (containers and widgets) — Elementor Pro supports this everywhere
  const customCss = ctx.customCssPerElement.get(el);
  if (customCss) {
    settings.custom_css = customCss;
  }

  const childElements = Array.from(el.children).filter(c => !SKIP_TAGS.has(c.tagName.toLowerCase()));
  const { direction, columns } = widget === 'container'
    ? detectLayoutDirection(el, childElements.length, styles)
    : { direction: 'column' as const, columns: 1 };

  const node: ElementNode = {
    id: nextId(),
    widgetType: widget,
    badge,
    preview,
    children: [],
    depth,
    htmlElement: tag,
    settings,
    layoutDirection: direction,
    columnCount: columns,
  };

  if (widget === 'container') {
    if (hasDirectTextContent(el)) {
      const textParts: string[] = [];
      for (const childNode of Array.from(el.childNodes)) {
        if (childNode.nodeType === 3) {
          const t = childNode.textContent?.trim();
          if (t) textParts.push(t);
        }
      }
      if (textParts.length > 0) {
        const textContent = textParts.join(' ');
        node.children.push({
          id: nextId(),
          widgetType: 'text-editor',
          badge: 'text',
          preview: `"${textContent.slice(0, 60)}"`,
          children: [],
          depth: depth + 1,
          htmlElement: '#text',
          settings: { editor: `<p>${textContent}</p>` },
          layoutDirection: 'column',
          columnCount: 1,
        });
      }
    }

    for (const child of childElements) {
      const childNode = parseElement(child, depth + 1, ctx);
      if (childNode) node.children.push(childNode);
    }
  }

  return node;
}

export function parseHTML(html: string): ElementNode[] {
  idCounter = 0;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const { computedStyles, customCssPerElement } = buildStyleMap(doc);
  const ctx: ParseContext = { computedStyles, customCssPerElement };
  const nodes: ElementNode[] = [];

  for (const child of Array.from(doc.body.children)) {
    const node = parseElement(child, 0, ctx);
    if (node) nodes.push(node);
  }

  return nodes;
}

// --- Elementor JSON generation with correct schema ---

// Build a widget element — settings is [] when empty, object when populated
function buildWidget(node: ElementNode, isInner: boolean): Record<string, unknown> {
  const hasSettings = Object.keys(node.settings).length > 0;
  return {
    id: elementorId(),
    elType: 'widget',
    widgetType: node.widgetType,
    isInner,
    settings: hasSettings ? node.settings : [],
    elements: [],
  };
}

// Build a container element
function buildContainer(node: ElementNode, isInner: boolean): Record<string, unknown> {
  const isRow = node.layoutDirection === 'row';

  // Start with layout direction, then merge extracted styles
  // Only add flex_direction when it's explicitly row (column is Elementor default)
  const containerSettings: Record<string, unknown> = {
    ...(isRow ? { flex_direction: 'row' } : {}),
    ...(isRow && node.columnCount > 1 ? { flex_gap: flexGap(20) } : {}),
    ...node.settings,
  };

  // Remove content_width from container settings if empty — only add it on containers that need it
  if (!containerSettings.content_width) {
    containerSettings.content_width = 'full';
  }

  const hasSettings = Object.keys(containerSettings).length > 0;

  const elements: unknown[] = node.children.map(child => {
    if (child.widgetType === 'container') return buildContainer(child, true);
    return buildWidget(child, true);
  });

  return {
    id: elementorId(),
    elType: 'container',
    isInner,
    settings: hasSettings ? containerSettings : [],
    elements,
  };
}

function buildElement(node: ElementNode, isInner: boolean): Record<string, unknown> {
  if (node.widgetType === 'container') return buildContainer(node, isInner);
  return buildWidget(node, isInner);
}

export function buildElementorJSON(nodes: ElementNode[], filename: string): string {
  const content = {
    version: '0.4',
    title: filename.replace(/\.html?$/i, ''),
    type: 'page',
    page_settings: [],
    content: nodes.map(node => buildElement(node, false)),
  };

  return JSON.stringify(content, null, 2);
}

export function countElements(nodes: ElementNode[]): number {
  let count = 0;
  function walk(ns: ElementNode[]) {
    for (const n of ns) {
      count++;
      walk(n.children);
    }
  }
  walk(nodes);
  return count;
}
