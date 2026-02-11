import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertSocialAccountSchema, type InsertSocialAccount, type SocialAccountType } from "@shared/schema";
import { ImageUpload } from "./image-upload";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";

function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^#[0-9A-Fa-f]{3}$/.test(color);
}

interface AddSocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const URL_TYPE_MAPPINGS: { pattern: RegExp; typeName: string }[] = [
  { pattern: /instagram\.com/i, typeName: "Instagram" },
  { pattern: /facebook\.com/i, typeName: "Facebook" },
  { pattern: /x\.com/i, typeName: "X.com" },
  { pattern: /twitter\.com/i, typeName: "X.com" },
];

export function AddSocialAccountDialog({ open, onOpenChange }: AddSocialAccountDialogProps) {
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [isTypeAutoSelected, setIsTypeAutoSelected] = useState(false);
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const form = useForm<InsertSocialAccount>({
    resolver: zodResolver(insertSocialAccountSchema),
    defaultValues: {
      username: "",
      nickname: "",
      accountUrl: "",
      ownerUuid: null,
      imageUrl: null,
      following: [],
      followers: [],
      typeId: null,
    },
  });

  const accountUrl = form.watch("accountUrl");

  useEffect(() => {
    if (!socialAccountTypes) return;

    const url = accountUrl?.trim().toLowerCase() || "";
    
    if (!url) {
      if (isTypeAutoSelected) {
        setSelectedTypeId("");
        setIsTypeAutoSelected(false);
      }
      return;
    }

    for (const mapping of URL_TYPE_MAPPINGS) {
      if (mapping.pattern.test(url)) {
        const matchedType = socialAccountTypes.find(
          (t) => t.name.toLowerCase() === mapping.typeName.toLowerCase()
        );
        if (matchedType) {
          setSelectedTypeId(matchedType.id);
          setIsTypeAutoSelected(true);
          return;
        }
      }
    }

    if (isTypeAutoSelected) {
      setSelectedTypeId("");
      setIsTypeAutoSelected(false);
    }
  }, [accountUrl, socialAccountTypes, isTypeAutoSelected]);

  const handleTypeChange = (value: string) => {
    setSelectedTypeId(value);
    setIsTypeAutoSelected(false);
  };

  const createMutation = useMutation({
    mutationFn: async (data: InsertSocialAccount) => {
      return await apiRequest("POST", "/api/social-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });
      toast({
        title: "Success",
        description: "Social account added successfully",
      });
      form.reset();
      setImageUrl(null);
      setSelectedTypeId("");
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add social account",
        variant: "destructive",
      });
    },
  });

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
        throw new Error(error.error || "Failed to import XML");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });
      const parts: string[] = [];
      if (data.imported?.socialAccounts > 0) parts.push(`${data.imported.socialAccounts} accounts imported`);
      if (data.imported?.socialAccountTypes > 0) parts.push(`${data.imported.socialAccountTypes} types imported`);
      if (data.skipped?.socialAccounts > 0) parts.push(`${data.skipped.socialAccounts} accounts skipped (already exist)`);
      if (data.skipped?.socialAccountTypes > 0) parts.push(`${data.skipped.socialAccountTypes} types skipped`);
      if (data.failed?.socialAccounts > 0) parts.push(`${data.failed.socialAccounts} accounts failed`);
      if (data.failed?.socialAccountTypes > 0) parts.push(`${data.failed.socialAccountTypes} types failed`);
      toast({
        title: "XML Import Complete",
        description: parts.join(", ") || "Import finished",
      });
      setSelectedXmlFile(null);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertSocialAccount) => {
    createMutation.mutate({
      ...data,
      imageUrl: imageUrl || null,
      typeId: selectedTypeId && selectedTypeId !== "none" ? selectedTypeId : null,
    });
  };

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-add-account">
        <DialogHeader>
          <DialogTitle>Add Social Account</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="create">
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1" data-testid="tab-create">
              Create
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1" data-testid="tab-import">
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-4">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g., @johndoe"
                              {...field}
                              data-testid="input-username"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="nickname"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nickname <span className="text-muted-foreground text-xs">(Optional)</span></FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Display name / Full name"
                              {...field}
                              value={field.value || ""}
                              data-testid="input-nickname"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="accountUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Account URL</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="https://instagram.com/johndoe"
                              {...field}
                              data-testid="input-account-url"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div>
                      <FormLabel>Account Type</FormLabel>
                      <Select value={selectedTypeId || "none"} onValueChange={handleTypeChange}>
                        <SelectTrigger data-testid="select-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Type</SelectItem>
                          {socialAccountTypes?.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              <span className="flex items-center gap-2">
                                {isValidHexColor(type.color) && (
                                  <span 
                                    className="w-2 h-2 rounded-full" 
                                    style={{ backgroundColor: type.color }}
                                  />
                                )}
                                {type.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    <FormLabel>Profile Picture</FormLabel>
                    <ImageUpload
                      currentImageUrl={imageUrl}
                      onImageChange={setImageUrl}
                      aspectRatio={1}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-submit"
                  >
                    {createMutation.isPending ? "Adding..." : "Add Account"}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="import">
            <div className="space-y-4">
              <div className="space-y-2">
                <FormLabel>Select XML File</FormLabel>
                <div className="flex items-center gap-3">
                  <Input
                    id="xml-import-file-input"
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
                      <li>Use XML files exported from this application</li>
                      <li>Imports social accounts and account types</li>
                      <li>Existing accounts with the same ID will be skipped</li>
                      <li>Follower/following relationships are preserved</li>
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
                      Import XML
                    </>
                  )}
                </Button>

                {selectedXmlFile && !importXmlMutation.isPending && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedXmlFile(null);
                      const fileInput = document.getElementById("xml-import-file-input") as HTMLInputElement;
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

              {importXmlMutation.isSuccess && importXmlMutation.data && (
                <div className="rounded-md bg-primary/10 border border-primary/20 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium" data-testid="text-xml-import-success">
                        Import Complete
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {importXmlMutation.data.imported?.socialAccounts > 0 && (
                          <span>{importXmlMutation.data.imported.socialAccounts} accounts imported. </span>
                        )}
                        {importXmlMutation.data.skipped?.socialAccounts > 0 && (
                          <span>{importXmlMutation.data.skipped.socialAccounts} skipped. </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
