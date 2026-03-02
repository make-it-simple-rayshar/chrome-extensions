import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';

type SiteMode = boolean | 'auto';

interface SiteEntry {
  domain: string;
  enabled: SiteMode;
}

interface SitesManagerProps {
  onBack: () => void;
}

export function SitesManager({ onBack }: SitesManagerProps) {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadSites = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'GET_ALL_SITES' }, (response) => {
      if (chrome.runtime.lastError) {
        setLoading(false);
        return;
      }
      const entries: SiteEntry[] = Object.entries(
        (response?.perSite ?? {}) as Record<string, { enabled: SiteMode }>,
      ).map(([domain, config]) => ({
        domain,
        enabled: config.enabled,
      }));
      entries.sort((a, b) => a.domain.localeCompare(b.domain));
      setSites(entries);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  const filtered = useMemo(() => {
    if (!search) return sites;
    const q = search.toLowerCase();
    return sites.filter((s) => s.domain.toLowerCase().includes(q));
  }, [sites, search]);

  const handleToggle = useCallback(
    (domain: string) => {
      const site = sites.find((s) => s.domain === domain);
      if (!site) return;

      let next: SiteMode;
      if (site.enabled === 'auto') {
        next = true;
      } else if (site.enabled === true) {
        next = false;
      } else {
        next = 'auto';
      }

      chrome.runtime.sendMessage({ action: 'SET_SITE_ENABLED', domain, enabled: next });

      setSites((prev) =>
        prev
          .map((s) => (s.domain === domain ? { ...s, enabled: next } : s))
          .filter((s) => s.enabled !== 'auto'),
      );
    },
    [sites],
  );

  const handleResetAll = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'RESET_ALL_SITES' }, () => {
      if (chrome.runtime.lastError) return;
      setSites([]);
    });
  }, []);

  const modeLabel = (enabled: SiteMode): string => {
    if (enabled === 'auto') return 'Auto';
    return enabled ? 'ON' : 'OFF';
  };

  const modeVariant = (enabled: SiteMode): 'secondary' | 'outline' | 'destructive' => {
    if (enabled === true) return 'secondary';
    if (enabled === false) return 'destructive';
    return 'outline';
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          &larr;
        </Button>
        <span className="text-sm font-medium">Manage Sites</span>
      </div>

      <input
        type="text"
        placeholder="Search domains..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {loading && <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>}

      {!loading && sites.length === 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">No per-site settings yet</p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
          {filtered.map((site) => (
            <div
              key={site.domain}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <span className="text-xs truncate" title={site.domain}>
                {site.domain}
              </span>
              <Button
                variant={modeVariant(site.enabled)}
                size="sm"
                className="shrink-0 text-xs h-6 px-2"
                onClick={() => handleToggle(site.domain)}
              >
                {modeLabel(site.enabled)}
              </Button>
            </div>
          ))}
        </div>
      )}

      {!loading && sites.length > 0 && (
        <Button variant="outline" size="sm" className="w-full mt-1" onClick={handleResetAll}>
          Reset All
        </Button>
      )}
    </div>
  );
}
