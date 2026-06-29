import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Download, FileText, AlertCircle, CheckCircle2, Search, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { SiInstagram } from "react-icons/si";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { SocialAccount, SocialAccountType } from "@shared/schema";

interface ParsedAccount {
  id?: string;
  username: string;
  nickname: string;
  followersCount: number;
  followingCount: number;
  typeId: string;
  imageUrl: string;
  isInstagram: boolean;
  status: "new" | "exists" | "invalid";
}

interface SocialAccountWithProfile extends SocialAccount {
  currentProfile?: {
    nickname?: string;
    imageUrl?: string;
    accountUrl?: string;
  };
}

export default function InstagramXmlTransferPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Export State
  const [exportSearch, setExportSearch] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Record<string, boolean>>({});
  const [isExporting, setIsExporting] = useState(false);

  // Import State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [xmlContent, setXmlContent] = useState<string | null>(null);
  const [parsedAccounts, setParsedAccounts] = useState<ParsedAccount[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  // Fetch data
  const { data: socialAccounts, isLoading: accountsLoading } = useQuery<SocialAccountWithProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  // Find Instagram Type
  const instagramType = useMemo(() => {
    return socialAccountTypes?.find(
      (t) => t.name.toLowerCase() === "instagram"
    );
  }, [socialAccountTypes]);

  // Filter Instagram Accounts
  const instagramAccounts = useMemo(() => {
    if (!socialAccounts || !instagramType) return [];
    return socialAccounts.filter((a) => a.typeId === instagramType.id);
  }, [socialAccounts, instagramType]);

  // Filtered accounts for display/selection
  const filteredAccounts = useMemo(() => {
    return instagramAccounts.filter((a) => {
      const searchLower = exportSearch.toLowerCase();
      const usernameMatch = a.username.toLowerCase().includes(searchLower);
      const nicknameMatch = a.currentProfile?.nickname?.toLowerCase().includes(searchLower);
      return usernameMatch || nicknameMatch;
    });
  }, [instagramAccounts, exportSearch]);

  // Checkbox handlers
  const handleSelectAllChange = (checked: boolean) => {
    const updated: Record<string, boolean> = {};
    if (checked) {
      filteredAccounts.forEach((a) => {
        updated[a.id] = true;
      });
    }
    setSelectedAccountIds(updated);
  };

  const handleSelectChange = (id: string, checked: boolean) => {
    setSelectedAccountIds((prev) => ({
      ...prev,
      [id]: checked,
    }));
  };

  const selectedCount = useMemo(() => {
    return Object.values(selectedAccountIds).filter(Boolean).length;
  }, [selectedAccountIds]);

  const isAllSelected = useMemo(() => {
    if (filteredAccounts.length === 0) return false;
    return filteredAccounts.every((a) => selectedAccountIds[a.id]);
  }, [filteredAccounts, selectedAccountIds]);

  // XML Import Mutation
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
        description: `Imported ${imported.socialAccounts} Instagram accounts${skipped.socialAccounts > 0 ? ` (${skipped.socialAccounts} accounts skipped)` : ""}${failed.socialAccounts > 0 ? ` (${failed.socialAccounts} failed)` : ""}`,
      });

      // Clear import state
      setSelectedFile(null);
      setXmlContent(null);
      setParsedAccounts([]);
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

  // Client-side XML parser for previewing the file
  const parseXmlFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        setXmlContent(text);

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
          throw new Error("The selected file is not a valid XML file or is malformed.");
        }

        const typeBlocks = xmlDoc.getElementsByTagName("social_account_type");
        let xmlInstagramTypeId = "";
        for (let i = 0; i < typeBlocks.length; i++) {
          const typeBlock = typeBlocks[i];
          const name = typeBlock.querySelector("name")?.textContent || "";
          if (name.toLowerCase() === "instagram") {
            xmlInstagramTypeId = typeBlock.querySelector("id")?.textContent || "";
            break;
          }
        }

        const accountBlocks = xmlDoc.getElementsByTagName("social_account");
        const parsed: ParsedAccount[] = [];

        if (accountBlocks.length === 0) {
          throw new Error("No social account records found in the XML file.");
        }

        for (let i = 0; i < accountBlocks.length; i++) {
          const block = accountBlocks[i];
          const id = block.querySelector("id")?.textContent || undefined;
          const username = block.querySelector("username")?.textContent || "";
          const nickname = block.querySelector("nickname")?.textContent || "";
          const typeId = block.querySelector("type_id")?.textContent || "";
          const imageUrl = block.querySelector("image_url")?.textContent || "";

          const followersNode = block.querySelector("followers");
          const followingNode = block.querySelector("following");
          const followersCount = followersNode ? followersNode.getElementsByTagName("account_id").length : 0;
          const followingCount = followingNode ? followingNode.getElementsByTagName("account_id").length : 0;

          const isInstagram =
            typeId === xmlInstagramTypeId ||
            typeId.toLowerCase() === "instagram" ||
            username.toLowerCase() === "instagram" ||
            !typeId; // default to true if typeless for this instagram-centric import

          // Determine status
          let status: "new" | "exists" | "invalid" = "new";
          if (instagramAccounts.some((a) => a.id === id || (a.username.toLowerCase() === username.toLowerCase()))) {
            status = "exists";
          }

          parsed.push({
            id,
            username,
            nickname,
            followersCount,
            followingCount,
            typeId,
            imageUrl,
            isInstagram,
            status,
          });
        }

        setParsedAccounts(parsed);
        setParseError(null);
      } catch (err: any) {
        setParseError(err.message || "Failed to parse XML file.");
        setParsedAccounts([]);
      }
    };
    reader.onerror = () => {
      setParseError("Error reading the XML file.");
      setParsedAccounts([]);
    };
    reader.readAsText(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xml")) {
        toast({
          title: "Invalid File Type",
          description: "Please select an XML file (.xml)",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
      parseXmlFile(file);
    }
  };

  const handleImportSubmit = () => {
    if (selectedFile) {
      importXmlMutation.mutate(selectedFile);
    }
  };

  const handleExportSubmit = async () => {
    const idsToExport = Object.keys(selectedAccountIds).filter(
      (id) => selectedAccountIds[id]
    );

    if (idsToExport.length === 0) {
      toast({
        title: "No Selection",
        description: "Please select at least one Instagram account to export",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/social-accounts/export-xml?ids=${encodeURIComponent(
          idsToExport.join(",")
        )}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to export Instagram accounts");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `instagram_transfer_${idsToExport.length}_accounts.xml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: `Exported ${idsToExport.length} Instagram accounts to XML`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export selected Instagram accounts",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const nonInstagramCount = useMemo(() => {
    return parsedAccounts.filter((a) => !a.isInstagram).length;
  }, [parsedAccounts]);

  const clearImport = () => {
    setSelectedFile(null);
    setXmlContent(null);
    setParsedAccounts([]);
    setParseError(null);
    const fileInput = document.getElementById("import-xml-file") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
  };

  return (
    <div className="container max-w-full md:max-w-6xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <div className="flex flex-col gap-2 mb-6">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 rounded-lg text-white">
            <SiInstagram className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-instagram-transfer-title">
              Instagram XML Transfer
            </h1>
            <p className="text-sm text-muted-foreground">
              Internal data transfer for Instagram accounts via XML.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* EXPORT COLUMN */}
        <Card className="lg:col-span-5 hover:shadow-smooth transition-all duration-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-primary" />
              Export Accounts
            </CardTitle>
            <CardDescription>
              Select Instagram accounts to package into an XML transfer file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search usernames or nicknames..."
                  className="pl-9"
                  value={exportSearch}
                  onChange={(e) => setExportSearch(e.target.value)}
                />
              </div>
            </div>

            {accountsLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm">Loading Instagram profiles...</span>
              </div>
            ) : instagramAccounts.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-lg bg-muted/40">
                <p className="text-sm text-muted-foreground">No Instagram accounts found in the database.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all-accounts"
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAllChange}
                    />
                    <Label htmlFor="select-all-accounts" className="cursor-pointer font-medium">
                      Select All ({filteredAccounts.length})
                    </Label>
                  </div>
                  <span>{selectedCount} selected</span>
                </div>

                <ScrollArea className="h-[280px] border rounded-lg bg-card/50">
                  <Table>
                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                      <TableRow>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead>Account</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAccounts.map((account) => (
                        <TableRow key={account.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="py-2">
                            <Checkbox
                              checked={!!selectedAccountIds[account.id]}
                              onCheckedChange={(checked) =>
                                handleSelectChange(account.id, !!checked)
                              }
                            />
                          </TableCell>
                          <TableCell className="py-2 font-medium">
                            <div className="flex flex-col">
                              <span className="text-sm">@{account.username}</span>
                              {account.currentProfile?.nickname && (
                                <span className="text-xs text-muted-foreground">
                                  {account.currentProfile.nickname}
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}

            <Button
              className="w-full gap-2 mt-2 bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600 text-white"
              disabled={selectedCount === 0 || isExporting}
              onClick={handleExportSubmit}
            >
              {isExporting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Generating XML...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export Selected ({selectedCount})
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* IMPORT COLUMN */}
        <Card className="lg:col-span-7 hover-shadow-smooth transition-all duration-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Upload className="h-5 w-5 text-primary" />
              Import XML File
            </CardTitle>
            <CardDescription>
              Load an XML transfer file to preview and import Instagram records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-xml-file">Select Transfer File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="import-xml-file"
                  type="file"
                  accept=".xml"
                  onChange={handleFileChange}
                  disabled={importXmlMutation.isPending}
                  className="cursor-pointer"
                />
              </div>
            </div>

            {parseError && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-destructive/20 bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            {parsedAccounts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">File Preview ({parsedAccounts.length} accounts found)</h3>
                  {nonInstagramCount > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {nonInstagramCount} Non-Instagram
                    </Badge>
                  )}
                </div>

                {nonInstagramCount > 0 && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      This XML file contains accounts not flagged as Instagram. They will still be imported, but they may not display under Instagram filters.
                    </span>
                  </div>
                )}

                <ScrollArea className="h-[230px] border rounded-lg bg-card/50">
                  <Table>
                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                      <TableRow>
                        <TableHead>Username</TableHead>
                        <TableHead>Nickname</TableHead>
                        <TableHead className="text-center">Network</TableHead>
                        <TableHead className="text-right">Action Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedAccounts.map((account, idx) => (
                        <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="py-2 font-medium">@{account.username}</TableCell>
                          <TableCell className="py-2 text-muted-foreground">{account.nickname || "—"}</TableCell>
                          <TableCell className="py-2 text-center text-xs">
                            <span className="text-muted-foreground">
                              {account.followersCount} / {account.followingCount}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            {account.status === "exists" ? (
                              <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-none hover:bg-blue-500/10">
                                Skip (Exists)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-none hover:bg-green-500/10 gap-1">
                                <Check className="h-3 w-3" /> Create New
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                <div className="flex gap-3 justify-end pt-2">
                  <Button variant="outline" onClick={clearImport} disabled={importXmlMutation.isPending}>
                    Clear Preview
                  </Button>
                  <Button
                    onClick={handleImportSubmit}
                    disabled={importXmlMutation.isPending}
                    className="gap-2"
                  >
                    {importXmlMutation.isPending ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Confirm & Import Records
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {!selectedFile && !parseError && (
              <div className="border border-dashed rounded-lg py-12 flex flex-col items-center justify-center text-muted-foreground bg-muted/20">
                <FileText className="h-10 w-10 mb-3 text-muted-foreground/60" />
                <p className="text-sm font-medium">No XML file loaded</p>
                <p className="text-xs text-muted-foreground/80 mt-1">Select a transfer file above to view the preview before importing</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
