interface FilterOptions {
  brightness?: number;
  contrast?: number;
  sepia?: number;
}

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
  if (result.nightshift_state) {
    const loaded = result.nightshift_state as GlobalState;
    cachedState = { ...DEFAULT_STATE, ...loaded, perSite: loaded.perSite ?? {} };
  }
});

function saveState(): void {
  chrome.storage.local.set({ nightshift_state: cachedState });
}

function getEffectiveEnabled(domain: string): boolean {
  const siteConfig = cachedState.perSite[domain];
  if (siteConfig && siteConfig.enabled !== 'auto') {
    return siteConfig.enabled;
  }
  return cachedState.globalEnabled;
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
      action: enabled ? 'APPLY_DARK' : 'REMOVE_DARK',
      options: getEffectiveFilterOptions(domain),
    },
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'GET_STATE': {
      const domain = msg.domain ?? getDomainFromUrl(sender.tab?.url ?? sender.url);
      const effectiveEnabled = domain ? getEffectiveEnabled(domain) : cachedState.globalEnabled;
      const siteConfig = domain ? (cachedState.perSite[domain] ?? null) : null;
      sendResponse({
        ...cachedState,
        effectiveEnabled,
        siteConfig,
        domain,
      });
      return true;
    }

    case 'SET_ENABLED': {
      cachedState.globalEnabled = msg.enabled;
      saveState();

      // Notify all tabs — each gets its effective state based on per-site overrides
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          const domain = getDomainFromUrl(tab.url);
          if (!domain) continue;
          notifyTab(tab.id, domain);
        }
      });
      sendResponse({ ok: true });
      return true;
    }

    case 'SET_SITE_ENABLED': {
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

    case 'SET_FILTER_OPTIONS': {
      cachedState.filterOptions = { ...cachedState.filterOptions, ...msg.options };
      saveState();

      // Notify sender tab only
      if (sender.tab?.id !== undefined) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'UPDATE_FILTER',
          options: cachedState.filterOptions,
        });
      }
      sendResponse({ ok: true });
      return true;
    }

    case 'ALREADY_DARK_DETECTED':
      sendResponse({ ok: true });
      return true;

    case 'DARK_STATE_CHANGED':
      sendResponse({ ok: true });
      return true;

    default:
      return false;
  }
});
