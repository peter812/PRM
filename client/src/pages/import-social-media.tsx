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
import { Upload, FileText, AlertCircle, CheckCircle2, UserCheck } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount } from "@shared/schema";

const FILENAME_REGEX = /^(.+?)_(followers|following)\.csv$/i;

function parseInstagramFilename(filename: string): { username: string; type: "followers" | "following" } | null {
  const match = filename.match(FILENAME_REGEX);
  if (!match) return null;
  return {
    username: match[1],
    type: match[2].toLowerCase() as "followers" | "following",
  };
}

export default function ImportSocialMediaPage() {
  const [selectedInstagramFile, setSelectedInstagramFile] = useState<File | null>(null);
  const [filenameError, setFilenameError] = useState<string | null>(null);
  const [detectedUsername, setDetectedUsername] = useState<string | null>(null);
  const [detectedType, setDetectedType] = useState<"followers" | "following" | null>(null);

  const [manualTypeEnabled, setManualTypeEnabled] = useState(false);
  const [manualAccountEnabled, setManualAccountEnabled] = useState(false);

  const [instagramImportType, setInstagramImportType] = useState<"followers" | "following">("followers");
  const [forceUpdateImages, setForceUpdateImages] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>("");
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialAccount[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskResult, setTaskResult] = useState<{ imported: number; updated: number; total: number; skippedRows: number } | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  useEffect(() => {
    if (!activeTaskId) return;

    const poll = async () => {
      try {
        const response = await fetch(`/api/tasks/${activeTaskId}`, { credentials: "include" });
        if (!response.ok) return;
        const task = await response.json();

        if (task.status === "completed") {
          setIsPolling(false);
          setActiveTaskId(null);
          const result = JSON.parse(task.result || "{}");
          setTaskResult(result);
          queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
          queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });
          toast({
            title: "Instagram Import Successful",
            description: `Imported ${result.imported} accounts${result.updated > 0 ? `, updated ${result.updated}` : ""}${result.skippedRows > 0 ? ` (${result.skippedRows} rows skipped)` : ""}`,
          });
          setSelectedInstagramFile(null);
          setDetectedUsername(null);
          setDetectedType(null);
          setFilenameError(null);
          setSelectedAccountId("");
          setSelectedAccountLabel("");
          const fileInput = document.getElementById("instagram-file-input") as HTMLInputElement;
          if (fileInput) fileInput.value = "";
        } else if (task.status === "failed") {
          setIsPolling(false);
          setActiveTaskId(null);
          toast({
            title: "Instagram Import Failed",
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

    setIsPolling(true);
    pollRef.current = setTimeout(poll, 1000);

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [activeTaskId]);

  const importInstagramMutation = useMutation({
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
    onSuccess: (data) => {
      setTaskResult(null);
      setActiveTaskId(data.taskId);
    },
    onError: (error: Error) => {
      toast({
        title: "Instagram Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isPending = importInstagramMutation.isPending || isPolling;

  const effectiveImportType = manualTypeEnabled ? instagramImportType : (detectedType ?? "followers");
  const effectiveUsername = detectedUsername ?? "";

  const canSubmit =
    selectedInstagramFile &&
    !filenameError &&
    detectedUsername !== null &&
    !isPending;

  const handleInstagramFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFilenameError("Please select a CSV file (.csv)");
      setSelectedInstagramFile(null);
      setDetectedUsername(null);
      setDetectedType(null);
      return;
    }

    const parsed = parseInstagramFilename(file.name);
    if (!parsed) {
      setFilenameError(
        `Filename must follow the pattern: {username}_followers.csv or {username}_following.csv — got "${file.name}"`
      );
      setSelectedInstagramFile(null);
      setDetectedUsername(null);
      setDetectedType(null);
      return;
    }

    setFilenameError(null);
    setSelectedInstagramFile(file);
    setDetectedUsername(parsed.username);
    setDetectedType(parsed.type);
    if (!manualTypeEnabled) {
      setInstagramImportType(parsed.type);
    }
  };

  const handleInstagramImport = () => {
    if (!canSubmit) return;
    setTaskResult(null);
    importInstagramMutation.mutate({
      file: selectedInstagramFile!,
      username: effectiveUsername,
      accountId: manualAccountEnabled ? selectedAccountId : "",
      importType: effectiveImportType,
      forceImages: forceUpdateImages,
    });
  };

  const clearFile = () => {
    setSelectedInstagramFile(null);
    setDetectedUsername(null);
    setDetectedType(null);
    setFilenameError(null);
    const fileInput = document.getElementById("instagram-file-input") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SiInstagram className="h-5 w-5" />
            Instagram Import
          </CardTitle>
          <CardDescription>Import followers or following data from an Instagram CSV export</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">

            {/* File picker */}
            <div className="space-y-2">
              <Label htmlFor="instagram-file-input">CSV File</Label>
              <p className="text-xs text-muted-foreground">
                Name your file <code className="bg-muted px-1 py-0.5 rounded text-xs">username_followers.csv</code> or <code className="bg-muted px-1 py-0.5 rounded text-xs">username_following.csv</code> — the account and import type are detected automatically.
              </p>
              <div className="flex items-center gap-3">
                <Input
                  id="instagram-file-input"
                  type="file"
                  accept=".csv"
                  onChange={handleInstagramFileChange}
                  disabled={isPending}
                  data-testid="input-instagram-file"
                  className="cursor-pointer"
                />
              </div>

              {/* Filename error */}
              {filenameError && (
                <div className="flex items-start gap-2 text-sm text-destructive" data-testid="error-filename-format">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{filenameError}</span>
                </div>
              )}

              {/* Auto-detected confirmation */}
              {selectedInstagramFile && detectedUsername && detectedType && (
                <div className="flex items-center gap-2 text-sm" data-testid="text-filename-detected">
                  <UserCheck className="h-4 w-4 text-primary shrink-0" />
                  <span>
                    Detected: <span className="font-medium">@{detectedUsername}</span>
                    {" · "}
                    <span className="font-medium capitalize">{detectedType}</span>
                    {!manualAccountEnabled && (
                      <span className="text-muted-foreground ml-1">
                        (account will be created if it doesn&apos;t exist)
                      </span>
                    )}
                  </span>
                </div>
              )}

              {selectedInstagramFile && !filenameError && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span data-testid="text-selected-instagram-filename">{selectedInstagramFile.name}</span>
                </div>
              )}
            </div>

            {/* Manual import type (revealed by checkbox) */}
            {manualTypeEnabled && (
              <div className="flex items-center justify-between rounded-md border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="import-type-toggle" className="text-base font-medium">
                    Import Type
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {instagramImportType === "followers" ? "Import accounts that follow you" : "Import accounts you follow"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={instagramImportType === "followers" ? "text-foreground font-medium" : "text-muted-foreground"}>
                    Followers
                  </span>
                  <Switch
                    id="import-type-toggle"
                    checked={instagramImportType === "following"}
                    onCheckedChange={(checked) => setInstagramImportType(checked ? "following" : "followers")}
                    data-testid="switch-import-type"
                  />
                  <span className={instagramImportType === "following" ? "text-foreground font-medium" : "text-muted-foreground"}>
                    Following
                  </span>
                </div>
              </div>
            )}

            {/* Manual account picker (revealed by checkbox) */}
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
                  Overrides the account detected from the filename
                </p>
              </div>
            )}

            {/* Force update images */}
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

            {/* CSV format notes */}
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

            {/* Manual override checkboxes */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manual Overrides</p>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="manual-type"
                  checked={manualTypeEnabled}
                  onCheckedChange={(checked) => {
                    const enabled = checked === true;
                    setManualTypeEnabled(enabled);
                    if (!enabled && detectedType) setInstagramImportType(detectedType);
                  }}
                  data-testid="checkbox-manual-type"
                />
                <Label htmlFor="manual-type" className="cursor-pointer text-sm">
                  Manually select followers / following
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

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleInstagramImport}
                disabled={!canSubmit}
                data-testid="button-import-instagram"
                className="gap-2"
              >
                {isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    {isPolling ? "Processing..." : "Uploading..."}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {effectiveImportType === "followers" ? "Followers" : "Following"}
                  </>
                )}
              </Button>

              {selectedInstagramFile && !isPending && (
                <Button
                  variant="outline"
                  onClick={clearFile}
                  data-testid="button-clear-instagram-file"
                >
                  Clear
                </Button>
              )}
            </div>

            {isPolling && (
              <div className="rounded-md bg-muted p-4">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="h-4 w-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span>Import is running in the background. This may take a few minutes for large files.</span>
                </div>
              </div>
            )}
          </div>

          {taskResult && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-instagram-import-success">
                    Instagram Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported {taskResult.imported} account{taskResult.imported !== 1 ? "s" : ""}
                    {taskResult.updated > 0 && (
                      <span className="ml-1">({taskResult.updated} updated)</span>
                    )}
                    {taskResult.skippedRows > 0 && (
                      <span className="ml-1">({taskResult.skippedRows} rows skipped)</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
