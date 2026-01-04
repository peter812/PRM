import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function DummyAuth() {
  const [, navigate] = useLocation();

  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle data-testid="text-dummy-auth-title">Dummy Auth Page</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground" data-testid="text-dummy-auth-description">
            This is a placeholder authentication page. It is only accessible to logged-in users.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            data-testid="button-back-home"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
