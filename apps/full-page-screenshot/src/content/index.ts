(() => {
  // Allow re-injection if extension was reloaded (context invalidated)
  if ((window as unknown as Record<string, unknown>).__fullPageScreenshotInjected) {
    try {
      chrome.runtime.getURL('');
      return; // Extension still valid, skip re-injection
    } catch {
      // Extension context invalidated — allow re-injection
    }
  }
  (window as unknown as Record<string, unknown>).__fullPageScreenshotInjected = true;

  const DEBUG = import.meta.env.DEV;

  interface CaptureState {
    savedScrollX: number;
    savedScrollY: number;
    hiddenElements: { element: HTMLElement; originalVisibility: string }[];
    overflowOverrides: {
      element: HTMLElement;
      overflow: string;
      overflowY: string;
      maxHeight: string;
      height: string;
      scrollBehavior: string;
    }[];
    scrollContainer: HTMLElement | null;
    injectedStyle: HTMLStyleElement | null;
    pickerCleanup: (() => void) | null;
  }

  const state: CaptureState = {
    savedScrollX: 0,
    savedScrollY: 0,
    hiddenElements: [],
    overflowOverrides: [],
    scrollContainer: null,
    injectedStyle: null,
    pickerCleanup: null,
  };

  chrome.runtime.onMessage.addListener((msg: Record<string, unknown>, _sender, sendResponse) => {
    switch (msg.action) {
      case 'PREPARE_CAPTURE':
        handlePrepare(sendResponse, msg.targetIndex as number | undefined);
        return true;
      case 'SCROLL_TO':
        handleScrollTo(msg.y as number, sendResponse);
        return true;
      case 'HIDE_FIXED':
        handleHideFixed(sendResponse);
        return true;
      case 'RESTORE':
        handleRestore(sendResponse);
        return true;
      case 'GET_DPR':
        sendResponse({ dpr: window.devicePixelRatio || 1 });
        return false;
      case 'ACTIVATE_PICKER':
        handleActivatePicker(sendResponse);
        return true;
    }
  });

  // --- Auto-detection ---

  function findScrollableContainers(): HTMLElement[] {
    const candidates: HTMLElement[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const el = node as HTMLElement;
      const style = getComputedStyle(el);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 5
      ) {
        candidates.push(el);
      }
      node = walker.nextNode();
    }
    return candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
  }

  function findPrimaryScrollContainer(): HTMLElement | null {
    const docEl = document.documentElement;
    if (docEl.scrollHeight > window.innerHeight + 5) {
      return null; // document-level scrolling works
    }
    const candidates = findScrollableContainers();
    return candidates.length > 0 ? candidates[0] : null;
  }

  // --- Handlers ---

  function handlePrepare(sendResponse: (response: unknown) => void, targetIndex?: number) {
    state.savedScrollX = window.scrollX;
    state.savedScrollY = window.scrollY;

    // Disable smooth scrolling on document
    for (const el of [document.documentElement, document.body]) {
      const computed = getComputedStyle(el);
      state.overflowOverrides.push({
        element: el,
        overflow: el.style.overflow,
        overflowY: el.style.overflowY,
        maxHeight: el.style.maxHeight,
        height: el.style.height,
        scrollBehavior: el.style.scrollBehavior,
      });

      // Fix smooth scroll
      el.style.scrollBehavior = 'auto';

      // Remove overflow:hidden from html/body
      if (computed.overflow === 'hidden' || computed.overflowY === 'hidden') {
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
      }
    }

    // Hide scrollbars during capture
    const style = document.createElement('style');
    style.id = '__fps-scrollbar-hide';
    style.textContent = `
      ::-webkit-scrollbar { display: none !important; }
      * { scrollbar-width: none !important; }
    `;
    document.head.appendChild(style);
    state.injectedStyle = style;

    // Force layout recalculation
    void document.documentElement.offsetHeight;

    // Find scroll container
    let scrollContainer: HTMLElement | null = null;
    if (targetIndex !== undefined) {
      const containers = findScrollableContainers();
      scrollContainer = containers[targetIndex] ?? null;
    } else {
      scrollContainer = findPrimaryScrollContainer();
    }

    state.scrollContainer = scrollContainer;

    if (scrollContainer) {
      // Disable smooth scroll on container
      scrollContainer.style.scrollBehavior = 'auto';
      scrollContainer.scrollTo(0, 0);
      void scrollContainer.offsetHeight;

      const totalHeight = scrollContainer.scrollHeight;
      const totalWidth = scrollContainer.scrollWidth;
      const viewportHeight = scrollContainer.clientHeight;
      const viewportWidth = scrollContainer.clientWidth;
      const rect = scrollContainer.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (DEBUG)
        console.log('[FPS] Container mode:', {
          totalHeight,
          viewportHeight,
          containerRect: rect,
        });

      sendResponse({
        totalHeight,
        totalWidth,
        viewportHeight,
        viewportWidth,
        dpr,
        containerMode: true,
        containerRect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      });
    } else {
      // Document-level scrolling
      window.scrollTo(0, 0);
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

      if (DEBUG) console.log('[FPS] Document mode:', { totalHeight, viewportHeight });

      sendResponse({
        totalHeight,
        totalWidth,
        viewportHeight,
        viewportWidth,
        dpr,
        containerMode: false,
      });
    }
  }

  function handleScrollTo(y: number, sendResponse: (response: unknown) => void) {
    if (state.scrollContainer) {
      state.scrollContainer.scrollTo(0, y);
    } else {
      window.scrollTo(0, y);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const actualY = state.scrollContainer ? state.scrollContainer.scrollTop : window.scrollY;
        sendResponse({ actualY });
      });
    });
  }

  function handleHideFixed(sendResponse: (response: unknown) => void) {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const htmlEl = el as HTMLElement;
      const pos = getComputedStyle(htmlEl).position;
      if (pos === 'fixed' || pos === 'sticky') {
        state.hiddenElements.push({
          element: htmlEl,
          originalVisibility: htmlEl.style.visibility,
        });
        htmlEl.style.visibility = 'hidden';
      }
    }
    sendResponse({ hidden: state.hiddenElements.length });
  }

  function handleRestore(sendResponse: (response: unknown) => void) {
    // Restore hidden elements
    for (const { element, originalVisibility } of state.hiddenElements) {
      element.style.visibility = originalVisibility;
    }
    state.hiddenElements = [];

    // Restore overflow and scroll behavior
    for (const saved of state.overflowOverrides) {
      saved.element.style.overflow = saved.overflow;
      saved.element.style.overflowY = saved.overflowY;
      saved.element.style.maxHeight = saved.maxHeight;
      saved.element.style.height = saved.height;
      saved.element.style.scrollBehavior = saved.scrollBehavior;
    }
    state.overflowOverrides = [];

    // Restore container scroll behavior
    if (state.scrollContainer) {
      state.scrollContainer.style.scrollBehavior = '';
    }
    state.scrollContainer = null;

    // Remove injected scrollbar-hide style
    if (state.injectedStyle) {
      state.injectedStyle.remove();
      state.injectedStyle = null;
    }

    // Restore scroll position
    window.scrollTo(state.savedScrollX, state.savedScrollY);

    // Allow re-injection
    (window as unknown as Record<string, unknown>).__fullPageScreenshotInjected = false;

    sendResponse({ restored: true });
  }

  // --- Element Picker ---

  function handleActivatePicker(sendResponse: (response: unknown) => void) {
    // Clean up any existing picker overlay
    if (state.pickerCleanup) {
      state.pickerCleanup();
    }

    const scrollableContainers = findScrollableContainers();

    // Create overlay elements
    const glass = document.createElement('div');
    glass.id = '__fps-glass';
    Object.assign(glass.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483647',
      cursor: 'crosshair',
      background: 'transparent',
    });

    const overlay = document.createElement('div');
    overlay.id = '__fps-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });

    const highlight = document.createElement('div');
    highlight.id = '__fps-highlight';
    Object.assign(highlight.style, {
      position: 'absolute',
      borderRadius: '4px',
      transition: 'all 0.1s ease',
      display: 'none',
      pointerEvents: 'none',
    });

    const tooltip = document.createElement('div');
    tooltip.id = '__fps-tooltip';
    Object.assign(tooltip.style, {
      position: 'absolute',
      background: '#1e293b',
      color: '#f8fafc',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontFamily: 'monospace',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '1',
    });

    overlay.appendChild(highlight);
    overlay.appendChild(tooltip);
    document.body.appendChild(overlay);
    document.body.appendChild(glass);

    let selectedElement: HTMLElement | null = null;
    let selectedScrollable = false;
    let selectedScrollIndex = -1;
    const activatedAt = Date.now();
    const ARM_DELAY_MS = 400;

    const onMouseMove = (e: MouseEvent) => {
      // Ignore mouse events during arm delay — gives popup time to close
      if (Date.now() - activatedAt < ARM_DELAY_MS) return;

      glass.style.display = 'none';
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      glass.style.display = '';

      if (!target || target === overlay || overlay.contains(target)) {
        highlight.style.display = 'none';
        tooltip.style.display = 'none';
        selectedElement = null;
        glass.style.cursor = 'crosshair';
        return;
      }

      // Skip tiny/invisible elements
      const rect = target.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) {
        highlight.style.display = 'none';
        tooltip.style.display = 'none';
        selectedElement = null;
        glass.style.cursor = 'crosshair';
        return;
      }

      // Drill down through oversized elements to find the most specific child under cursor
      let picked = target;
      const vpArea = window.innerWidth * window.innerHeight;
      const MAX_AREA_RATIO = 0.85;
      const MAX_DRILL_DEPTH = 10;

      for (let depth = 0; depth < MAX_DRILL_DEPTH; depth++) {
        const pr = picked.getBoundingClientRect();
        if (pr.width * pr.height <= vpArea * MAX_AREA_RATIO) break;

        // Find the smallest child that still contains the cursor
        let bestChild: HTMLElement | null = null;
        let bestArea = pr.width * pr.height;
        const children = picked.children;
        for (let ci = 0; ci < children.length; ci++) {
          const child = children[ci] as HTMLElement;
          const cr = child.getBoundingClientRect();
          const childArea = cr.width * cr.height;
          if (
            cr.width >= 20 &&
            cr.height >= 20 &&
            cr.left <= e.clientX &&
            cr.right >= e.clientX &&
            cr.top <= e.clientY &&
            cr.bottom >= e.clientY &&
            childArea < bestArea
          ) {
            bestChild = child;
            bestArea = childArea;
          }
        }
        if (!bestChild) break;
        picked = bestChild;
      }

      selectedElement = picked;
      glass.style.cursor = 'pointer';

      // Check if this element (or an ancestor) is scrollable
      const scrollIdx = scrollableContainers.findIndex((c) => c === picked || c.contains(picked));
      selectedScrollable = scrollIdx !== -1;
      selectedScrollIndex = scrollIdx;

      // Use different colors: blue for scrollable, green for static
      const isScrollable = selectedScrollable;
      const borderColor = isScrollable ? '#3b82f6' : '#22c55e';
      const bgColor = isScrollable ? 'rgba(59, 130, 246, 0.15)' : 'rgba(34, 197, 94, 0.15)';

      // If scrollable, highlight the scrollable container instead
      const highlightEl = isScrollable ? scrollableContainers[scrollIdx] : picked;
      const highlightRect = highlightEl.getBoundingClientRect();

      Object.assign(highlight.style, {
        display: 'block',
        border: `2px solid ${borderColor}`,
        background: bgColor,
        top: `${highlightRect.top}px`,
        left: `${highlightRect.left}px`,
        width: `${highlightRect.width}px`,
        height: `${highlightRect.height}px`,
      });

      const tag = highlightEl.tagName.toLowerCase();
      const cls = highlightEl.className
        ? `.${String(highlightEl.className).split(' ').slice(0, 2).join('.')}`
        : '';
      const dims = `${Math.round(highlightRect.width)}×${Math.round(highlightRect.height)}`;
      const scrollLabel = isScrollable ? ' ↕ scrollable' : '';
      const info = `<${tag}${cls}> | ${dims}${scrollLabel}`;

      tooltip.textContent = info;
      Object.assign(tooltip.style, {
        display: 'block',
        top: `${Math.max(0, highlightRect.top - 24)}px`,
        left: `${highlightRect.left}px`,
      });
    };

    const cleanup = () => {
      glass.removeEventListener('mousemove', onMouseMove);
      glass.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      glass.remove();
      overlay.remove();
      state.pickerCleanup = null;
    };

    const safeSendMessage = (message: Record<string, unknown>) => {
      try {
        chrome.runtime.sendMessage(message);
      } catch {
        // Extension context invalidated — ignore
      }
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedElement) return;

      // Get the element that was actually highlighted
      const captureEl = selectedScrollable
        ? scrollableContainers[selectedScrollIndex]
        : selectedElement;
      const rect = captureEl.getBoundingClientRect();

      // Detect if the selected element is an iframe
      const isIframe = captureEl.tagName === 'IFRAME';
      const iframeSrc = isIframe ? (captureEl as HTMLIFrameElement).src : undefined;

      const result: Record<string, unknown> = {
        action: 'PICKER_RESULT',
        isScrollable: selectedScrollable,
        isIframe,
        iframeSrc,
        targetIndex: selectedScrollable ? selectedScrollIndex : undefined,
        targetRect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      };

      // Remove overlay, then wait for browser repaint before notifying background
      cleanup();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          safeSendMessage(result);
        });
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        safeSendMessage({ action: 'PICKER_CANCELLED' });
      }
    };

    glass.addEventListener('mousemove', onMouseMove);
    glass.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);

    state.pickerCleanup = cleanup;
    sendResponse({ activated: true });
  }
})();
