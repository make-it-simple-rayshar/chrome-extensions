import { describe, expect, it } from 'vitest';
import { patternMatch, resolveSiteMode } from './pattern-match';
import type { PerSitePattern } from './types';

describe('patternMatch', () => {
  it('matches wildcard subdomain pattern', () => {
    expect(patternMatch('*.google.com', 'mail.google.com')).toBe(true);
  });

  it('matches nested subdomains', () => {
    expect(patternMatch('*.google.com', 'a.b.google.com')).toBe(true);
  });

  it('does not match exact domain against wildcard', () => {
    expect(patternMatch('*.google.com', 'google.com')).toBe(false);
  });

  it('matches exact domain pattern', () => {
    expect(patternMatch('google.com', 'google.com')).toBe(true);
  });

  it('does not match unrelated domain', () => {
    expect(patternMatch('*.google.com', 'example.com')).toBe(false);
  });

  it('treats regex metacharacters as literal text', () => {
    expect(patternMatch('(a+)+b', 'example.com')).toBe(false);
    expect(patternMatch('evil|good.com', 'evil.com')).toBe(false);
  });

  it('does not freeze on ReDoS patterns', () => {
    const start = performance.now();
    patternMatch('(a+)+b', 'aaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('resolveSiteMode', () => {
  it('returns exact match when available', () => {
    const perSite = { 'mail.google.com': { enabled: true as const } };
    const patterns: PerSitePattern[] = [{ pattern: '*.google.com', enabled: false }];
    expect(resolveSiteMode('mail.google.com', perSite, patterns)).toBe(true);
  });

  it('returns pattern match when no exact match', () => {
    const perSite = {};
    const patterns: PerSitePattern[] = [{ pattern: '*.google.com', enabled: false }];
    expect(resolveSiteMode('docs.google.com', perSite, patterns)).toBe(false);
  });

  it('returns auto when no match', () => {
    const perSite = {};
    const patterns: PerSitePattern[] = [{ pattern: '*.google.com', enabled: false }];
    expect(resolveSiteMode('example.com', perSite, patterns)).toBe('auto');
  });

  it('first pattern match wins', () => {
    const perSite = {};
    const patterns: PerSitePattern[] = [
      { pattern: '*.google.com', enabled: false },
      { pattern: '*.com', enabled: true },
    ];
    expect(resolveSiteMode('mail.google.com', perSite, patterns)).toBe(false);
  });

  it('returns auto when patterns empty', () => {
    const perSite = {};
    expect(resolveSiteMode('example.com', perSite, [])).toBe('auto');
  });
});
