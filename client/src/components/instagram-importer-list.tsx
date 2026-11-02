import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, LogIn, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { IMPORTERS_KEY, RUNS_KEY, sessionFromRuns, useImporters, useStoryRuns, type Importer, type StoryRun } from "@/lib/instagram";

/** One prm-stories install: its URL, secret and login. Schedules live on Social Accounts → Tracking. */
function ImporterCard({ importer, runs, onDelete, onChange }: { importer: Importer; runs: StoryRun[]; onDelete: (i: Importer) => void; onChange?: () => void }) {
  const { toast } = useToast();
  const session = sessionFromRuns(runs);
  const hasUrl = Boolean(importer.serviceUrl);
  // Asks the service directly, so a re-login as another account shows before the next run;
  // refetching on focus catches the person coming back from the login window.
  const { data: whoami } = useQuery({
    queryKey: [...IMPORTERS_KEY, importer.id, "whoami"],
    queryFn: async () => (await apiRequest("POST", `/api/stories/importers/${importer.id}/whoami`)).json() as Promise<{ username: string | null }>,
    enabled: hasUrl,
    refetchOnWindowFocus: true,
  });
  const username = whoami?.username ?? importer.lastUsername;

  const [label, setLabel] = useState(importer.label);
  const [apiUrl, setApiUrl] = useState(importer.serviceUrl);
  const [secret, setSecret] = useState("");

  const save = useMutation({
    mutationFn: async (patch: { label?: string; serviceUrl?: string; serviceSecret?: string }) =>
      apiRequest("PATCH", `/api/stories/importers/${importer.id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
      onChange?.();
    },
    onError: (error: Error) => toast({ title: "Failed to save importer", description: error.message, variant: "destructive" }),
  });

  const openLogin = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/stories/importers/${importer.id}/login`)).json() as Promise<{ ok: boolean; reason: string | null; error?: string }>,
    onSuccess: (r) => {
      if (r.ok) {
        toast({ title: "Chrome window opened", description: "Sign in to Instagram in the window, then close it." });
      } else {
        toast({
          title: r.reason === "already_running" ? "The service is busy" : `Couldn't open the window: ${r.reason}`,
          description: r.reason === "already_running" ? "A run or a login window is already using the browser profile. Try again when it finishes." : r.error,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => toast({ title: "Failed to reach the service", description: error.message, variant: "destructive" }),
  });

  return (
    <Card className="mb-4" data-testid={`card-importer-${importer.id}`}>
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <Input
              value={label}
             
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => (label.trim() && label.trim() !== importer.label ? save.mutate({ label: label.trim() }) : setLabel(importer.label))}
              className="h-9 text-base font-semibold px-2 -ml-2 w-full max-w-sm border-transparent hover:border-input focus:border-input"
              aria-label="Importer name"
              data-testid={`input-importer-label-${importer.id}`}
            />
            {username && (
              <p className="text-sm text-muted-foreground" data-testid={`text-importer-username-${importer.id}`}>@{username}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(importer)}
            title="Remove importer"
            data-testid={`button-delete-importer-${importer.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-start gap-2 text-sm pt-1">
          {session.ok === true && <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />}
          {session.ok === false && <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />}
          {session.ok === null && <HelpCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />}
          <span data-testid={`text-importer-session-${importer.id}`}>
            {session.label}
            {session.at && <span className="text-muted-foreground"> (as of {new Date(session.at).toLocaleString()})</span>}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`url-${importer.id}`}>Service URL</Label>
            <Input
              id={`url-${importer.id}`}
              placeholder="http://localhost:5055"
              value={apiUrl}
             
              onChange={(e) => setApiUrl(e.target.value)}
              onBlur={() => apiUrl.trim() !== importer.serviceUrl && save.mutate({ serviceUrl: apiUrl.trim() })}
              data-testid={`input-importer-url-${importer.id}`}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`secret-${importer.id}`}>Service secret</Label>
            <Input
              id={`secret-${importer.id}`}
              type="password"
              autoComplete="off"
              placeholder={importer.serviceSecretSet ? "(set — type to replace)" : "STORIES_SERVICE_SECRET on the service, if it has one"}
              value={secret}
             
              onChange={(e) => setSecret(e.target.value)}
              onBlur={() => {
                if (!secret.trim()) return;
                save.mutate({ serviceSecret: secret.trim() });
                setSecret("");
              }}
              data-testid={`input-importer-secret-${importer.id}`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" onClick={() => openLogin.mutate()} disabled={openLogin.isPending || !hasUrl} data-testid={`button-importer-login-${importer.id}`}>
            {openLogin.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
            {openLogin.isPending ? "Opening Chrome…" : "Open Instagram login"}
          </Button>
          {!hasUrl && <span className="text-sm text-muted-foreground">Set the service URL first.</span>}
          <Link href="~/social-accounts/tracking" className="text-sm text-primary hover:underline ml-auto" data-testid={`link-importer-schedule-${importer.id}`}>
            Schedules and run buttons →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}


/** The importers with add and remove; also shown in the setup assistant. onChange fires after any change. */
export function ImporterList({ onChange }: { onChange?: () => void }) {
  const { toast } = useToast();
  const { data: runs = [] } = useStoryRuns();
  const { data: importers = [] } = useImporters();
  const [importerToDelete, setImporterToDelete] = useState<Importer | null>(null);

  const addImporter = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stories/importers")).json() as Promise<Importer>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
      onChange?.();
    },
    onError: (error: Error) => toast({ title: "Failed to add importer", description: error.message, variant: "destructive" }),
  });

  const deleteImporter = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/stories/importers/${id}`),
    onSuccess: () => {
      toast({ title: "Importer removed", description: "Its past runs are kept." });
      setImporterToDelete(null);
      queryClient.invalidateQueries({ queryKey: IMPORTERS_KEY });
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
      onChange?.();
    },
    onError: (error: Error) => toast({ title: "Failed to remove importer", description: error.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-semibold">Importers</h2>
          <p className="text-sm text-muted-foreground">One card per Instagram account, each with its own prm-stories service.</p>
        </div>
        <Button size="icon" variant="outline" onClick={() => addImporter.mutate()} disabled={addImporter.isPending} title="Add importer" data-testid="button-add-importer">
          {addImporter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>
      {importers.length === 0 ? (
        <Card className="mb-6">
          <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-no-importers">
            No importers yet — add one per Instagram account.
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6">
          {importers.map((importer) => (
            <ImporterCard
              key={importer.id}
              importer={importer}
              runs={runs.filter((r) => r.importerId === importer.id)}
              onDelete={setImporterToDelete}
              onChange={onChange}
            />
          ))}
        </div>
      )}

      <AlertDialog open={!!importerToDelete} onOpenChange={(open) => !open && setImporterToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-importer">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove importer?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{importerToDelete?.label}</strong> will stop being scheduled. Its past runs stay in the log, and the
              stories it collected are not deleted. The prm-stories service itself is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-importer">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => importerToDelete && deleteImporter.mutate(importerToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteImporter.isPending}
              data-testid="button-confirm-delete-importer"
            >
              {deleteImporter.isPending ? "Removing…" : "Remove importer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
