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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Upload, FileText, AlertCircle, CheckCircle2, Download, MessageSquare, Instagram, Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { SocialAccount, Person } from "@shared/schema";

export default function AppOptionsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);
  const [selectedSmsFile, setSelectedSmsFile] = useState<File | null>(null);
  const [selectedInstagramFile, setSelectedInstagramFile] = useState<File | null>(null);
  const [instagramImportType, setInstagramImportType] = useState<"followers" | "following">("followers");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [smsImportUserId, setSmsImportUserId] = useState<string>("");
  const [importUserOpen, setImportUserOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: socialAccounts } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const selectedImportUser = allPeople.find((p) => p.id === smsImportUserId);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("csv", file);

      const response = await fetch("/api/import-csv", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import CSV");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      
      toast({
        title: "Import Successful",
        description: `Successfully imported ${data.imported} contacts${data.errors > 0 ? ` with ${data.errors} errors` : ""}`,
      });

      setSelectedFile(null);
      
      // Reset file input
      const fileInput = document.getElementById("csv-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
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
      if (!file.name.endsWith(".csv")) {
        toast({
          title: "Invalid File",
          description: "Please select a CSV file",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  const importXmlMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("xml", file);

      const response = await fetch("/api/import-xml", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import XML");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      
      const imported = data.imported;
      const skipped = data.skipped || { people: 0, relationshipTypes: 0, interactionTypes: 0 };
      
      const importSummary = [
        `${imported.people} people${skipped.people > 0 ? ` (${skipped.people} duplicates skipped)` : ''}`,
        `${imported.relationships} relationships`,
        `${imported.relationshipTypes} relationship types${skipped.relationshipTypes > 0 ? ` (${skipped.relationshipTypes} duplicates skipped)` : ''}`,
        `${imported.interactions} interactions`,
        `${imported.interactionTypes} interaction types${skipped.interactionTypes > 0 ? ` (${skipped.interactionTypes} duplicates skipped)` : ''}`,
        `${imported.groups} groups`,
        `${imported.notes} notes`,
      ].join(', ');
      
      toast({
        title: "Import Successful",
        description: `Successfully imported: ${importSummary}`,
      });

      setSelectedXmlFile(null);
      
      // Reset file input
      const fileInput = document.getElementById("xml-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleXmlFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      setSelectedXmlFile(file);
    }
  };

  const handleXmlImport = () => {
    if (selectedXmlFile) {
      importXmlMutation.mutate(selectedXmlFile);
    }
  };

  const importSmsMutation = useMutation({
    mutationFn: async ({ file, importUserId }: { file: File; importUserId?: string }) => {
      const formData = new FormData();
      formData.append("xml", file);
      if (importUserId) {
        formData.append("importUserId", importUserId);
      }

      const response = await fetch("/api/import-sms", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to import SMS");
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      
      toast({
        title: "SMS Import Successful",
        description: `Successfully imported ${data.imported} messages${data.skipped > 0 ? ` (${data.skipped} duplicates skipped)` : ""}`,
      });

      setSelectedSmsFile(null);
      setSmsImportUserId("");
      
      const fileInput = document.getElementById("sms-file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }
    },
    onError: (error: Error) => {
      toast({
        title: "SMS Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSmsFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      setSelectedSmsFile(file);
    }
  };

  const handleSmsImport = () => {
    if (selectedSmsFile) {
      importSmsMutation.mutate({ file: selectedSmsFile, importUserId: smsImportUserId || undefined });
    }
  };

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

  const handleExportXml = async () => {
    try {
      const response = await fetch("/api/export-xml", {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Failed to export data");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `crm_export_${new Date().toISOString().split('T')[0]}.xml`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Successful",
        description: "Your data has been exported successfully",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export data",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <Card>
        <CardHeader>
          <CardTitle>Import Contacts</CardTitle>
          <CardDescription>Import people from a CSV file (Google Contacts format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv-file-input">Select CSV File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="csv-file-input"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  disabled={importMutation.isPending}
                  data-testid="input-csv-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-filename">{selectedFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">CSV Format Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>First data row is always skipped (example/header row)</li>
                    <li>First Name and Last Name are required</li>
                    <li>First email and phone are used as primary contact info</li>
                    <li>Additional phones, emails, and other data are added to notes</li>
                    <li>Tags/Labels are automatically parsed</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleImport}
                disabled={!selectedFile || importMutation.isPending}
                data-testid="button-import-csv"
                className="gap-2"
              >
                {importMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import Contacts
                  </>
                )}
              </Button>
              
              {selectedFile && !importMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedFile(null);
                    const fileInput = document.getElementById("csv-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importMutation.isSuccess && importMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-import-success">
                    Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported {importMutation.data.imported} contact{importMutation.data.imported !== 1 ? "s" : ""}
                    {importMutation.data.errors > 0 && (
                      <span className="text-destructive ml-1">
                        ({importMutation.data.errors} error{importMutation.data.errors !== 1 ? "s" : ""})
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Import & Export Data</CardTitle>
          <CardDescription>Export all your CRM data or import a previously exported backup (XML format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Export Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Export All Data</Label>
              <p className="text-sm text-muted-foreground">
                Export all people, relationships, groups, interactions, and notes to an XML file (images excluded)
              </p>
            </div>
            <Button
              onClick={handleExportXml}
              data-testid="button-export-xml"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export to XML
            </Button>
          </div>

          <div className="border-t pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="xml-file-input">Import from XML</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="xml-file-input"
                  type="file"
                  accept=".xml"
                  onChange={handleXmlFileChange}
                  disabled={importXmlMutation.isPending}
                  data-testid="input-xml-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedXmlFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-xml-filename">{selectedXmlFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">Import Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Only import files exported from this CRM application</li>
                    <li>Images are not included in imports</li>
                    <li>Importing will add data to your existing database</li>
                    <li>Duplicate IDs will be skipped</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleXmlImport}
                disabled={!selectedXmlFile || importXmlMutation.isPending}
                data-testid="button-import-xml"
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
                    Import from XML
                  </>
                )}
              </Button>
              
              {selectedXmlFile && !importXmlMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedXmlFile(null);
                    const fileInput = document.getElementById("xml-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-xml-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importXmlMutation.isSuccess && importXmlMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-xml-import-success">
                    Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported: {importXmlMutation.data.imported.people} people, 
                    {" "}{importXmlMutation.data.imported.groups} groups,
                    {" "}{importXmlMutation.data.imported.relationships} relationships,
                    {" "}{importXmlMutation.data.imported.interactions} interactions,
                    {" "}{importXmlMutation.data.imported.notes} notes
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Import SMS Messages
          </CardTitle>
          <CardDescription>Import SMS and MMS messages from an XML backup file (SMS Backup & Restore format)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Import User (Device Owner)</Label>
              <p className="text-sm text-muted-foreground">
                Select the person whose phone this backup is from. Their phone number will be used for messages marked as "device_owner".
              </p>
              <Popover open={importUserOpen} onOpenChange={setImportUserOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={importUserOpen}
                    className={cn(
                      "w-full justify-between",
                      !smsImportUserId && "text-muted-foreground"
                    )}
                    data-testid="select-import-user"
                  >
                    {selectedImportUser ? (
                      <span className="truncate">
                        {selectedImportUser.firstName} {selectedImportUser.lastName}
                        {selectedImportUser.phone && (
                          <span className="text-muted-foreground ml-2">
                            ({selectedImportUser.phone})
                          </span>
                        )}
                      </span>
                    ) : (
                      "Select import user..."
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search people..." />
                    <CommandList>
                      <CommandEmpty>No person found.</CommandEmpty>
                      <CommandGroup>
                        {allPeople.map((person) => (
                          <CommandItem
                            key={person.id}
                            value={`${person.firstName} ${person.lastName} ${person.phone || ""}`}
                            onSelect={() => {
                              setSmsImportUserId(person.id);
                              setImportUserOpen(false);
                            }}
                            data-testid={`option-import-user-${person.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                person.id === smsImportUserId ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="truncate">
                              {person.firstName} {person.lastName}
                              {person.phone && (
                                <span className="text-muted-foreground ml-2 text-xs">
                                  {person.phone}
                                </span>
                              )}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedImportUser && !selectedImportUser.phone && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  <span>Warning: This person has no phone number set. Messages may not be properly attributed.</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sms-file-input">Select SMS Backup XML File</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="sms-file-input"
                  type="file"
                  accept=".xml"
                  onChange={handleSmsFileChange}
                  disabled={importSmsMutation.isPending}
                  data-testid="input-sms-file"
                  className="cursor-pointer"
                />
              </div>
              {selectedSmsFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span data-testid="text-selected-sms-filename">{selectedSmsFile.name}</span>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium">SMS Import Notes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Supports XML files from "SMS Backup & Restore" app</li>
                    <li>Both SMS and MMS messages are imported</li>
                    <li>Messages are stored as "phone" type in the system</li>
                    <li>Phone numbers are used as sender/receiver identifiers</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleSmsImport}
                disabled={!selectedSmsFile || importSmsMutation.isPending}
                data-testid="button-import-sms"
                className="gap-2"
              >
                {importSmsMutation.isPending ? (
                  <>
                    <div className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Import SMS Messages
                  </>
                )}
              </Button>
              
              {selectedSmsFile && !importSmsMutation.isPending && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedSmsFile(null);
                    const fileInput = document.getElementById("sms-file-input") as HTMLInputElement;
                    if (fileInput) {
                      fileInput.value = "";
                    }
                  }}
                  data-testid="button-clear-sms-file"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importSmsMutation.isSuccess && importSmsMutation.data && (
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium" data-testid="text-sms-import-success">
                    SMS Import Complete
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Imported {importSmsMutation.data.imported} message{importSmsMutation.data.imported !== 1 ? "s" : ""}
                    {importSmsMutation.data.skipped > 0 && (
                      <span className="ml-1">
                        ({importSmsMutation.data.skipped} duplicate{importSmsMutation.data.skipped !== 1 ? "s" : ""} skipped)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5" />
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
