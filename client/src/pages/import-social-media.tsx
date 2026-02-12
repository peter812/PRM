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
import { Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount } from "@shared/schema";

export default function ImportSocialMediaPage() {
  const [selectedInstagramFile, setSelectedInstagramFile] = useState<File | null>(null);
  const [instagramImportType, setInstagramImportType] = useState<"followers" | "following">("followers");
  const [forceUpdateImages, setForceUpdateImages] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedAccountLabel, setSelectedAccountLabel] = useState<string>("");
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SocialAccount[]>([]);
  const [isSearching, setIsSearching] = useState(false);
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

  const importInstagramMutation = useMutation({
    mutationFn: async ({ file, accountId, importType, forceImages }: { file: File; accountId: string; importType: "followers" | "following"; forceImages: boolean }) => {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("accountId", accountId);
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
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });

      toast({
        title: "Instagram Import Successful",
        description: `Successfully imported ${data.imported} accounts${data.updated > 0 ? ` (${data.updated} updated)` : ""}${data.skippedRows > 0 ? ` (${data.skippedRows} rows skipped due to formatting issues)` : ""}`,
      });

      setSelectedInstagramFile(null);
      setSelectedAccountId("");
      setSelectedAccountLabel("");

      const fileInput = document.getElementById("instagram-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Instagram Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleInstagramFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".csv")) {
        toast({
          title: "Invalid File",
          description: "Please select a CSV file",
          variant: "destructive",
        });
        return;
      }
      setSelectedInstagramFile(file);
    }
  };

  const handleInstagramImport = () => {
    if (selectedInstagramFile && selectedAccountId) {
      importInstagramMutation.mutate({
        file: selectedInstagramFile,
        accountId: selectedAccountId,
        importType: instagramImportType,
        forceImages: forceUpdateImages,
      });
    }
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

            <div className="space-y-2">
              <Label>Select Your Account</Label>
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
                Select the account that the import data belongs to (your account)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="instagram-file-input">Select CSV File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="instagram-file-input"
                  type="file"
                  accept=".csv"
                  onChange={handleInstagramFileChange}
                  disabled={importInstagramMutation.isPending}
                  data-testid="input-instagram-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedInstagramFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-instagram-filename">{selectedInstagramFile.name}</span>
                </div>
              )}
            </div>

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

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">CSV Format Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Expected CSV format: "followed_by_viewer";"full_name";"id";"is_verified";"profile_pic_url";"requested_by_viewer";"username"</li>
                    <li>New accounts will be created if username doesn't exist</li>
                    <li>Existing accounts will be updated with nickname and profile picture</li>
                    <li>Follower/following relationships will be updated for your selected account</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleInstagramImport}
                disabled={!selectedInstagramFile || !selectedAccountId || importInstagramMutation.isPending}
                data-testid="button-import-instagram"
                className="gap-2"
              >
                {importInstagramMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import {instagramImportType === "followers" ? "Followers" : "Following"}
                  </>
                )}
              </Button>

              {selectedInstagramFile && !importInstagramMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedInstagramFile(null);
                    const fileInput = document.getElementById("instagram-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-instagram-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importInstagramMutation.isSuccess && importInstagramMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-instagram-import-success">
                    Instagram Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported {importInstagramMutation.data.imported} account{importInstagramMutation.data.imported !== 1 ? "s" : ""}
                    {importInstagramMutation.data.updated > 0 && (
                      <span className="ml-1">
                        ({importInstagramMutation.data.updated} updated)
                      </span>
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
