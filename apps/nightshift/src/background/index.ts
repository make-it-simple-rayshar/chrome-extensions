import { MSG } from '../shared/messages';
import { resolveSiteMode } from '../shared/pattern-match';
import { resolveState } from '../shared/state-resolver';
import type {
  ColorProfile,
  DarkDetection,
  DarkMode,
  FilterOptions,
  PerSitePattern,
  ScheduleConfig,
  SiteMode,
} from '../shared/types';
import {
  ALARM_SAFETY_CHECK,
  type SchedulerCallbacks,
  applyCorrectStateForCurrentTime,
  createScheduleAlarms,
  getNextEventInfo,
  handleAlarm,
} from './scheduler';

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
  patterns: PerSitePattern[];
  schedule: ScheduleConfig | null;
  darkMode: DarkMode;
  activeProfile: string;
  profiles: Record<string, ColorProfile>;
  scheduleOverrideUntil: number | null;
}

const DEFAULT_STATE: GlobalState = {
  globalEnabled: false,
  filterOptions: {},
  perSite: {},
  patterns: [],
  schedule: null,
  darkMode: 'filter',
  activeProfile: 'default',
  profiles: {
    default: {
      id: 'default',
      name: 'Standard',
      darkMode: 'filter',
      brightness: 100,
      contrast: 100,
      sepia: 0,
    },
    'night-reading': {
      id: 'night-reading',
      name: 'Night Reading',
      darkMode: 'filter',
      brightness: 80,
      contrast: 90,
      sepia: 30,
    },
    oled: {
      id: 'oled',
      name: 'OLED',
      darkMode: 'oled',
      brightness: 100,
      contrast: 100,
      sepia: 0,
    },
  },
  scheduleOverrideUntil: null,
};

let cachedState: GlobalState = { ...DEFAULT_STATE, perSite: {}, patterns: [] };

// --- Scheduler callbacks (used by alarm handlers) ---
const schedulerCallbacks: SchedulerCallbacks = {
  getState: () => ({
    schedule: cachedState.schedule,
    globalEnabled: cachedState.globalEnabled,
    scheduleOverrideUntil: cachedState.scheduleOverrideUntil,
  }),
  setEnabled: (enabled) => {
    cachedState.globalEnabled = enabled;
    notifyAllTabs();
  },
  clearOverride: () => {
    cachedState.scheduleOverrideUntil = null;
  },
  saveState,
};

// === TOP LEVEL — synchronous listeners (MV3 requirement) ===
chrome.alarms.onAlarm.addListener((alarm) => handleAlarm(alarm, schedulerCallbacks));

function hydrateState(result: Record<string, unknown>): void {
  if (result.nightshift_state) {
    const loaded = result.nightshift_state as GlobalState;
    cachedState = {
      ...DEFAULT_STATE,
      ...loaded,
      perSite: loaded.perSite ?? {},
      patterns: loaded.patterns ?? [],
    };
  }
}

function initializeScheduler(): void {
  createScheduleAlarms(cachedState.schedule);
  applyCorrectStateForCurrentTime(schedulerCallbacks);
}

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get('nightshift_state', (result) => {
    if (chrome.runtime.lastError) {
      console.error(
        '[NightShift] Failed to load state on startup:',
        chrome.runtime.lastError.message,
      );
      return;
    }
    hydrateState(result);
    initializeScheduler();
  });
});

// Load state from storage on install/update (when onStartup does NOT fire)
chrome.storage.local.get('nightshift_state', (result) => {
  if (chrome.runtime.lastError) {
    console.error('[NightShift] Failed to load state:', chrome.runtime.lastError.message);
    return;
  }
  hydrateState(result);
  initializeScheduler();
});

function saveState(): void {
  chrome.storage.local.set({ nightshift_state: cachedState }, () => {
    if (chrome.runtime.lastError) {
      console.error('[NightShift] Failed to save state:', chrome.runtime.lastError.message);
    }
  });
}

function getSiteMode(domain: string): SiteMode {
  return resolveSiteMode(domain, cachedState.perSite, cachedState.patterns);
}

function getEffectiveEnabled(domain: string, tabId?: number): boolean {
  const detection = tabId !== undefined ? (tabDetections[tabId] ?? null) : null;
  return resolveState({
    globalEnabled: cachedState.globalEnabled,
    siteMode: getSiteMode(domain),
    darkDetection: detection,
    darkMode: cachedState.darkMode,
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
      darkMode: cachedState.darkMode,
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
        darkMode: cachedState.darkMode,
        schedule: cachedState.schedule,
        scheduleOverrideUntil: cachedState.scheduleOverrideUntil,
        profiles: cachedState.profiles,
        activeProfile: cachedState.activeProfile,
      });
      return true;
    }

    case MSG.SET_ENABLED: {
      cachedState.globalEnabled = msg.enabled;
      // Manual override: if schedule is active, pause until next natural event
      if (cachedState.schedule?.enabled) {
        const nextEvent = getNextEventInfo(cachedState.schedule);
        if (nextEvent) {
          cachedState.scheduleOverrideUntil = nextEvent.time;
        }
      }
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

    case MSG.SET_DARK_MODE: {
      cachedState.darkMode = msg.mode;
      saveState();
      notifyAllTabs();
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
        darkMode: cachedState.darkMode,
      });
      sendResponse({ ok: true, autoSkip: autoSkipped });
      return true;
    }

    case MSG.GET_ALL_SITES: {
      sendResponse({ perSite: cachedState.perSite, patterns: cachedState.patterns });
      return true;
    }

    case MSG.RESET_ALL_SITES: {
      cachedState.perSite = {};
      cachedState.patterns = [];
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.ADD_PATTERN: {
      const pattern = msg.pattern;
      if (
        !pattern ||
        typeof pattern.pattern !== 'string' ||
        pattern.pattern.length === 0 ||
        pattern.pattern.length > 253 ||
        (typeof pattern.enabled !== 'boolean' && pattern.enabled !== 'auto')
      ) {
        sendResponse({ ok: false, error: 'Invalid pattern' });
        return true;
      }
      cachedState.patterns = [...cachedState.patterns, pattern as PerSitePattern];
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.REMOVE_PATTERN: {
      const idx = msg.index as number;
      cachedState.patterns = cachedState.patterns.filter((_, i) => i !== idx);
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.IMPORT_SITES: {
      const data = msg.data;
      if (!data || typeof data !== 'object') {
        sendResponse({ ok: false, error: 'Invalid import data' });
        return true;
      }
      if (data.perSite && typeof data.perSite === 'object' && !Array.isArray(data.perSite)) {
        cachedState.perSite = data.perSite as Record<string, PerSiteSettings>;
      }
      if (Array.isArray(data.patterns)) {
        cachedState.patterns = data.patterns.filter(
          (p: unknown): p is PerSitePattern =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as Record<string, unknown>).pattern === 'string' &&
            (typeof (p as Record<string, unknown>).enabled === 'boolean' ||
              (p as Record<string, unknown>).enabled === 'auto'),
        );
      }
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.EXPORT_SITES: {
      sendResponse({
        version: 1,
        perSite: cachedState.perSite,
        patterns: cachedState.patterns,
      });
      return true;
    }

    case MSG.SET_PROFILE: {
      const profileId = msg.profileId as string;
      const profile = cachedState.profiles[profileId];
      if (!profile) {
        sendResponse({ ok: false, error: 'Profile not found' });
        return true;
      }
      cachedState.activeProfile = profileId;
      cachedState.darkMode = profile.darkMode;
      if (profile.darkMode === 'filter') {
        cachedState.filterOptions = {
          brightness: profile.brightness,
          contrast: profile.contrast,
          sepia: profile.sepia,
        };
      }
      saveState();
      notifyAllTabs();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.CREATE_PROFILE: {
      const p = msg.profile;
      if (
        !p ||
        typeof p.id !== 'string' ||
        p.id.length === 0 ||
        typeof p.name !== 'string' ||
        (p.darkMode !== 'filter' && p.darkMode !== 'oled') ||
        typeof p.brightness !== 'number' ||
        typeof p.contrast !== 'number' ||
        typeof p.sepia !== 'number'
      ) {
        sendResponse({ ok: false, error: 'Invalid profile' });
        return true;
      }
      const reserved = ['default', 'night-reading', 'oled'];
      if (reserved.includes(p.id)) {
        sendResponse({ ok: false, error: 'Cannot overwrite built-in profile' });
        return true;
      }
      const newProfile = p as ColorProfile;
      cachedState.profiles[newProfile.id] = newProfile;
      cachedState.activeProfile = newProfile.id;
      saveState();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.DELETE_PROFILE: {
      const delId = msg.profileId as string;
      const builtIn = ['default', 'night-reading', 'oled'];
      if (builtIn.includes(delId)) {
        sendResponse({ ok: false, error: 'Cannot delete built-in profile' });
        return true;
      }
      delete cachedState.profiles[delId];
      if (cachedState.activeProfile === delId) {
        // Fallback to Standard
        const fallback = cachedState.profiles.default;
        cachedState.activeProfile = 'default';
        cachedState.darkMode = fallback.darkMode;
        cachedState.filterOptions = {
          brightness: fallback.brightness,
          contrast: fallback.contrast,
          sepia: fallback.sepia,
        };
        notifyAllTabs();
      }
      saveState();
      sendResponse({ ok: true });
      return true;
    }

    case MSG.SET_SCHEDULE: {
      const schedule = msg.schedule as ScheduleConfig | null;
      cachedState.schedule = schedule;
      cachedState.scheduleOverrideUntil = null;
      saveState();
      createScheduleAlarms(schedule);
      if (schedule?.enabled) {
        applyCorrectStateForCurrentTime(schedulerCallbacks);
      }
      sendResponse({ ok: true });
      return true;
    }

    case MSG.GET_SCHEDULE: {
      const nextEvent = getNextEventInfo(cachedState.schedule);
      sendResponse({
        schedule: cachedState.schedule,
        scheduleOverrideUntil: cachedState.scheduleOverrideUntil,
        nextEvent,
      });
      return true;
    }

    default:
      return false;
  }
});
