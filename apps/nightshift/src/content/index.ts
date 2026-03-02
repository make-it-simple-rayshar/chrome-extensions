import {
  type DetectionResult,
  applyDarkMode,
  applyOverride,
  detectNativeDarkMode,
  getState,
  hasOverride,
  removeDarkMode,
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
  // Check for site-specific CSS override first, then fall back to generic filter
  chrome.runtime.sendMessage({ action: 'GET_STATE', domain: currentDomain }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.effectiveEnabled) {
      if (hasOverride(currentDomain)) {
        applyOverride(currentDomain);
      } else {
        applyDarkMode(response.filterOptions);
      }
    }
  });

  // FOUC Phase 2: detect native dark mode after DOM loads
  const onReady = () => {
    const detection: DetectionResult = detectNativeDarkMode();

    if (!detection.isDark) return;

    if (detection.confidence === 'high' && getState().enabled) {
      // High confidence: auto-skip — remove filter immediately
      removeDarkMode();
    }

    // Report detection to background (both high and low)
    chrome.runtime.sendMessage({
      action: 'ALREADY_DARK_DETECTED',
      detection,
    });
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
    let shouldBeEnabled: boolean;

    if (siteConfig && siteConfig.enabled !== 'auto') {
      shouldBeEnabled = siteConfig.enabled;
    } else {
      shouldBeEnabled = newState.globalEnabled;
    }

    const engineState = getState();
    if (shouldBeEnabled && !engineState.enabled) {
      applyDarkMode(newState.filterOptions);
    } else if (!shouldBeEnabled && engineState.enabled) {
      removeDarkMode();
    }
  });

  // Message handler
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'APPLY_DARK':
        applyDarkMode(msg.options);
        sendResponse({ ok: true });
        return true;
      case 'REMOVE_DARK':
        removeDarkMode();
        sendResponse({ ok: true });
        return true;
      case 'UPDATE_FILTER':
        updateFilter(msg.options);
        sendResponse({ ok: true });
        return true;
      case 'GET_STATE':
        sendResponse(getState());
        return true;
      case 'IS_ALREADY_DARK':
        sendResponse({ detection: detectNativeDarkMode() });
        return true;
      default:
        return false;
    }
  });
})();
