import type { PerSitePattern, SiteMode } from './types';

export function patternMatch(pattern: string, domain: string): boolean {
  // Wildcard subdomain: *.example.com matches sub.example.com and a.b.example.com
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return domain.endsWith(`.${suffix}`);
  }
  // Exact match only — no regex to avoid ReDoS
  return pattern === domain;
}

export function resolveSiteMode(
  domain: string,
  perSite: Record<string, { enabled: SiteMode }>,
  patterns: PerSitePattern[],
): SiteMode {
  // 1. Exact domain match (highest priority)
  const exact = perSite[domain];
  if (exact) return exact.enabled;

  // 2. Pattern match (first match wins)
  for (const pattern of patterns) {
    if (patternMatch(pattern.pattern, domain)) {
      return pattern.enabled;
    }
  }

  // 3. Default
  return 'auto';
}
