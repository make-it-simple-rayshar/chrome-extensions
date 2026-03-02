chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'GET_STATE') {
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
