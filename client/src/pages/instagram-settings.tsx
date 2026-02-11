import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Download, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount, SocialAccountType } from "@shared/schema";

export default function InstagramSettingsPage() {
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const instagramType = socialAccountTypes?.find(
    (t) => t.name.toLowerCase() === "instagram"
  );

  const instagramAccounts = socialAccounts?.filter(
    (a) => a.typeId === instagramType?.id
  ) || [];

  const allAccounts = socialAccounts || [];

  const importXmlMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("xml", file);

      const response = await fetch("/api/social-accounts/import-xml", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import social accounts");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/social-account-types"] });

      const imported = data.imported;
      const skipped = data.skipped;

      const failed = data.failed || { socialAccounts: 0, socialAccountTypes: 0 };

      toast({
        title: "Import Successful",
        description: `Imported ${imported.socialAccounts} accounts and ${imported.socialAccountTypes} types${skipped.socialAccounts > 0 ? ` (${skipped.socialAccounts} accounts skipped)` : ""}${skipped.socialAccountTypes > 0 ? ` (${skipped.socialAccountTypes} types skipped)` : ""}${failed.socialAccounts > 0 ? ` (${failed.socialAccounts} accounts failed)` : ""}`,
      });

      setSelectedImportFile(null);
      const fileInput = document.getElementById("import-xml-file") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xml")) {
        toast({
          title: "Invalid File",
          description: "Please select an XML file",
          variant: "destructive",
        });
        return;
      }
      setSelectedImportFile(file);
    }
  };

  const handleImport = () => {
    if (selectedImportFile) {
      importXmlMutation.mutate(selectedImportFile);
    }
  };

  const handleExportAll = async () => {
    if (allAccounts.length === 0) {
      toast({
        title: "No Accounts",
        description: "There are no social accounts to export",
        variant: "destructive",
      });
      return;
    }

    setIsExportingAll(true);
    try {
      const ids = allAccounts.map((a) => a.id).join(",");
      const response = await fetch(
        `/api/social-accounts/export-xml?ids=${encodeURIComponent(ids)}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to export accounts");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "social_accounts_export.xml";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: `Exported ${allAccounts.length} social accounts to XML`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export social accounts",
        variant: "destructive",
      });
    } finally {
      setIsExportingAll(false);
    }
  };

  const handleExportInstagram = async () => {
    if (instagramAccounts.length === 0) {
      toast({
        title: "No Instagram Accounts",
        description: "There are no Instagram accounts to export",
        variant: "destructive",
      });
      return;
    }

    setIsExportingAll(true);
    try {
      const ids = instagramAccounts.map((a) => a.id).join(",");
      const response = await fetch(
        `/api/social-accounts/export-xml?ids=${encodeURIComponent(ids)}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to export Instagram accounts");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "instagram_accounts_export.xml";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: `Exported ${instagramAccounts.length} Instagram accounts to XML`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export Instagram accounts",
        variant: "destructive",
      });
    } finally {
      setIsExportingAll(false);
    }
  };

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-instagram-settings-title">
          <SiInstagram className="h-6 w-6" />
          Instagram Settings
        </h1>
        <p className="text-muted-foreground">
          Mass import and export social accounts via XML files.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Social Accounts
            </CardTitle>
            <CardDescription>
              Export all social accounts or only Instagram accounts to an XML file for backup or transfer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span data-testid="text-total-accounts">
                Total accounts: {allAccounts.length}
              </span>
              <span data-testid="text-instagram-accounts">
                Instagram accounts: {instagramAccounts.length}
              </span>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button
                onClick={handleExportAll}
                disabled={isExportingAll || allAccounts.length === 0}
                data-testid="button-export-all-accounts"
                className="gap-2"
              >
                {isExportingAll ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Export All Accounts ({allAccounts.length})
                  </>
                )}
              </Button>
              {instagramType && (
                <Button
                  variant="outline"
                  onClick={handleExportInstagram}
                  disabled={isExportingAll || instagramAccounts.length === 0}
                  data-testid="button-export-instagram-accounts"
                  className="gap-2"
                >
                  <SiInstagram className="h-4 w-4" />
                  Export Instagram Only ({instagramAccounts.length})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Social Accounts
            </CardTitle>
            <CardDescription>
              Import social accounts from an XML file. Accounts with existing IDs will be skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-xml-file">Select XML File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="import-xml-file"
                  type="file"
                  accept=".xml"
                  onChange={handleFileChange}
                  disabled={importXmlMutation.isPending}
                  data-testid="input-import-xml-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedImportFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-import-filename">{selectedImportFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">Import Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>XML files must match the export format</li>
                    <li>Accounts with duplicate IDs will be skipped</li>
                    <li>Social account types will also be imported if included</li>
                    <li>Follower and following relationships are preserved</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleImport}
                disabled={!selectedImportFile || importXmlMutation.isPending}
                data-testid="button-import-accounts"
                className="gap-2"
              >
                {importXmlMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import Accounts
                  </>
                )}
              </Button>

              {selectedImportFile && !importXmlMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedImportFile(null);
                    const fileInput = document.getElementById("import-xml-file") as HTMLInputElement;
                    if (fileInput) fileInput.value = "";
                  }}
                  data-testid="button-clear-import-file"
                >
                  Clear
                </Button>
              )}
            </div>

            {importXmlMutation.isSuccess && importXmlMutation.data && (
              <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium" data-testid="text-import-success">
                      Import Complete
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Imported {importXmlMutation.data.imported.socialAccounts} accounts
                      and {importXmlMutation.data.imported.socialAccountTypes} account types
                      {importXmlMutation.data.skipped.socialAccounts > 0 && (
                        <span className="ml-1">
                          ({importXmlMutation.data.skipped.socialAccounts} accounts skipped)
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
    </div>
  );
}
