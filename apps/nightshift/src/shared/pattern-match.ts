import type { PerSitePattern, SiteMode } from './types';

export function patternMatch(pattern: string, domain: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  return regex.test(domain);
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
