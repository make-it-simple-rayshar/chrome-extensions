import type { DarkDetection, SiteMode } from './types';

export interface ResolverInput {
  globalEnabled: boolean;
  siteMode: SiteMode;
  darkDetection: DarkDetection | null;
}

export interface ResolverOutput {
  effectiveEnabled: boolean;
  autoSkipped: boolean;
  detectionNotice: string | null;
}

const OFF: ResolverOutput = { effectiveEnabled: false, autoSkipped: false, detectionNotice: null };

export function resolveState(input: ResolverInput): ResolverOutput {
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
    };
  }

  // Auto mode — check detection
  if (highDark) {
    return {
      effectiveEnabled: false,
      autoSkipped: true,
      detectionNotice: 'Native dark mode detected — auto-skipped',
    };
  }

  return { effectiveEnabled: true, autoSkipped: false, detectionNotice: null };
}
