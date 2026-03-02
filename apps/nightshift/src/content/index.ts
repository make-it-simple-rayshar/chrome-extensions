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

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
