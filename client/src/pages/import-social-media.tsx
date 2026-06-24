import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, FileText, AlertCircle, CheckCircle2, UserCheck, X, Users, UserPlus } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccountWithCurrentProfile } from "@shared/schema";

const FILENAME_REGEX = /^(.+?)_(followers|following)\.csv$/i;

function parseInstagramFilename(filename: string): { username: string; type: "followers" | "following" } | null {
  const match = filename.match(FILENAME_REGEX);
  if (!match) return null;
  return {
    username: match[1],
    type: match[2].toLowerCase() as "followers" | "following",
  };
}

interface ParsedFile {
  file: File;
  username: string;
  type: "followers" | "following";
}

interface FileError {
  filename: string;
  message: string;
}

interface TaskResult {
  imported: number;
  updated: number;
  total: number;
  skippedRows: number;
}

interface FileTaskState {
  taskId: string | null;
  isPolling: boolean;
  result: TaskResult | null;
  type: "followers" | "following";
}

export default function ImportSocialMediaPage() {
  // Multi-file selection: up to one followers + one following
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([]);
  const [fileErrors, setFileErrors] = useState<FileError[]>([]);

  // Manual overrides (applied to all files in the batch)
  const [manualTypeEnabled, setManualTypeEnabled] = useState(false);
  const [manualAccountEnabled, setManualAccountEnabled] = useState(false);
  const [manualFollowersType, setManualFollowersType] = useState<"followers" | "following">("followers");
  const [manualFollowingType, setManualFollowingType] = useState<"followers" | "following">("following");
  const [forceUpdateImages, setForceUpdateImages] = useState(false);

  // Account picker
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>("");
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialAccountWithCurrentProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Per-file task tracking: keyed by "followers" | "following"
  const [followerTask, setFollowerTask] = useState<FileTaskState>({ taskId: null, isPolling: false, result: null, type: "followers" });
  const [followingTask, setFollowingTask] = useState<FileTaskState>({ taskId: null, isPolling: false, result: null, type: "following" });
  const followerPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followingPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Account search ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (accountSearchQuery.length < 3) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams();
        params.set("offset", "0");
        params.set("limit", "20");
        params.set("search", accountSearchQuery);
        const response = await fetch(`/api/social-accounts/paginated?${params.toString()}`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data);
        }
      } catch {
        // silently fail
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [accountSearchQuery]);

  // ── Task polling helpers ─────────────────────────────────────────────────────
  function startPolling(
    taskId: string,
    taskType: "followers" | "following",
    setTask: React.Dispatch<React.SetStateAction<FileTaskState>>,
    pollRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) {
    const label = taskType === "followers" ? "Followers" : "Following";

    const poll = async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, { credentials: "include" });
        if (!response.ok) { pollRef.current = setTimeout(poll, 2000); return; }
        const task = await response.json();

        if (task.status === "completed") {
          const result = JSON.parse(task.result || "{}");
          setTask({ taskId: null, isPolling: false, result, type: taskType });
          queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
          queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });
          toast({
            title: `${label} Import Complete`,
            description: `Imported ${result.imported} accounts${result.updated > 0 ? `, updated ${result.updated}` : ""}${result.skippedRows > 0 ? ` (${result.skippedRows} rows skipped)` : ""}`,
          });
        } else if (task.status === "failed") {
          setTask({ taskId: null, isPolling: false, result: null, type: taskType });
          toast({
            title: `${label} Import Failed`,
            description: task.result || "An error occurred during import",
            variant: "destructive",
          });
        } else {
          pollRef.current = setTimeout(poll, 2000);
        }
      } catch {
        pollRef.current = setTimeout(poll, 3000);
      }
    };

    setTask({ taskId, isPolling: true, result: null, type: taskType });
    pollRef.current = setTimeout(poll, 1000);
  }

  // Cleanup poll timers on unmount
  useEffect(() => {
    return () => {
      if (followerPollRef.current) clearTimeout(followerPollRef.current);
      if (followingPollRef.current) clearTimeout(followingPollRef.current);
    };
  }, []);

  // ── Import mutations ─────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: async ({
      file,
      username,
      accountId,
      importType,
      forceImages,
    }: {
      file: File;
      username: string;
      accountId: string;
      importType: "followers" | "following";
      forceImages: boolean;
    }) => {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("username", username);
      if (accountId) formData.append("accountId", accountId);
      formData.append("importType", importType);
      if (forceImages) formData.append("forceUpdateImages", "true");

      const response = await fetch("/api/import-instagram", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import Instagram data");
      }

      return response.json();
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ── File picker ──────────────────────────────────────────────────────────────
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const newParsed: ParsedFile[] = [];
    const newErrors: FileError[] = [];

    // Deduplicate by type: last one wins
    const byType = new Map<"followers" | "following", ParsedFile>();

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        newErrors.push({ filename: file.name, message: "Not a CSV file (.csv required)" });
        continue;
      }
      const parsed = parseInstagramFilename(file.name);
      if (!parsed) {
        newErrors.push({
          filename: file.name,
          message: `Filename must follow the pattern: {username}_followers.csv or {username}_following.csv`,
        });
        continue;
      }
      byType.set(parsed.type, { file, ...parsed });
    }

    // Merge with existing parsed files so you can add them one at a time
    const merged = new Map<"followers" | "following", ParsedFile>(
      parsedFiles.map(p => [p.type, p])
    );
    for (const [type, pf] of byType) {
      merged.set(type, pf);
    }

    setParsedFiles(Array.from(merged.values()));
    setFileErrors(newErrors);

    // Reset the input so the user can re-select the same files
    event.target.value = "";
  };

  const removeFile = (type: "followers" | "following") => {
    setParsedFiles(prev => prev.filter(p => p.type !== type));
    if (type === "followers") setFollowerTask({ taskId: null, isPolling: false, result: null, type: "followers" });
    if (type === "following") setFollowingTask({ taskId: null, isPolling: false, result: null, type: "following" });
  };

  const clearAll = () => {
    setParsedFiles([]);
    setFileErrors([]);
    setFollowerTask({ taskId: null, isPolling: false, result: null, type: "followers" });
    setFollowingTask({ taskId: null, isPolling: false, result: null, type: "following" });
  };

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!parsedFiles.length) return;

    for (const pf of parsedFiles) {
      const effectiveType = manualTypeEnabled
        ? (pf.type === "followers" ? manualFollowersType : manualFollowingType)
        : pf.type;
      const effectiveUsername = pf.username;

      try {
        const data = await importMutation.mutateAsync({
          file: pf.file,
          username: effectiveUsername,
          accountId: manualAccountEnabled ? selectedAccountId : "",
          importType: effectiveType,
          forceImages: forceUpdateImages,
        });

        if (pf.type === "followers") {
          startPolling(data.taskId, "followers", setFollowerTask, followerPollRef);
        } else {
          startPolling(data.taskId, "following", setFollowingTask, followingPollRef);
        }
      } catch {
        // onError toast already handled in mutation
      }
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const followerFile = parsedFiles.find(p => p.type === "followers");
  const followingFile = parsedFiles.find(p => p.type === "following");
  const isAnyPolling = followerTask.isPolling || followingTask.isPolling;
  const isPending = importMutation.isPending || isAnyPolling;
  const canSubmit = parsedFiles.length > 0 && !isPending;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SiInstagram className="h-5 w-5" />
            Instagram Import
          </CardTitle>
          <CardDescription>
            Import followers and/or following data from Instagram CSV exports. You can select both files at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">

            {/* ── File picker ── */}
            <div className="space-y-2">
              <Label htmlFor="instagram-file-input">CSV Files</Label>
              <p className="text-xs text-muted-foreground">
                Name your files{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">username_followers.csv</code>{" "}
                and/or{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">username_following.csv</code>{" "}
                — the account and import type are detected automatically. Select one or both at once.
              </p>
              <div className="flex items-center gap-3">
                <Input
                  id="instagram-file-input"
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleFileChange}
                  disabled={isPending}
                  data-testid="input-instagram-file"
                  className="cursor-pointer"
                />
              </div>
            </div>

            {/* ── File errors ── */}
            {fileErrors.map(err => (
              <div
                key={err.filename}
                className="flex items-start gap-2 text-sm text-destructive"
                data-testid="error-filename-format"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span><span className="font-medium">{err.filename}:</span> {err.message}</span>
              </div>
            ))}

            {/* ── Detected file cards ── */}
            {parsedFiles.length > 0 && (
              <div className="space-y-2">
                {followerFile && (
                  <FileCard
                    parsedFile={followerFile}
                    taskState={followerTask}
                    onRemove={() => removeFile("followers")}
                    isPending={isPending}
                  />
                )}
                {followingFile && (
                  <FileCard
                    parsedFile={followingFile}
                    taskState={followingTask}
                    onRemove={() => removeFile("following")}
                    isPending={isPending}
                  />
                )}
              </div>
            )}

            {/* ── Manual type overrides (revealed by checkbox) ── */}
            {manualTypeEnabled && parsedFiles.length > 0 && (
              <div className="space-y-3 rounded-md border p-4">
                <p className="text-sm font-medium">Override Import Types</p>
                {parsedFiles.map(pf => (
                  <div key={pf.type} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium">{pf.file.name}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={
                          (pf.type === "followers" ? manualFollowersType : manualFollowingType) === "followers"
                            ? "text-foreground font-medium text-sm"
                            : "text-muted-foreground text-sm"
                        }
                      >
                        Followers
                      </span>
                      <Switch
                        id={`override-type-${pf.type}`}
                        checked={(pf.type === "followers" ? manualFollowersType : manualFollowingType) === "following"}
                        onCheckedChange={(checked) => {
                          if (pf.type === "followers") setManualFollowersType(checked ? "following" : "followers");
                          else setManualFollowingType(checked ? "following" : "followers");
                        }}
                        data-testid={`switch-import-type-${pf.type}`}
                      />
                      <span
                        className={
                          (pf.type === "followers" ? manualFollowersType : manualFollowingType) === "following"
                            ? "text-foreground font-medium text-sm"
                            : "text-muted-foreground text-sm"
                        }
                      >
                        Following
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Manual account picker (revealed by checkbox) ── */}
            {manualAccountEnabled && (
              <div className="space-y-2">
                <Label>Override Account</Label>
                <Popover open={accountSearchOpen} onOpenChange={(open) => { setAccountSearchOpen(open); if (!open) setAccountSearchQuery(''); }}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                      data-testid="select-instagram-account"
                    >
                      {selectedAccountLabel || "Search for an account..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Type 3+ characters to search..."
                        value={accountSearchQuery}
                        onValueChange={setAccountSearchQuery}
                        data-testid="input-account-search"
                      />
                      <CommandList>
                        {accountSearchQuery.length > 0 && accountSearchQuery.length < 3 && (
                          <div className="p-3 text-sm text-muted-foreground text-center">
                            Type {3 - accountSearchQuery.length} more character{3 - accountSearchQuery.length > 1 ? 's' : ''} to search...
                          </div>
                        )}
                        {accountSearchQuery.length >= 3 && isSearching && (
                          <div className="p-3 text-sm text-muted-foreground text-center">
                            Searching...
                          </div>
                        )}
                        {accountSearchQuery.length >= 3 && !isSearching && searchResults.length === 0 && (
                          <CommandEmpty>No account found.</CommandEmpty>
                        )}
                        {accountSearchQuery.length >= 3 && !isSearching && searchResults.length > 0 && (
                          <CommandGroup>
                            {searchResults.map((account) => (
                              <CommandItem
                                key={account.id}
                                value={account.id}
                                onSelect={() => {
                                  setSelectedAccountId(account.id);
                                  const label = account.currentProfile?.nickname
                                    ? `${account.currentProfile?.nickname} (@${account.username})`
                                    : account.username;
                                  setSelectedAccountLabel(label);
                                  setAccountSearchOpen(false);
                                  setAccountSearchQuery('');
                                }}
                                data-testid={`option-account-${account.id}`}
                              >
                                {account.username}
                                {account.currentProfile?.nickname && (
                                  <span className="ml-1 text-muted-foreground">({account.currentProfile?.nickname})</span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Overrides the account detected from the filename for all selected files
                </p>
              </div>
            )}

            {/* ── Force update images ── */}
            <div className="flex items-center gap-3 rounded-md border p-4">
              <Checkbox
                id="force-update-images"
                checked={forceUpdateImages}
                onCheckedChange={(checked) => setForceUpdateImages(checked === true)}
                data-testid="checkbox-force-update-images"
              />
              <div className="space-y-0.5">
                <Label htmlFor="force-update-images" className="text-base font-medium cursor-pointer">
                  Force Update Images
                </Label>
                <p className="text-sm text-muted-foreground">
                  Re-download profile images for all accounts, even if they already have one
                </p>
              </div>
            </div>

            {/* ── CSV format notes ── */}
            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">CSV Format Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Expected CSV format: "followed_by_viewer";"full_name";"id";"is_verified";"profile_pic_url";"requested_by_viewer";"username"</li>
                    <li>New accounts will be created if username doesn't exist</li>
                    <li>Existing accounts will be updated with nickname and profile picture</li>
                    <li>Follower/following relationships will be updated for the detected account</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ── Manual override checkboxes ── */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manual Overrides</p>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="manual-type"
                  checked={manualTypeEnabled}
                  onCheckedChange={(checked) => setManualTypeEnabled(checked === true)}
                  data-testid="checkbox-manual-type"
                />
                <Label htmlFor="manual-type" className="cursor-pointer text-sm">
                  Manually select followers / following type per file
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="manual-account"
                  checked={manualAccountEnabled}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true;
                    setManualAccountEnabled(enabled);
                    if (!enabled) {
                      setSelectedAccountId("");
                      setSelectedAccountLabel("");
                    }
                  }}
                  data-testid="checkbox-manual-account"
                />
                <Label htmlFor="manual-account" className="cursor-pointer text-sm">
                  Manually select social account
                </Label>
              </div>
            </div>

            {/* ── Action buttons ── */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleImport}
                disabled={!canSubmit}
                data-testid="button-import-instagram"
                className="gap-2"
              >
                {isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    {isAnyPolling ? "Processing..." : "Uploading..."}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    {parsedFiles.length === 2
                      ? "Import Both"
                      : parsedFiles.length === 1
                        ? `Import ${parsedFiles[0].type === "followers" ? "Followers" : "Following"}`
                        : "Import"}
                  </>
                )}
              </Button>

              {parsedFiles.length > 0 && !isPending && (
                <Button
                  variant="outline"
                  onClick={clearAll}
                  data-testid="button-clear-instagram-file"
                >
                  Clear All
                </Button>
              )}
            </div>

            {/* ── Background processing banner ── */}
            {isAnyPolling && (
              <div className="rounded-md bg-muted p-4">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="h-4 w-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span>Import is running in the background. This may take a few minutes for large files.</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-component: file status card ──────────────────────────────────────────

interface FileCardProps {
  parsedFile: ParsedFile;
  taskState: FileTaskState;
  onRemove: () => void;
  isPending: boolean;
}

function FileCard({ parsedFile, taskState, onRemove, isPending }: FileCardProps) {
  const isFollowers = parsedFile.type === "followers";

  return (
    <div className="rounded-md border p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isFollowers ? (
            <Users className="h-4 w-4 text-primary shrink-0" />
          ) : (
            <UserPlus className="h-4 w-4 text-primary shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-sm">
                <span className="font-medium">@{parsedFile.username}</span>
                {" · "}
                <span className="font-medium capitalize">{parsedFile.type}</span>
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <FileText className="h-3 w-3" />
              <span className="truncate" data-testid={`text-selected-instagram-filename-${parsedFile.type}`}>
                {parsedFile.file.name}
              </span>
            </div>
          </div>
        </div>
        {!isPending && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onRemove}
            data-testid={`button-remove-file-${parsedFile.type}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Per-file result */}
      {taskState.isPolling && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 border border-muted-foreground border-t-transparent rounded-full animate-spin" />
          <span>Processing in background…</span>
        </div>
      )}
      {taskState.result && (
        <div className="flex items-start gap-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs" data-testid={`text-instagram-import-success-${parsedFile.type}`}>
            Imported {taskState.result.imported} account{taskState.result.imported !== 1 ? "s" : ""}
            {taskState.result.updated > 0 && <span> ({taskState.result.updated} updated)</span>}
            {taskState.result.skippedRows > 0 && <span> ({taskState.result.skippedRows} rows skipped)</span>}
          </p>
        </div>
      )}
    </div>
  );
}
