import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ServerOff } from "lucide-react";

type PrmS3Health = { ok: boolean; message: string };

const POLL_INTERVAL_MS = 30_000;

/**
 * PRM-S3 is the only media store, so an outage breaks every upload and image
 * in the app. While it is unreachable this shows a blocking modal; once
 * dismissed it collapses to a red banner at the top of the page until the
 * next poll succeeds.
 */
export function PrmS3StatusGuard({ enabled }: { enabled: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const { data, refetch, isFetching, isError, error } = useQuery<PrmS3Health>({
    queryKey: ["/api/prm-s3/health"],
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const down = isError || data?.ok === false;
  // The health route always answers 200, so a failed request means the PRM
  // backend itself is unreachable rather than PRM-S3.
  const backendOffline = isError;
  const title = backendOffline ? "Backend offline" : "PRM-S3 is not connected";
  const message = data?.message || (error instanceof Error ? error.message : "");

  // A recovered connection re-arms the modal for the next outage.
  useEffect(() => {
    if (!down) setDismissed(false);
  }, [down]);

  if (!enabled || !down) return null;

  const retry = (
    <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-prm-s3-retry">
      {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
      Retry
    </Button>
  );

  if (dismissed) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 px-4 py-2 bg-destructive text-destructive-foreground text-sm"
        data-testid="banner-prm-s3-down"
      >
        <ServerOff className="h-4 w-4 shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          {backendOffline
            ? "Backend offline — the PRM server cannot be reached."
            : `PRM-S3 is not connected — images and uploads will not work.${message ? ` ${message}` : ""}`}
        </span>
        <Link href="/settings/image-storage" className="underline shrink-0">Settings</Link>
        {retry}
      </div>
    );
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="border-destructive" data-testid="dialog-prm-s3-down">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ServerOff className="h-5 w-5" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {backendOffline ? (
              <>The PRM backend server is not responding. Make sure it is running, then retry.</>
            ) : (
              <>
                PRM stores every photo, video and face crop in PRM-S3, and it cannot be reached right now.
                Uploads will fail and images will not load until the service is back. Make sure the PRM-S3
                server is running and its endpoint is correct in Settings → Image Storage.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {message && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive break-all" data-testid="text-prm-s3-error">
            {message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDismissed(true)} data-testid="button-prm-s3-dismiss">Dismiss</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Link href="/settings/image-storage" onClick={() => setDismissed(true)}>Open Settings</Link>
          </AlertDialogAction>
          {retry}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
