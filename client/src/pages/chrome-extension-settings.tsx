import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Chrome, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Refresh the code 5 seconds before expiry to ensure seamless transition
const CODE_REFRESH_INTERVAL_MS = 55 * 1000;
// Sessions active within this threshold show as "Active"
const ACTIVE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;
// Code validity duration in seconds (matches server-side 60s)
const CODE_DURATION_SECONDS = 60;

type AuthCode = {
  code: string;
  expiresAt: string;
};

type ExtensionSession = {
  id: string;
  userId: number;
  name: string;
  lastAccessedAt: string;
  createdAt: string;
};

export default function ChromeExtensionSettingsPage() {
  const { toast } = useToast();
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState<AuthCode | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<ExtensionSession[]>({
    queryKey: ["/api/extension-sessions"],
  });

  const fetchCode = useCallback(async () => {
    try {
      const response = await apiRequest("GET", "/api/extension-auth/code");
      if (response.ok) {
        const data: AuthCode = await response.json();
        setAuthCode(data);
        const remaining = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
        setSecondsLeft(remaining);
      }
    } catch (error) {
      console.error("Error fetching auth code:", error);
    }
  }, []);

  // Fetch code on mount and auto-refresh
  useEffect(() => {
    fetchCode();

    // Refresh code before expiry
    fetchTimerRef.current = setInterval(() => {
      fetchCode();
    }, CODE_REFRESH_INTERVAL_MS);

    return () => {
      if (fetchTimerRef.current) clearInterval(fetchTimerRef.current);
    };
  }, [fetchCode]);

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Auto-fetch new code when timer hits 0
          fetchCode();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchCode]);

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/extension-sessions/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to revoke session");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/extension-sessions"] });
      toast({
        title: "Session Revoked",
        description: "The extension session has been revoked.",
      });
      setSessionToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const isRecentlyActive = (lastAccessedAt: string) => {
    const diff = Date.now() - new Date(lastAccessedAt).getTime();
    return diff < ACTIVE_SESSION_THRESHOLD_MS;
  };

  return (
    <div className="container max-w-full md:max-w-4xl py-3 md:py-8 px-4 md:pl-12 space-y-4 md:space-y-8 mx-auto md:mx-0">
      <div>
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-chrome-extension">
          Chrome Extension
        </h1>
        <p className="text-muted-foreground">
          Pair and manage Chrome extension sessions for your PRM.
        </p>
      </div>

      {/* Auth Code Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Chrome className="h-5 w-5" />
            Extension Pairing Code
          </CardTitle>
          <CardDescription>
            Enter this code in your Chrome extension to pair it with your PRM instance. The code refreshes every 60 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-4">
            {authCode ? (
              <>
                <div
                  className="text-6xl font-mono font-bold tracking-[0.5em] select-all"
                  data-testid="text-auth-code"
                >
                  {authCode.code}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className={`h-4 w-4 ${secondsLeft <= 10 ? "animate-spin" : ""}`} />
                  <span data-testid="text-code-timer">
                    {secondsLeft > 0
                      ? `Refreshes in ${secondsLeft}s`
                      : "Refreshing..."}
                  </span>
                </div>
                <div className="w-full max-w-xs bg-secondary rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-1000 ease-linear"
                    style={{ width: `${(secondsLeft / CODE_DURATION_SECONDS) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">Generating code...</div>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-2">
            <p className="font-medium mb-1">How to pair:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Install the PRM Chrome Extension</li>
              <li>Open the extension and enter your PRM server URL</li>
              <li>Enter the 4-digit code shown above</li>
              <li>The extension will be connected to your PRM</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Extension Sessions List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Active Sessions</h2>
            <p className="text-sm text-muted-foreground">
              Manage paired Chrome extension sessions
            </p>
          </div>
        </div>

        {sessionsLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading sessions...
            </CardContent>
          </Card>
        ) : sessions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Chrome className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-sessions">
                No extension sessions yet. Use the pairing code above to connect your Chrome extension.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <Card key={session.id} data-testid={`card-extension-session-${session.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Chrome className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-medium" data-testid={`text-session-name-${session.id}`}>
                          {session.name}
                        </h3>
                        {isRecentlyActive(session.lastAccessedAt) ? (
                          <Badge
                            className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25 hover:bg-green-500/25"
                            data-testid={`badge-session-active-${session.id}`}
                          >
                            <Wifi className="h-3 w-3 mr-1" />
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            data-testid={`badge-session-inactive-${session.id}`}
                          >
                            <WifiOff className="h-3 w-3 mr-1" />
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p data-testid={`text-session-created-${session.id}`}>
                          Paired {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                        </p>
                        <p data-testid={`text-session-last-accessed-${session.id}`}>
                          Last active {formatDistanceToNow(new Date(session.lastAccessedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSessionToDelete(session.id)}
                      data-testid={`button-revoke-session-${session.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!sessionToDelete}
        onOpenChange={(open) => !open && setSessionToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Extension Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this extension session? The Chrome extension will need
              to be re-paired using a new code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revoke">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sessionToDelete && deleteSessionMutation.mutate(sessionToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-revoke"
            >
              {deleteSessionMutation.isPending ? "Revoking..." : "Revoke Session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
