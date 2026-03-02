import {
  applyDarkMode,
  getState,
  isAlreadyDark,
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

  // FOUC Phase 1: apply filter immediately at document_start if cached state says ON
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.globalEnabled) {
      applyDarkMode(response.filterOptions);
    }
  });

  // FOUC Phase 2: check if page is already dark after DOM loads
  const onReady = () => {
    if (getState().enabled && isAlreadyDark()) {
      removeDarkMode();
      chrome.runtime.sendMessage({
        action: 'ALREADY_DARK_DETECTED',
        luminance: 0,
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

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
        sendResponse({ dark: isAlreadyDark() });
        return true;
      default:
        return false;
    }
  });
})();
