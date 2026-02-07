import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Upload, FileText, AlertCircle, CheckCircle2, MessageSquare, Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Person } from "@shared/schema";

export default function ImportMessagesPage() {
  const [selectedSmsFile, setSelectedSmsFile] = useState<File | null>(null);
  const [smsImportUserId, setSmsImportUserId] = useState<string>("");
  const [importUserOpen, setImportUserOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const selectedImportUser = allPeople.find((p) => p.id === smsImportUserId);

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

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0">
      <Card>
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
                    <CommandInput placeholder="Search people..." data-testid="input-search-import-user" />
                    <CommandList>
                      <CommandEmpty>No person found.</CommandEmpty>
                      <CommandGroup>
                        {allPeople.map((person) => (
                          <CommandItem
                            key={person.id}
                            value={`${person.firstName} ${person.lastName} ${person.phone || ""}`}
                            onSelect={() => {
                              setSmsImportUserId(person.id === smsImportUserId ? "" : person.id);
                              setImportUserOpen(false);
                            }}
                            data-testid={`option-import-user-${person.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                smsImportUserId === person.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="truncate">
                              {person.firstName} {person.lastName}
                              {person.phone && (
                                <span className="text-muted-foreground ml-2">
                                  ({person.phone})
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
    </div>
  );
}
