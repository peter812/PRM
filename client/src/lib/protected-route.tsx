import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Redirect, Route, useLocation } from "wouter";
import { useEffect, useState } from "react";

export function ProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const [shouldRedirectToSso, setShouldRedirectToSso] = useState(false);

  const { data: ssoStatus, isLoading: ssoStatusLoading } = useQuery<{ enabled: number; autoSso: number }>({
    queryKey: ["/api/sso-config/status"],
    enabled: !user && !isLoading,
  });

  useEffect(() => {
    if (!user && !isLoading && ssoStatus?.enabled === 1 && ssoStatus?.autoSso === 1) {
      setShouldRedirectToSso(true);
      window.location.href = "/api/sso/login";
    }
  }, [user, isLoading, ssoStatus]);

  if (isLoading || (!user && ssoStatusLoading)) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (shouldRedirectToSso) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  return <Route path={path} component={Component} />;
}
