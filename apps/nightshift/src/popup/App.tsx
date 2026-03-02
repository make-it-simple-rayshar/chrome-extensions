import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { MSG } from '../shared/messages';
import type { DarkDetection, FilterOptions, SiteMode } from '../shared/types';
import { cycleSiteMode } from '../shared/types';
import { CTABanner } from './cta-banner';
import { SitesManager } from './sites-manager';

type PopupView = 'main' | 'sites';

interface FilterValues {
  brightness: number;
  contrast: number;
  sepia: number;
}

const DEFAULT_FILTERS: FilterValues = { brightness: 100, contrast: 100, sepia: 0 };

const SLIDER_THROTTLE_MS = 100;

function isRestricted(url: string | undefined): boolean {
  if (!url) return true;
  return /^(chrome|chrome-extension|about|file):/.test(url);
}

export function App() {
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [siteMode, setSiteMode] = useState<SiteMode>('auto');
  const [domain, setDomain] = useState<string | null>(null);
  const [darkDetection, setDarkDetection] = useState<DarkDetection | null>(null);
  const [filters, setFilters] = useState<FilterValues>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [view, setView] = useState<PopupView>('main');

  const tabIdRef = useRef<number | undefined>(undefined);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef<FilterValues>(DEFAULT_FILTERS);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];

      if (isRestricted(tab?.url)) {
        setRestricted(true);
        setLoading(false);
        return;
      }

      let tabDomain: string | null = null;
      if (tab?.url) {
        try {
          tabDomain = new URL(tab.url).hostname;
        } catch {
          // special URLs
        }
      }

      tabIdRef.current = tab?.id;
      setDomain(tabDomain);

      chrome.runtime.sendMessage(
        { action: MSG.GET_STATE, domain: tabDomain, tabId: tab?.id },
        (response) => {
          if (chrome.runtime.lastError) {
            setLoading(false);
            return;
          }
          setGlobalEnabled(response?.globalEnabled ?? false);
          if (response?.siteConfig) {
            setSiteMode(response.siteConfig.enabled ?? 'auto');
          } else {
            setSiteMode('auto');
          }
          if (response?.darkDetection) {
            setDarkDetection(response.darkDetection);
          }

          const opts: FilterOptions = response?.filterOptions ?? {};
          const loaded: FilterValues = {
            brightness: opts.brightness ?? 100,
            contrast: opts.contrast ?? 100,
            sepia: opts.sepia ?? 0,
          };
          setFilters(loaded);
          filtersRef.current = loaded;

          setLoading(false);
        },
      );
    });
  }, []);

  const handleGlobalToggle = useCallback(() => {
    const newEnabled = !globalEnabled;
    setGlobalEnabled(newEnabled);
    chrome.runtime.sendMessage({ action: MSG.SET_ENABLED, enabled: newEnabled }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Toggle failed:', chrome.runtime.lastError.message);
        setGlobalEnabled(!newEnabled);
      }
    });
  }, [globalEnabled]);

  const handleSiteToggle = useCallback(() => {
    if (!domain) return;
    const next = cycleSiteMode(siteMode);
    setSiteMode(next);
    chrome.runtime.sendMessage({ action: MSG.SET_SITE_ENABLED, domain, enabled: next }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Site toggle failed:', chrome.runtime.lastError.message);
        setSiteMode(siteMode);
      }
    });
  }, [domain, siteMode]);

  const handleApplyAnyway = useCallback(() => {
    if (!domain) return;
    setSiteMode(true);
    chrome.runtime.sendMessage({ action: MSG.SET_SITE_ENABLED, domain, enabled: true }, () => {
      if (chrome.runtime.lastError) {
        console.error('[NightShift] Apply anyway failed:', chrome.runtime.lastError.message);
        setSiteMode('auto');
      }
    });
  }, [domain]);

  const sendFilterUpdate = useCallback((key: keyof FilterValues, value: number) => {
    const newFilters = { ...filtersRef.current, [key]: value };
    setFilters(newFilters);
    filtersRef.current = newFilters;

    // Throttled single-hop: popup → content script (no background relay)
    if (throttleRef.current) return;
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      if (tabIdRef.current !== undefined) {
        chrome.tabs.sendMessage(
          tabIdRef.current,
          { action: MSG.UPDATE_FILTER, options: filtersRef.current },
          { frameId: 0 },
        );
      }
    }, SLIDER_THROTTLE_MS);
  }, []);

  const persistFilters = useCallback(() => {
    // Flush pending throttle to sync content script with final value
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
      if (tabIdRef.current !== undefined) {
        chrome.tabs.sendMessage(
          tabIdRef.current,
          { action: MSG.UPDATE_FILTER, options: filtersRef.current },
          { frameId: 0 },
        );
      }
    }
    chrome.runtime.sendMessage({
      action: MSG.SET_FILTER_OPTIONS,
      options: filtersRef.current,
    });
  }, []);

  const effectiveEnabled = siteMode !== 'auto' ? siteMode : globalEnabled;
  const siteLabel = siteMode === 'auto' ? 'Auto (global)' : siteMode ? 'Always ON' : 'Always OFF';
  const showDetection = darkDetection?.isDark && siteMode === 'auto';

  if (restricted) {
    return (
      <div className="w-80 p-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">NightShift</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Dark mode unavailable on this page</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === 'sites') {
    return (
      <div className="w-80 p-3">
        <Card>
          <CardContent className="pt-4">
            <SitesManager onBack={() => setView('main')} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-80 p-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">NightShift</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Master toggle */}
          <Button
            variant={globalEnabled ? 'secondary' : 'default'}
            className="w-full"
            onClick={handleGlobalToggle}
            disabled={loading}
          >
            {loading ? 'Loading...' : globalEnabled ? 'Global: ON' : 'Global: OFF'}
          </Button>

          {/* Domain info + per-site toggle */}
          {domain && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate" title={domain}>
                  {domain}
                </span>
                <Button
                  variant={effectiveEnabled ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={handleSiteToggle}
                  disabled={loading}
                >
                  {siteLabel}
                </Button>
              </div>

              {/* Smart detection indicator */}
              {showDetection && (
                <div className="rounded-md border border-yellow-600/30 bg-yellow-950/20 p-2">
                  <p className="text-xs text-yellow-400">Native dark mode detected</p>
                  {darkDetection.confidence === 'high' && (
                    <p className="text-xs text-muted-foreground mt-0.5">Auto-skip active</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-1.5"
                    onClick={handleApplyAnyway}
                  >
                    Apply anyway
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Filter sliders — only when dark mode active */}
          {effectiveEnabled && (
            <div className="flex flex-col gap-2.5 pt-2 border-t border-border">
              <SliderRow
                label="Brightness"
                value={filters.brightness}
                min={50}
                max={150}
                onChange={(v) => sendFilterUpdate('brightness', v)}
                onCommit={persistFilters}
              />
              <SliderRow
                label="Contrast"
                value={filters.contrast}
                min={50}
                max={150}
                onChange={(v) => sendFilterUpdate('contrast', v)}
                onCommit={persistFilters}
              />
              <SliderRow
                label="Sepia"
                value={filters.sepia}
                min={0}
                max={100}
                onChange={(v) => sendFilterUpdate('sepia', v)}
                onCommit={persistFilters}
              />
            </div>
          )}

          {/* Manage Sites */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setView('sites')}
          >
            Manage Sites
          </Button>

          {/* Freemium CTA */}
          <CTABanner />
        </CardContent>
      </Card>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const labelId = `slider-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span id={labelId} className="text-xs text-muted-foreground">
          {label}
        </span>
        <span className="text-xs tabular-nums">{value}%</span>
      </div>
      <Slider
        aria-labelledby={labelId}
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={() => onCommit()}
      />
    </div>
  );
}
