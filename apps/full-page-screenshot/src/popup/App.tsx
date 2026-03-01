import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCallback, useEffect, useState } from 'react';

type CaptureState = 'idle' | 'preparing' | 'capturing' | 'picking' | 'done' | 'error';

export function App() {
  const [state, setState] = useState<CaptureState>('idle');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;

  useEffect(() => {
    if (!chrome?.runtime?.onMessage) return;

    const listener = (msg: Record<string, unknown>) => {
      if (msg.action === 'CAPTURE_PREPARING') {
        setState('preparing');
      }
      if (msg.action === 'PROGRESS') {
        setState('capturing');
        setCurrent(msg.current as number);
        setTotal(msg.total as number);
      }
      if (msg.action === 'CAPTURE_COMPLETE') {
        setState('done');
        setTimeout(() => setState('idle'), 2000);
      }
      if (msg.action === 'CAPTURE_ERROR') {
        setState('error');
        setError('Capture failed. Try using "Select Element" instead.');
        setTimeout(() => setState('idle'), 4000);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleCapture = useCallback(() => {
    setState('preparing');
    setError('');
    setCurrent(0);
    setTotal(0);
    chrome.runtime?.sendMessage({ action: 'START_CAPTURE' });
  }, []);

  const handlePicker = useCallback(() => {
    setState('picking');
    setError('');
    chrome.runtime?.sendMessage({ action: 'START_PICKER' });
    setTimeout(() => window.close(), 300);
  }, []);

  const busy = state === 'preparing' || state === 'capturing';

  return (
    <Card className="w-[300px] border-0 shadow-none rounded-none">
      <CardContent className="flex flex-col gap-2 pt-4">
        <Button onClick={handleCapture} disabled={busy || state === 'picking'}>
          {busy ? 'Capturing...' : 'Capture Full Page'}
        </Button>
        <Button variant="secondary" onClick={handlePicker} disabled={busy || state === 'picking'}>
          {state === 'picking' ? 'Selecting...' : 'Select Element'}
        </Button>

        {state === 'preparing' && (
          <div className="mt-1">
            <p className="text-xs text-muted-foreground">Preparing page...</p>
          </div>
        )}

        {state === 'capturing' && (
          <div className="mt-1 space-y-1.5">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">
              Capturing... {current}/{total}
            </p>
          </div>
        )}

        {state === 'done' && (
          <p className="text-xs text-muted-foreground mt-1">Done! Screenshot saved.</p>
        )}

        {state === 'error' && <p className="text-xs text-destructive mt-1">{error}</p>}

        <div className="border-t pt-2 mt-1">
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSebo65n500yl7jp9ritrKcygwZmLrHzTcpPsSLVjzMRqdtIYQ/viewform"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Send feedback &#8599;
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
