(() => {
  if (window.__fullPageScreenshotInjected) return;
  window.__fullPageScreenshotInjected = true;

  const state = {
    savedScrollX: 0,
    savedScrollY: 0,
    hiddenElements: [],
    overflowOverrides: [],
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case 'PREPARE_CAPTURE':
        handlePrepare(sendResponse);
        return true;
      case 'SCROLL_TO':
        handleScrollTo(msg.y, sendResponse);
        return true;
      case 'HIDE_FIXED':
        handleHideFixed(sendResponse);
        return true;
      case 'RESTORE':
        handleRestore(sendResponse);
        return true;
    }
  });

  function handlePrepare(sendResponse) {
    state.savedScrollX = window.scrollX;
    state.savedScrollY = window.scrollY;

    // Remove overflow:hidden from html/body so we can scroll the full page
    for (const el of [document.documentElement, document.body]) {
      const computed = getComputedStyle(el);
      if (computed.overflow === 'hidden' || computed.overflowY === 'hidden') {
        state.overflowOverrides.push({
          element: el,
          overflow: el.style.overflow,
          overflowY: el.style.overflowY,
        });
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
      }
    }

    // Scroll to top before measuring
    window.scrollTo(0, 0);

    // Force layout recalculation after overflow change
    void document.documentElement.offsetHeight;

    const body = document.body;
    const html = document.documentElement;
    const totalHeight = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.scrollHeight,
      html.offsetHeight,
    );
    const totalWidth = Math.max(
      body.scrollWidth,
      body.offsetWidth,
      html.scrollWidth,
      html.offsetWidth,
    );
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const dpr = window.devicePixelRatio || 1;

    sendResponse({ totalHeight, totalWidth, viewportHeight, viewportWidth, dpr });
  }

  function handleScrollTo(y, sendResponse) {
    window.scrollTo(0, y);
    // Wait for scroll + a repaint frame to settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sendResponse({ actualY: window.scrollY });
      });
    });
  }

  function handleHideFixed(sendResponse) {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        state.hiddenElements.push({
          element: el,
          originalVisibility: el.style.visibility,
        });
        el.style.visibility = 'hidden';
      }
    }
    sendResponse({ hidden: state.hiddenElements.length });
  }

  function handleRestore(sendResponse) {
    for (const { element, originalVisibility } of state.hiddenElements) {
      element.style.visibility = originalVisibility;
    }
    state.hiddenElements = [];

    for (const { element, overflow, overflowY } of state.overflowOverrides) {
      element.style.overflow = overflow;
      element.style.overflowY = overflowY;
    }
    state.overflowOverrides = [];

    window.scrollTo(state.savedScrollX, state.savedScrollY);
    sendResponse({ restored: true });
  }
})();
