import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function App() {
  return (
    <div className="w-80 p-4">
      <Card>
        <CardHeader>
          <CardTitle>NightShift</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button variant="default" className="w-full">
            Toggle Dark Mode
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
