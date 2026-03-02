import { MSG } from '../shared/messages';
import { resolveState } from '../shared/state-resolver';
import type { DarkDetection, FilterOptions, SiteMode } from '../shared/types';

interface PerSiteSettings {
  enabled: boolean | 'auto';
  brightness: number;
  contrast: number;
  sepia: number;
}

const DEFAULT_PER_SITE: PerSiteSettings = {
  enabled: 'auto',
  brightness: 100,
  contrast: 100,
  sepia: 0,
};

// Transient per-tab detection state (not persisted to storage)
const tabDetections: Record<number, DarkDetection> = {};

interface GlobalState {
  globalEnabled: boolean;
  filterOptions: FilterOptions;
  perSite: Record<string, PerSiteSettings>;
}

const DEFAULT_STATE: GlobalState = {
  globalEnabled: false,
  filterOptions: {},
  perSite: {},
};

let cachedState: GlobalState = { ...DEFAULT_STATE, perSite: {} };

// Load state from storage on startup
chrome.storage.local.get('nightshift_state', (result) => {
  if (chrome.runtime.lastError) {
    console.error('[NightShift] Failed to load state:', chrome.runtime.lastError.message);
    return;
  }
  if (result.nightshift_state) {
    const loaded = result.nightshift_state as GlobalState;
    cachedState = { ...DEFAULT_STATE, ...loaded, perSite: loaded.perSite ?? {} };
  }
});

function saveState(): void {
  chrome.storage.local.set({ nightshift_state: cachedState }, () => {
    if (chrome.runtime.lastError) {
      console.error('[NightShift] Failed to save state:', chrome.runtime.lastError.message);
    }
  });
}

function getSiteMode(domain: string): SiteMode {
  return cachedState.perSite[domain]?.enabled ?? 'auto';
}

function getEffectiveEnabled(domain: string, tabId?: number): boolean {
  const detection = tabId !== undefined ? (tabDetections[tabId] ?? null) : null;
  return resolveState({
    globalEnabled: cachedState.globalEnabled,
    siteMode: getSiteMode(domain),
    darkDetection: detection,
  }).effectiveEnabled;
}

function getEffectiveFilterOptions(domain: string): FilterOptions {
  const siteConfig = cachedState.perSite[domain];
  if (siteConfig) {
    const opts: FilterOptions = { ...cachedState.filterOptions };
    if (siteConfig.brightness !== 100) opts.brightness = siteConfig.brightness;
    if (siteConfig.contrast !== 100) opts.contrast = siteConfig.contrast;
    if (siteConfig.sepia !== 0) opts.sepia = siteConfig.sepia;
    return opts;
  }
  return cachedState.filterOptions;
}

function notifyTab(tabId: number, domain: string): void {
  const enabled = getEffectiveEnabled(domain);
  chrome.tabs.sendMessage(
    tabId,
    {
      action: enabled ? MSG.APPLY_DARK : MSG.REMOVE_DARK,
      options: getEffectiveFilterOptions(domain),
    },
    { frameId: 0 },
    () => {
      if (chrome.runtime.lastError) {
        // expected for chrome:// and edge cases
      }
    },
  );
}

function getDomainFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function notifyAllTabs(): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      const domain = getDomainFromUrl(tab.url);
      if (!domain) continue;
      notifyTab(tab.id, domain);
    }
  });
}

// Clean up detection state when tabs are closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabDetections[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    delete tabDetections[tabId];
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case MSG.GET_STATE: {
      const domain = msg.domain ?? getDomainFromUrl(sender.tab?.url ?? sender.url);
      const effectiveEnabled = domain ? getEffectiveEnabled(domain) : cachedState.globalEnabled;
      const siteConfig = domain ? (cachedState.perSite[domain] ?? null) : null;

      // Look up detection for active tab (popup passes tabId via msg)
      let darkDetection: DarkDetection | null = null;
      if (msg.tabId !== undefined) {
        darkDetection = tabDetections[msg.tabId] ?? null;
      } else if (sender.tab?.id !== undefined) {
        darkDetection = tabDetections[sender.tab.id] ?? null;
      }

      sendResponse({
        globalEnabled: cachedState.globalEnabled,
        filterOptions: cachedState.filterOptions,
        effectiveEnabled,
        siteConfig,
        domain,
        darkDetection,
      });
      return true;
    }

    case MSG.SET_ENABLED: {
      cachedState.globalEnabled = msg.enabled;
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.SET_SITE_ENABLED: {
      const { domain, enabled } = msg as { domain: string; enabled: boolean | 'auto' };
      if (enabled === 'auto') {
        delete cachedState.perSite[domain];
      } else {
        cachedState.perSite[domain] = {
          ...(cachedState.perSite[domain] ?? DEFAULT_PER_SITE),
          enabled,
        };
      }
      saveState();

      // Notify tabs on this domain
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          const tabDomain = getDomainFromUrl(tab.url);
          if (tabDomain === domain) {
            notifyTab(tab.id, domain);
          }
        }
      });
      sendResponse({ ok: true });
      return true;
    }

    case MSG.SET_FILTER_OPTIONS: {
      cachedState.filterOptions = { ...cachedState.filterOptions, ...msg.options };
      saveState();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.ALREADY_DARK_DETECTED: {
      const tabId = sender.tab?.id;
      if (tabId !== undefined && msg.detection) {
        tabDetections[tabId] = msg.detection;
      }
      const detDomain = msg.domain ?? getDomainFromUrl(sender.tab?.url);
      const { autoSkipped } = resolveState({
        globalEnabled: cachedState.globalEnabled,
        siteMode: detDomain ? getSiteMode(detDomain) : 'auto',
        darkDetection: msg.detection ?? null,
      });
      sendResponse({ ok: true, autoSkip: autoSkipped });
      return true;
    }

    case MSG.GET_ALL_SITES: {
      sendResponse({ perSite: cachedState.perSite });
      return true;
    }

    case MSG.RESET_ALL_SITES: {
      cachedState.perSite = {};
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    default:
      return false;
  }
});
