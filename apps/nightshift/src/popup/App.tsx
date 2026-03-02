import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type SiteMode = boolean | 'auto';

interface DarkDetection {
  isDark: boolean;
  confidence: 'high' | 'low' | 'none';
  signals: string[];
}

export function App() {
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [siteMode, setSiteMode] = useState<SiteMode>('auto');
  const [domain, setDomain] = useState<string | null>(null);
  const [darkDetection, setDarkDetection] = useState<DarkDetection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      let tabDomain: string | null = null;
      if (tab?.url) {
        try {
          tabDomain = new URL(tab.url).hostname;
        } catch {
          // chrome:// or other special URLs
        }
      }
      setDomain(tabDomain);

      chrome.runtime.sendMessage(
        { action: 'GET_STATE', domain: tabDomain, tabId: tab?.id },
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
          setLoading(false);
        },
      );
    });
  }, []);

  const handleGlobalToggle = useCallback(() => {
    const newEnabled = !globalEnabled;
    setGlobalEnabled(newEnabled);
    chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: newEnabled });
  }, [globalEnabled]);

  const handleSiteToggle = useCallback(() => {
    if (!domain) return;
    // Cycle: auto → ON → OFF → auto
    let next: SiteMode;
    if (siteMode === 'auto') {
      next = true;
    } else if (siteMode === true) {
      next = false;
    } else {
      next = 'auto';
    }
    setSiteMode(next);
    chrome.runtime.sendMessage({ action: 'SET_SITE_ENABLED', domain, enabled: next });
  }, [domain, siteMode]);

  const handleApplyAnyway = useCallback(() => {
    if (!domain) return;
    setSiteMode(true);
    chrome.runtime.sendMessage({ action: 'SET_SITE_ENABLED', domain, enabled: true });
  }, [domain]);

  const effectiveEnabled = siteMode !== 'auto' ? siteMode : globalEnabled;

  const siteLabel = siteMode === 'auto' ? 'Auto (global)' : siteMode ? 'Always ON' : 'Always OFF';

  // Show detection indicator when dark mode detected AND user hasn't overridden
  const showDetection = darkDetection?.isDark && siteMode === 'auto';

  return (
    <div className="w-64 p-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">NightShift</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button
            variant={globalEnabled ? 'secondary' : 'default'}
            className="w-full"
            onClick={handleGlobalToggle}
            disabled={loading}
          >
            {loading ? 'Loading...' : globalEnabled ? 'Global: ON' : 'Global: OFF'}
          </Button>

          {domain && (
            <>
              <div className="text-xs text-muted-foreground truncate" title={domain}>
                {domain}
              </div>
              <Button
                variant={effectiveEnabled ? 'secondary' : 'outline'}
                size="sm"
                className="w-full"
                onClick={handleSiteToggle}
                disabled={loading}
              >
                {siteLabel}
              </Button>

              {showDetection && (
                <div className="rounded-md border border-yellow-600/30 bg-yellow-950/20 p-2">
                  <p className="text-xs text-yellow-400">Natywny dark mode wykryty</p>
                  {darkDetection.confidence === 'high' && (
                    <p className="text-xs text-muted-foreground mt-0.5">Auto-skip aktywny</p>
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
        </CardContent>
      </Card>
    </div>
  );
}
