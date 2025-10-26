import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppOptionsPage() {
  return (
    <div className="container max-w-2xl py-8">
      <div className="flex justify-center mb-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-muted rounded-md">
          <span className="text-sm font-medium text-muted-foreground" data-testid="text-work-in-progress">
            Work in Progress
          </span>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>App Options</CardTitle>
          <CardDescription>Application-wide settings and preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This page will contain application settings and preferences in future updates.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
