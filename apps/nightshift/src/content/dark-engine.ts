import type { DarkMode, FilterOptions } from '../shared/types';
import { hasOverride as checkOverride, getOverrideCSS } from './overrides';

const STYLE_ID = 'nightshift-filter';
const OLED_STYLE_ID = 'nightshift-oled';
const OVERRIDE_STYLE_ID = 'nightshift-override';
const COUNTER_INVERT_SELECTOR = 'img, video, canvas, svg, picture, object, embed';
const COUNTER_INVERT_ATTR = 'data-nightshift-ci';
const THROTTLE_MS = 100;

interface EngineState {
  enabled: boolean;
  mode: DarkMode;
  options: FilterOptions;
}

let observer: MutationObserver | null = null;
let oledObserver: MutationObserver | null = null;
let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
let oledThrottleTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingMutations: MutationRecord[] = [];
let oledPendingMutations: MutationRecord[] = [];
const state: EngineState = { enabled: false, mode: 'filter', options: {} };

function buildFilterValue(opts: FilterOptions): string {
  const parts = ['invert(1)', 'hue-rotate(180deg)'];
  if (opts.brightness !== undefined && opts.brightness !== 100) {
    parts.push(`brightness(${opts.brightness}%)`);
  }
  if (opts.contrast !== undefined && opts.contrast !== 100) {
    parts.push(`contrast(${opts.contrast}%)`);
  }
  if (opts.sepia !== undefined && opts.sepia !== 0) {
    parts.push(`sepia(${opts.sepia}%)`);
  }
  return parts.join(' ');
}

function buildStyleContent(opts: FilterOptions): string {
  const filterValue = buildFilterValue(opts);
  return [
    `html { filter: ${filterValue} !important; }`,
    `${COUNTER_INVERT_SELECTOR} { filter: invert(1) hue-rotate(180deg) !important; }`,
    'iframe { filter: none !important; }',
  ].join('\n');
}

function markElement(el: Element): void {
  if (!el.hasAttribute(COUNTER_INVERT_ATTR)) {
    el.setAttribute(COUNTER_INVERT_ATTR, '1');
  }
}

function counterInvertAdded(mutations: MutationRecord[]): void {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (el.matches(COUNTER_INVERT_SELECTOR)) {
        markElement(el);
      }
      for (const child of el.querySelectorAll(COUNTER_INVERT_SELECTOR)) {
        markElement(child);
      }
    }
  }
}

function counterInvertAll(): void {
  for (const el of document.querySelectorAll(COUNTER_INVERT_SELECTOR)) {
    markElement(el);
  }
}

function startObserver(): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    pendingMutations.push(...mutations);
    if (throttleTimeout) return;
    throttleTimeout = setTimeout(() => {
      throttleTimeout = null;
      const batch = pendingMutations;
      pendingMutations = [];
      requestAnimationFrame(() => {
        counterInvertAdded(batch);
      });
    }, THROTTLE_MS);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
}

function stopObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (throttleTimeout) {
    clearTimeout(throttleTimeout);
    throttleTimeout = null;
  }
  pendingMutations = [];
}

// --- OLED Engine ---

const OLED_CSS = [
  '/* Stage 1: Targeted container backgrounds */',
  'html, body, main, article, section, div, nav, header, footer, aside,',
  'form, table, thead, tbody, tr, td, th, ul, ol, li, dl, dd, dt {',
  '  background-color: #000000 !important;',
  '  background-image: none !important;',
  '}',
  '/* Stage 2: Text readability */',
  'body, p, span, div, h1, h2, h3, h4, h5, h6, a, li, td, th, label, button {',
  '  color: #e0e0e0 !important;',
  '}',
  'a { color: #6cb4ff !important; }',
  '/* Stage 3: Media preservation */',
  'img, video, canvas, iframe, picture, svg:not([fill="none"]) {',
  '  background-color: transparent !important;',
  '  background-image: unset !important;',
  '}',
  '/* Stage 4: Form controls */',
  'input, textarea, select {',
  '  background-color: #111111 !important;',
  '  color: #e8e8e8 !important;',
  '  border-color: #444444 !important;',
  '}',
  ':root { color-scheme: dark !important; }',
].join('\n');

function startOledObserver(): void {
  if (oledObserver) return;

  oledObserver = new MutationObserver((mutations) => {
    oledPendingMutations.push(...mutations);
    if (oledThrottleTimeout) return;
    oledThrottleTimeout = setTimeout(() => {
      oledThrottleTimeout = null;
      oledPendingMutations = [];
      // OLED CSS uses broad selectors so new DOM nodes are auto-styled.
      // Observer exists to re-inject style if removed by page scripts.
      requestAnimationFrame(() => {
        const style = document.getElementById(OLED_STYLE_ID);
        if (state.enabled && state.mode === 'oled' && !style) {
          const newStyle = document.createElement('style');
          newStyle.id = OLED_STYLE_ID;
          document.documentElement.appendChild(newStyle);
          newStyle.textContent = OLED_CSS;
        }
      });
    }, THROTTLE_MS);
  });

  oledObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopOledObserver(): void {
  if (oledObserver) {
    oledObserver.disconnect();
    oledObserver = null;
  }
  if (oledThrottleTimeout) {
    clearTimeout(oledThrottleTimeout);
    oledThrottleTimeout = null;
  }
  oledPendingMutations = [];
}

export function applyOledMode(): void {
  // Remove filter mode first if active
  if (state.enabled && state.mode === 'filter') {
    const filterStyle = document.getElementById(STYLE_ID);
    if (filterStyle) filterStyle.remove();
    const marked = document.querySelectorAll(`[${COUNTER_INVERT_ATTR}]`);
    for (const el of marked) el.removeAttribute(COUNTER_INVERT_ATTR);
    stopObserver();
  }

  state.enabled = true;
  state.mode = 'oled';

  let style = document.getElementById(OLED_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = OLED_STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = OLED_CSS;

  startOledObserver();
}

export function removeOledMode(): void {
  if (!state.enabled || state.mode !== 'oled') return;

  state.enabled = false;
  state.mode = 'filter';

  const style = document.getElementById(OLED_STYLE_ID);
  if (style) style.remove();

  const overrideStyle = document.getElementById(OVERRIDE_STYLE_ID);
  if (overrideStyle) overrideStyle.remove();

  stopOledObserver();
}

export function getEngineMode(): DarkMode {
  return state.mode;
}

// --- Filter Engine ---

export function applyDarkMode(opts?: FilterOptions): void {
  // Remove OLED mode first if active
  if (state.enabled && state.mode === 'oled') {
    const oledStyle = document.getElementById(OLED_STYLE_ID);
    if (oledStyle) oledStyle.remove();
    stopOledObserver();
  }

  state.options = opts ?? {};
  state.enabled = true;
  state.mode = 'filter';

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = buildStyleContent(state.options);

  counterInvertAll();
  startObserver();
}

export function removeDarkMode(): void {
  if (!state.enabled) return;

  state.enabled = false;
  state.mode = 'filter';
  state.options = {};

  const style = document.getElementById(STYLE_ID);
  if (style) {
    style.remove();
  }

  const overrideStyle = document.getElementById(OVERRIDE_STYLE_ID);
  if (overrideStyle) {
    overrideStyle.remove();
  }

  const marked = document.querySelectorAll(`[${COUNTER_INVERT_ATTR}]`);
  for (const el of marked) {
    el.removeAttribute(COUNTER_INVERT_ATTR);
  }

  stopObserver();
}

export function updateFilter(opts: FilterOptions): void {
  state.options = { ...state.options, ...opts };

  const style = document.getElementById(STYLE_ID);
  if (style) {
    style.textContent = buildStyleContent(state.options);
  }
}

function getLuminance(rgb: string): number {
  const match = rgb.match(/\d+/g);
  if (!match) return 1;
  const [r, g, b] = match.map(Number).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface DetectionResult {
  isDark: boolean;
  confidence: 'high' | 'low' | 'none';
  signals: string[];
}

export function detectNativeDarkMode(): DetectionResult {
  const signals: string[] = [];

  // High confidence: <meta name="color-scheme" content="dark">
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta?.getAttribute('content')?.includes('dark')) {
    signals.push('meta-color-scheme');
    return { isDark: true, confidence: 'high', signals };
  }

  // High confidence: body background luminance < 0.15
  const body = document.body;
  if (body) {
    const bg = getComputedStyle(body).backgroundColor;
    if (getLuminance(bg) < 0.15) {
      signals.push('luminance');
      return { isDark: true, confidence: 'high', signals };
    }
  }

  // Low confidence: class-based detection on <html> and <body>
  const root = document.documentElement;
  const darkClasses = ['dark', 'theme-dark', 'dark-mode'];
  for (const el of [root, body]) {
    if (!el) continue;
    for (const cls of darkClasses) {
      if (el.classList.contains(cls)) {
        signals.push(`class:${cls}`);
      }
    }
  }

  // Low confidence: data attribute detection
  const darkAttrs: Array<[string, string]> = [
    ['data-theme', 'dark'],
    ['data-color-mode', 'dark'],
    ['data-bs-theme', 'dark'],
  ];
  for (const el of [root, body]) {
    if (!el) continue;
    for (const [attr, value] of darkAttrs) {
      if (el.getAttribute(attr) === value) {
        signals.push(`attr:${attr}`);
      }
    }
  }

  if (signals.length > 0) {
    return { isDark: true, confidence: 'low', signals };
  }

  return { isDark: false, confidence: 'none', signals: [] };
}

export function hasOverride(domain: string): boolean {
  return checkOverride(domain);
}

export function applyOverride(domain: string): boolean {
  const css = getOverrideCSS(domain);
  if (!css) return false;

  state.enabled = true;

  // Remove generic filter if present
  const filterStyle = document.getElementById(STYLE_ID);
  if (filterStyle) {
    filterStyle.remove();
  }

  // Apply dedicated CSS override
  let overrideStyle = document.getElementById(OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!overrideStyle) {
    overrideStyle = document.createElement('style');
    overrideStyle.id = OVERRIDE_STYLE_ID;
    document.documentElement.appendChild(overrideStyle);
  }
  overrideStyle.textContent = css;

  return true;
}

export function getState(): EngineState {
  return { ...state };
}
