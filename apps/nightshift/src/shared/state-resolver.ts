import type { DarkDetection, DarkMode, SiteMode } from './types';

export interface ResolverInput {
  globalEnabled: boolean;
  siteMode: SiteMode;
  darkDetection: DarkDetection | null;
  darkMode?: DarkMode;
}

export interface ResolverOutput {
  effectiveEnabled: boolean;
  autoSkipped: boolean;
  detectionNotice: string | null;
  darkMode: DarkMode;
}

const OFF: ResolverOutput = {
  effectiveEnabled: false,
  autoSkipped: false,
  detectionNotice: null,
  darkMode: 'filter',
};

export function resolveState(input: ResolverInput): ResolverOutput {
  const darkMode = input.darkMode ?? 'filter';
  const highDark =
    input.darkDetection?.isDark === true && input.darkDetection.confidence === 'high';

  // Global is master switch
  if (!input.globalEnabled) return OFF;

  // Per-site forced OFF
  if (input.siteMode === false) return OFF;

  // Per-site forced ON — override detection but inform user
  if (input.siteMode === true) {
    return {
      effectiveEnabled: true,
      autoSkipped: false,
      detectionNotice: highDark ? 'Native dark mode detected — NightShift overrides' : null,
      darkMode,
    };
  }

  // Auto mode — check detection
  if (highDark) {
    return {
      effectiveEnabled: false,
      autoSkipped: true,
      detectionNotice: 'Native dark mode detected — auto-skipped',
      darkMode,
    };
  }

  return { effectiveEnabled: true, autoSkipped: false, detectionNotice: null, darkMode };
}
