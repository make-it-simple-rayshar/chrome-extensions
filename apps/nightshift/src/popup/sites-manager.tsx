import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { MSG } from '../shared/messages';
import type { PerSitePattern, SiteMode } from '../shared/types';

interface SiteEntry {
  domain: string;
  enabled: SiteMode;
}

interface SitesManagerProps {
  onBack: () => void;
}

type SitesTab = 'sites' | 'patterns' | 'bulk';

export function SitesManager({ onBack }: SitesManagerProps) {
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [patterns, setPatterns] = useState<PerSitePattern[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SitesTab>('sites');
  const [bulkText, setBulkText] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSites = useCallback(() => {
    chrome.runtime.sendMessage({ action: MSG.GET_ALL_SITES }, (response) => {
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
      setPatterns((response?.patterns as PerSitePattern[]) ?? []);
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

  const handleToggle = useCallback((domain: string, checked: boolean) => {
    const next: SiteMode = checked;
    chrome.runtime.sendMessage({ action: MSG.SET_SITE_ENABLED, domain, enabled: next }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Site toggle failed:', chrome.runtime.lastError.message);
      }
    });
    setSites((prev) => prev.map((s) => (s.domain === domain ? { ...s, enabled: next } : s)));
  }, []);

  const handleRemoveAll = useCallback(() => {
    chrome.runtime.sendMessage({ action: MSG.RESET_ALL_SITES }, () => {
      if (chrome.runtime.lastError) return;
      setSites([]);
      setPatterns([]);
    });
  }, []);

  const handleAddPattern = useCallback(() => {
    if (!newPattern.trim()) return;
    const pattern: PerSitePattern = { pattern: newPattern.trim(), enabled: false };
    chrome.runtime.sendMessage({ action: MSG.ADD_PATTERN, pattern }, () => {
      if (chrome.runtime.lastError) return;
      setPatterns((prev) => [...prev, pattern]);
      setNewPattern('');
    });
  }, [newPattern]);

  const handleRemovePattern = useCallback((index: number) => {
    chrome.runtime.sendMessage({ action: MSG.REMOVE_PATTERN, index }, () => {
      if (chrome.runtime.lastError) return;
      setPatterns((prev) => prev.filter((_, i) => i !== index));
    });
  }, []);

  const handleBulkAdd = useCallback(() => {
    const domains = bulkText
      .split('\n')
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    if (domains.length === 0) return;
    const perSite: Record<string, { enabled: boolean }> = {};
    for (const domain of domains) {
      perSite[domain] = { enabled: false };
    }
    chrome.runtime.sendMessage({ action: MSG.IMPORT_SITES, data: { perSite } }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Bulk add failed:', chrome.runtime.lastError.message);
        return;
      }
      loadSites();
    });
    setBulkText('');
  }, [bulkText, loadSites]);

  const handleExport = useCallback(() => {
    chrome.runtime.sendMessage({ action: MSG.EXPORT_SITES }, (response) => {
      if (chrome.runtime.lastError) return;
      const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: 'nightshift-sites.json', saveAs: true });
    });
  }, []);

  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImportError(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(reader.result as string);
          // Validate shape: must have perSite (object) or patterns (array)
          if (typeof raw !== 'object' || raw === null) {
            setImportError('Invalid format: expected JSON object');
            return;
          }
          const data: { perSite?: unknown; patterns?: unknown } = {};
          if (raw.perSite && typeof raw.perSite === 'object' && !Array.isArray(raw.perSite)) {
            data.perSite = raw.perSite;
          }
          if (Array.isArray(raw.patterns)) {
            data.patterns = raw.patterns;
          }
          if (!data.perSite && !data.patterns) {
            setImportError('No valid perSite or patterns found in file');
            return;
          }
          chrome.runtime.sendMessage({ action: MSG.IMPORT_SITES, data }, () => {
            if (chrome.runtime.lastError) {
              setImportError('Import failed');
              return;
            }
            loadSites();
          });
        } catch {
          setImportError('Invalid JSON file');
        }
      };
      reader.readAsText(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [loadSites],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to main view">
          &larr;
        </Button>
        <span className="text-sm font-medium">Manage Sites</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" role="tablist" aria-label="Site management tabs">
        <Button
          size="sm"
          variant={tab === 'sites' ? 'default' : 'outline'}
          className="flex-1 text-xs"
          onClick={() => setTab('sites')}
          role="tab"
          aria-selected={tab === 'sites'}
        >
          Sites
        </Button>
        <Button
          size="sm"
          variant={tab === 'patterns' ? 'default' : 'outline'}
          className="flex-1 text-xs"
          onClick={() => setTab('patterns')}
          role="tab"
          aria-selected={tab === 'patterns'}
        >
          Patterns
        </Button>
        <Button
          size="sm"
          variant={tab === 'bulk' ? 'default' : 'outline'}
          className="flex-1 text-xs"
          onClick={() => setTab('bulk')}
          role="tab"
          aria-selected={tab === 'bulk'}
        >
          Bulk
        </Button>
      </div>

      {/* Sites tab */}
      {tab === 'sites' && (
        <>
          <input
            type="text"
            placeholder="Search domains..."
            aria-label="Search domains"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {loading && <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>}

          {!loading && sites.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No per-site settings yet
            </p>
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
                  <Switch
                    checked={site.enabled === true}
                    onCheckedChange={(checked) => handleToggle(site.domain, checked)}
                    aria-label={`Dark mode for ${site.domain}`}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Patterns tab */}
      {tab === 'patterns' && (
        <>
          <div className="flex gap-1">
            <input
              type="text"
              placeholder="*.google.com"
              aria-label="Pattern"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPattern()}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" onClick={handleAddPattern} disabled={!newPattern.trim()}>
              Add
            </Button>
          </div>
          {patterns.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 text-center">No patterns</p>
          )}
          {patterns.map((p, i) => (
            <div
              key={`${p.pattern}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <span className="text-xs truncate" title={p.pattern}>
                {p.pattern} — {p.enabled === true ? 'ON' : p.enabled === false ? 'OFF' : 'Auto'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-1"
                onClick={() => handleRemovePattern(i)}
                aria-label={`Remove pattern ${p.pattern}`}
              >
                &times;
              </Button>
            </div>
          ))}
        </>
      )}

      {/* Bulk tab */}
      {tab === 'bulk' && (
        <>
          <textarea
            placeholder="Paste domains, one per line..."
            aria-label="Bulk add domains"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <Button size="sm" onClick={handleBulkAdd} disabled={!bulkText.trim()}>
            Add All
          </Button>
        </>
      )}

      {/* Import error feedback */}
      {importError && <p className="text-xs text-destructive px-1">{importError}</p>}

      {/* Footer actions */}
      <div className="flex gap-1 pt-1 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={handleExport}
          disabled={sites.length === 0 && patterns.length === 0}
        >
          Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
          aria-label="Import site settings"
        />
      </div>

      {!loading && (sites.length > 0 || patterns.length > 0) && (
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleRemoveAll}>
          Remove All
        </Button>
      )}
    </div>
  );
}
