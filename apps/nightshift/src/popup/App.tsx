import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function App() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        setLoading(false);
        return;
      }
      setEnabled(response?.globalEnabled ?? false);
      setLoading(false);
    });
  }, []);

  const handleToggle = useCallback(() => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    chrome.runtime.sendMessage({ action: 'SET_ENABLED', enabled: newEnabled });
  }, [enabled]);

  return (
    <div className="w-64 p-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">NightShift</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant={enabled ? 'secondary' : 'default'}
            className="w-full"
            onClick={handleToggle}
            disabled={loading}
          >
            {loading ? 'Loading...' : enabled ? 'Dark Mode ON' : 'Dark Mode OFF'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
