interface FilterOptions {
  brightness?: number;
  contrast?: number;
  sepia?: number;
}

interface GlobalState {
  globalEnabled: boolean;
  filterOptions: FilterOptions;
}

const DEFAULT_STATE: GlobalState = {
  globalEnabled: false,
  filterOptions: {},
};

let cachedState: GlobalState = { ...DEFAULT_STATE };

// Load state from storage on startup
chrome.storage.local.get('nightshift_state', (result) => {
  if (result.nightshift_state) {
    cachedState = result.nightshift_state as GlobalState;
  }
});

function saveState(): void {
  chrome.storage.local.set({ nightshift_state: cachedState });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'GET_STATE':
      sendResponse(cachedState);
      return true;

    case 'SET_ENABLED': {
      cachedState.globalEnabled = msg.enabled;
      saveState();

      // Notify all tabs
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          chrome.tabs.sendMessage(
            tab.id,
            {
              action: msg.enabled ? 'APPLY_DARK' : 'REMOVE_DARK',
              options: cachedState.filterOptions,
            },
            () => {
              // Ignore errors for tabs without content script
              if (chrome.runtime.lastError) {
                // expected for chrome:// and edge cases
              }
            },
          );
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
      // Content script reports page is already dark — no action needed
      sendResponse({ ok: true });
      return true;

    case 'DARK_STATE_CHANGED':
      sendResponse({ ok: true });
      return true;

    default:
      return false;
  }
});
