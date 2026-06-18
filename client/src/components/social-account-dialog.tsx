import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { URL_TYPE_MAPPINGS } from "@/lib/constants";
import { insertSocialAccountSchema, type SocialAccountType, type SocialAccount, type SocialAccountWithCurrentProfile } from "@shared/schema";
import { z } from "zod";
import { ImageUpload } from "./image-upload";
import { Upload, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";

const socialAccountFormSchema = insertSocialAccountSchema.extend({
  nickname: z.string().nullable().optional(),
  accountUrl: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  following: z.array(z.string()).optional(),
  followers: z.array(z.string()).optional(),
});
type FormValues = z.infer<typeof socialAccountFormSchema>;

interface SocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: SocialAccountWithCurrentProfile;
  onAccountCreated?: (account: SocialAccount) => void;
}

export function SocialAccountDialog({
  open,
  onOpenChange,
  account,
  onAccountCreated,
}: SocialAccountDialogProps) {
  const isEdit = !!account;
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [isTypeAutoSelected, setIsTypeAutoSelected] = useState(false);
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(socialAccountFormSchema),
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
    if (open) {
      if (isEdit && account) {
        setImageUrl(account.currentProfile?.imageUrl || null);
        setSelectedTypeId(account.typeId || "");
        form.reset({
          username: account.username,
          nickname: account.currentProfile?.nickname || "",
          accountUrl: account.currentProfile?.accountUrl || "",
          ownerUuid: account.ownerUuid || null,
          imageUrl: account.currentProfile?.imageUrl || null,
          typeId: account.typeId || null,
          following: [],
          followers: [],
        });
      } else {
        setImageUrl(null);
        setSelectedTypeId("");
        setSelectedXmlFile(null);
        form.reset({
          username: "",
          nickname: "",
          accountUrl: "",
          ownerUuid: null,
          imageUrl: null,
          following: [],
          followers: [],
          typeId: null,
        });
      }
      setIsTypeAutoSelected(false);
    }
  }, [open, account, isEdit, form]);

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

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      if (isEdit && account) {
        return await apiRequest("PATCH", `/api/social-accounts/${account.id}`, {
          username: data.username,
          nickname: data.nickname || null,
          accountUrl: data.accountUrl,
          imageUrl: imageUrl || null,
          typeId: selectedTypeId && selectedTypeId !== "none" ? selectedTypeId : null,
        });
      } else {
        const res = await apiRequest("POST", "/api/social-accounts", {
          ...data,
          imageUrl: imageUrl || null,
          typeId: selectedTypeId && selectedTypeId !== "none" ? selectedTypeId : null,
        });
        return res.json();
      }
    },
    onSuccess: (data) => {
      if (isEdit && account) {
        queryClient.invalidateQueries({ queryKey: ["/api/social-accounts", account.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts/paginated"], exact: false });

      toast({
        title: "Success",
        description: isEdit ? "Social account updated successfully" : "Social account added successfully",
      });
      onOpenChange(false);
      if (!isEdit && onAccountCreated) onAccountCreated(data);
    },
    onError: () => {
      toast({
        title: "Error",
        description: `Failed to ${isEdit ? "update" : "add"} social account`,
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

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const handleXmlFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".xml")) {
        toast({
          title: "Invalid file type",
          description: "Please select an XML file",
          variant: "destructive",
        });
        return;
      }
      setSelectedXmlFile(file);
    }
  };

  const handleImportXmlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedXmlFile) return;
    importXmlMutation.mutate(selectedXmlFile);
  };

  const formFields = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <FormLabel>Profile Photo</FormLabel>
          <div className="mt-2">
            <ImageUpload
              currentImageUrl={imageUrl}
              onImageChange={setImageUrl}
              aspectRatio={1}
            />
          </div>
        </div>

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
                  value={field.value || ""}
                  data-testid={isEdit ? "input-edit-account-url" : "input-account-url"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username *</FormLabel>
              <FormControl>
                <Input
                  placeholder="johndoe"
                  {...field}
                  data-testid={isEdit ? "input-edit-username" : "input-username"}
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
              <FormLabel>Display Name / Nickname</FormLabel>
              <FormControl>
                <Input
                  placeholder="John Doe"
                  {...field}
                  value={field.value || ""}
                  data-testid={isEdit ? "input-edit-nickname" : "input-nickname"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormItem>
          <FormLabel>Account Type *</FormLabel>
          <Select onValueChange={handleTypeChange} value={selectedTypeId}>
            <FormControl>
              <SelectTrigger data-testid={isEdit ? "select-edit-account-type" : "select-account-type"}>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {socialAccountTypes?.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>

        <div className="flex gap-3 pt-4 border-t justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid={isEdit ? "button-edit-cancel" : "button-cancel"}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            data-testid={isEdit ? "button-edit-submit" : "button-submit"}
          >
            {mutation.isPending
              ? isEdit
                ? "Saving..."
                : "Adding..."
              : isEdit
              ? "Save Changes"
              : "Add Account"}
          </Button>
        </div>
      </form>
    </Form>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Social Account" : "Add Social Account"}</DialogTitle>
          {!isEdit && (
            <DialogDescription>
              Create manually or import a connections XML file.
            </DialogDescription>
          )}
        </DialogHeader>

        {isEdit ? (
          formFields
        ) : (
          <Tabs defaultValue="manual" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
              <TabsTrigger value="import">XML Import</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="pt-4">
              {formFields}
            </TabsContent>

            <TabsContent value="import" className="pt-4">
              <form onSubmit={handleImportXmlSubmit} className="space-y-6">
                <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center border-muted-foreground/25">
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium text-center mb-1">
                    Upload Instagram connections.xml
                  </p>
                  <p className="text-xs text-muted-foreground text-center mb-4">
                    XML format containing followers and following lists
                  </p>
                  <input
                    type="file"
                    accept=".xml"
                    onChange={handleXmlFileChange}
                    className="hidden"
                    id="xml-file-upload"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById("xml-file-upload")?.click()}
                  >
                    Select File
                  </Button>
                </div>

                {selectedXmlFile && (
                  <div className="bg-muted p-3 rounded-md flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{selectedXmlFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedXmlFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setSelectedXmlFile(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                <div className="flex gap-3 pt-4 border-t justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!selectedXmlFile || importXmlMutation.isPending}
                  >
                    {importXmlMutation.isPending ? "Importing..." : "Import XML"}
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
