import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount } from "@shared/schema";

export default function ImportSocialMediaPage() {
  const [selectedInstagramFile, setSelectedInstagramFile] = useState<File | null>(null);
  const [instagramImportType, setInstagramImportType] = useState<"followers" | "following">("followers");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const importInstagramMutation = useMutation({
    mutationFn: async ({ file, accountId, importType }: { file: File; accountId: string; importType: "followers" | "following" }) => {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("accountId", accountId);
      formData.append("importType", importType);

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
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });

      toast({
        title: "Instagram Import Successful",
        description: `Successfully imported ${data.imported} accounts${data.updated > 0 ? ` (${data.updated} updated)` : ""}`,
      });

      setSelectedInstagramFile(null);
      setSelectedAccountId("");

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
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger data-testid="select-instagram-account">
                  <SelectValue placeholder="Select a social account" />
                </SelectTrigger>
                <SelectContent>
                  {socialAccounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.username}
                      {account.nickname && <span className="text-muted-foreground ml-1">({account.nickname})</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
