import { describe, expect, it } from 'vitest';
import { type ResolverInput, resolveState } from './state-resolver';
import type { DarkDetection } from './types';

const highDark: DarkDetection = {
  isDark: true,
  confidence: 'high',
  signals: ['meta-color-scheme'],
};

const lowDark: DarkDetection = {
  isDark: true,
  confidence: 'low',
  signals: ['dark-background'],
};

describe('resolveState', () => {
  it('returns OFF when global is disabled', () => {
    const input: ResolverInput = { globalEnabled: false, siteMode: 'auto', darkDetection: null };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: false,
      autoSkipped: false,
      detectionNotice: null,
    });
  });

  it('returns OFF when global disabled even with site forced ON', () => {
    const input: ResolverInput = { globalEnabled: false, siteMode: true, darkDetection: null };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: false,
      autoSkipped: false,
      detectionNotice: null,
    });
  });

  it('returns OFF when site forced OFF', () => {
    const input: ResolverInput = { globalEnabled: true, siteMode: false, darkDetection: null };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: false,
      autoSkipped: false,
      detectionNotice: null,
    });
  });

  it('returns ON with notice when site forced ON and native dark detected', () => {
    const input: ResolverInput = { globalEnabled: true, siteMode: true, darkDetection: highDark };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: true,
      autoSkipped: false,
      detectionNotice: 'Native dark mode detected — NightShift overrides',
    });
  });

  it('returns ON without notice when site forced ON and no dark detected', () => {
    const input: ResolverInput = { globalEnabled: true, siteMode: true, darkDetection: null };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: true,
      autoSkipped: false,
      detectionNotice: null,
    });
  });

  it('auto-skips when high-confidence dark mode detected', () => {
    const input: ResolverInput = { globalEnabled: true, siteMode: 'auto', darkDetection: highDark };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: false,
      autoSkipped: true,
      detectionNotice: 'Native dark mode detected — auto-skipped',
    });
  });

  it('does not auto-skip for low-confidence dark detection', () => {
    const input: ResolverInput = { globalEnabled: true, siteMode: 'auto', darkDetection: lowDark };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: true,
      autoSkipped: false,
      detectionNotice: null,
    });
  });

  it('returns ON in auto mode with no detection', () => {
    const input: ResolverInput = { globalEnabled: true, siteMode: 'auto', darkDetection: null };
    expect(resolveState(input)).toEqual({
      effectiveEnabled: true,
      autoSkipped: false,
      detectionNotice: null,
    });
  });
});
