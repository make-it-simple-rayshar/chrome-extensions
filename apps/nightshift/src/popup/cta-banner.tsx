import { useEffect, useState } from 'react';

const LANDING_URL = 'https://nightshift.rayshar.com/pro';
const DISMISS_KEY = 'ctaDismissed';

export function CTABanner() {
  const [dismissed, setDismissed] = useState(true); // hidden until loaded

  useEffect(() => {
    chrome.storage.session.get(DISMISS_KEY, (result) => {
      if (chrome.runtime.lastError) return;
      setDismissed(!!result[DISMISS_KEY]);
    });
  }, []);

  const handleDismiss = () => {
    chrome.storage.session.set({ [DISMISS_KEY]: true });
    setDismissed(true);
  };

  const handleClick = () => {
    chrome.tabs.create({ url: LANDING_URL });
  };

  if (dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-gradient-to-r from-purple-600 to-blue-600 px-3 py-2">
      <button
        type="button"
        onClick={handleClick}
        className="text-xs font-medium text-white hover:underline"
      >
        Upgrade to NightShift Pro
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-white/60 hover:text-white text-sm leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
