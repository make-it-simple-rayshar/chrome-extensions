import { MSG } from '../shared/messages';
import { resolveState } from '../shared/state-resolver';
import type { SiteMode } from '../shared/types';
import {
  type DetectionResult,
  applyDarkMode,
  applyOledMode,
  applyOverride,
  detectNativeDarkMode,
  getEngineMode,
  getState,
  hasOverride,
  removeDarkMode,
  removeOledMode,
  updateFilter,
} from './dark-engine';

(() => {
  if ((window as unknown as Record<string, unknown>).__nightshiftInjected) {
    try {
      chrome.runtime.getURL('');
      return;
    } catch {
      // Extension context invalidated — re-inject
    }
  }
  (window as unknown as Record<string, unknown>).__nightshiftInjected = true;

  const currentDomain = window.location.hostname;

  // FOUC Phase 1: apply dark mode immediately at document_start
  // Check for site-specific CSS override first, then branch on engine mode
  chrome.runtime.sendMessage({ action: MSG.GET_STATE, domain: currentDomain }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.effectiveEnabled) {
      if (hasOverride(currentDomain)) {
        applyOverride(currentDomain);
      } else if (response.darkMode === 'oled') {
        applyOledMode();
      } else {
        applyDarkMode(response.filterOptions);
      }
    }
  });

  // FOUC Phase 2: detect native dark mode after DOM loads
  const onReady = () => {
    const detection: DetectionResult = detectNativeDarkMode();

    if (!detection.isDark) return;

    // Report detection to background and let it decide on auto-skip.
    // Background knows siteMode — only auto-skip when site is 'auto' (not forced ON).
    chrome.runtime.sendMessage(
      { action: MSG.ALREADY_DARK_DETECTED, detection, domain: currentDomain },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.autoSkip && getState().enabled) {
          removeDarkMode();
        }
      },
    );
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  // Cross-tab sync: listen for storage changes directly (0 hop, < 500ms)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.nightshift_state) return;

    const newState = changes.nightshift_state.newValue;
    if (!newState) return;

    const siteConfig = newState.perSite?.[currentDomain];
    const siteMode: SiteMode = siteConfig?.enabled ?? 'auto';

    const newDarkMode = newState.darkMode ?? 'filter';

    // Note: content script doesn't have detection state for cross-tab sync,
    // so darkDetection=null here. Detection is handled by onReady → background.
    const { effectiveEnabled: shouldBeEnabled } = resolveState({
      globalEnabled: newState.globalEnabled,
      siteMode,
      darkDetection: null,
      darkMode: newDarkMode,
    });

    // Compute effective filter options (per-site overrides > global)
    const effectiveOpts = { ...newState.filterOptions };
    if (siteConfig) {
      if (siteConfig.brightness !== 100) effectiveOpts.brightness = siteConfig.brightness;
      if (siteConfig.contrast !== 100) effectiveOpts.contrast = siteConfig.contrast;
      if (siteConfig.sepia !== 0) effectiveOpts.sepia = siteConfig.sepia;
    }

    const engineState = getState();
    const currentMode = getEngineMode();

    if (shouldBeEnabled) {
      // Engine mode switch or initial activation
      if (newDarkMode === 'oled') {
        if (currentMode !== 'oled' || !engineState.enabled) {
          applyOledMode();
        }
      } else {
        if (currentMode !== 'filter' || !engineState.enabled) {
          applyDarkMode(effectiveOpts);
        } else {
          updateFilter(effectiveOpts);
        }
      }
    } else if (engineState.enabled) {
      // Disable: remove whichever engine is active
      if (currentMode === 'oled') {
        removeOledMode();
      } else {
        removeDarkMode();
      }
    }
  });

  // Message handler
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case MSG.APPLY_DARK:
        if (msg.darkMode === 'oled') {
          applyOledMode();
        } else {
          applyDarkMode(msg.options);
        }
        sendResponse({ ok: true });
        return true;
      case MSG.REMOVE_DARK: {
        const mode = getEngineMode();
        if (mode === 'oled') {
          removeOledMode();
        } else {
          removeDarkMode();
        }
        sendResponse({ ok: true });
        return true;
      }
      case MSG.UPDATE_FILTER:
        updateFilter(msg.options);
        sendResponse({ ok: true });
        return true;
      case MSG.GET_STATE:
        sendResponse(getState());
        return true;
      case MSG.IS_ALREADY_DARK:
        sendResponse({ detection: detectNativeDarkMode() });
        return true;
      default:
        return false;
    }
  });
})();
