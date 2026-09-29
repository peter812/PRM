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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { URL_TYPE_MAPPINGS } from "@/lib/constants";
import { insertSocialAccountSchema, INSTAGRAM_TYPE_ID, type SocialAccountType, type SocialAccount, type SocialAccountWithCurrentProfile } from "@shared/schema";
import { z } from "zod";
import { ImageUpload } from "./image-upload";
import { Upload, FileText, X } from "lucide-react";

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
  groupId?: string | null;
}

export function SocialAccountDialog({
  open,
  onOpenChange,
  account,
  onAccountCreated,
  groupId,
}: SocialAccountDialogProps) {
  const isEdit = !!account;
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [isTypeAutoSelected, setIsTypeAutoSelected] = useState(false);
  const [selectedXmlFile, setSelectedXmlFile] = useState<File | null>(null);

  // Tracking job checkboxes (add mode only)
  const [queueInfo, setQueueInfo] = useState(true);
  const [queuePosts, setQueuePosts] = useState(true);
  const [queueFollows, setQueueFollows] = useState(true);

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  // Find the Instagram type to use as default
  const instagramType = socialAccountTypes?.find(
    (t) => t.id === INSTAGRAM_TYPE_ID || t.name.toLowerCase() === "instagram"
  );

  const isInstagramSelected = selectedTypeId === INSTAGRAM_TYPE_ID ||
    (instagramType && selectedTypeId === instagramType.id);

  const form = useForm<FormValues>({
    resolver: zodResolver(socialAccountFormSchema),
    defaultValues: {
      username: "",
      nickname: "",
      accountUrl: "",
      ownerUuid: null,
      groupId: groupId || null,
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
          groupId: (account as any).groupId || null,
          imageUrl: account.currentProfile?.imageUrl || null,
          typeId: account.typeId || null,
          following: [],
          followers: [],
        });
      } else {
        setImageUrl(null);
        // Default to Instagram type when opening in add mode
        const defaultTypeId = instagramType?.id || "";
        setSelectedTypeId(defaultTypeId);
        setSelectedXmlFile(null);
        setQueueInfo(true);
        setQueuePosts(true);
        setQueueFollows(true);
        form.reset({
          username: "",
          nickname: "",
          accountUrl: "",
          ownerUuid: null,
          groupId: groupId || null,
          imageUrl: null,
          following: [],
          followers: [],
          typeId: null,
        });
      }
      setIsTypeAutoSelected(false);
    }
  }, [open, account, isEdit, form, instagramType]);

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

  /** Dispatch tracking jobs for checked kinds after account creation. */
  const dispatchTrackingJobs = async (accountId: string) => {
    const kinds: string[] = [];
    if (queueInfo) kinds.push("info");
    if (queuePosts) kinds.push("posts");
    if (queueFollows) kinds.push("follows");

    const results = await Promise.allSettled(
      kinds.map((kind) =>
        apiRequest("POST", `/api/social-accounts/${accountId}/tracking-jobs`, { kind })
      )
    );

    const queued = results.filter((r) => r.status === "fulfilled").length;
    if (queued > 0) {
      toast({
        title: "Queued",
        description: `${queued} tracking job${queued > 1 ? "s" : ""} dispatched to the queue.`,
      });
    }
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
          groupId: (data as any).groupId || null,
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

      // Dispatch tracking jobs for newly created Instagram accounts
      if (!isEdit && data?.id && isInstagramSelected) {
        void dispatchTrackingJobs(data.id);
      }

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

  // ── Edit mode form (unchanged — full fields) ────────────────────────────
  const editFormFields = (
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
                  data-testid="input-edit-account-url"
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
                  data-testid="input-edit-username"
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
                  data-testid="input-edit-nickname"
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
              <SelectTrigger data-testid="select-edit-account-type">
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
            data-testid="button-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            data-testid="button-edit-submit"
          >
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );

  // ── Add mode form (simplified: type → username → tracking checkboxes) ──
  const addFormFields = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Account Type — first, defaults to Instagram */}
        <FormItem>
          <FormLabel>Account Type *</FormLabel>
          <Select onValueChange={handleTypeChange} value={selectedTypeId}>
            <FormControl>
              <SelectTrigger data-testid="select-account-type">
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

        {/* Username */}
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
                  data-testid="input-username"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Tracking job checkboxes — only for Instagram */}
        {isInstagramSelected && (
          <div className="space-y-3 pt-2 border-t">
            <Label className="text-sm font-medium">Account Info</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="queue-info"
                  checked={queueInfo}
                  onCheckedChange={(checked) => setQueueInfo(checked === true)}
                  data-testid="checkbox-queue-info"
                />
                <Label htmlFor="queue-info" className="text-sm font-normal cursor-pointer">
                  Get this person's account info?
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="queue-posts"
                  checked={queuePosts}
                  onCheckedChange={(checked) => setQueuePosts(checked === true)}
                  data-testid="checkbox-queue-posts"
                />
                <Label htmlFor="queue-posts" className="text-sm font-normal cursor-pointer">
                  Get this person's posts?
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="queue-follows"
                  checked={queueFollows}
                  onCheckedChange={(checked) => setQueueFollows(checked === true)}
                  data-testid="checkbox-queue-follows"
                />
                <Label htmlFor="queue-follows" className="text-sm font-normal cursor-pointer">
                  Get this person's followers/following?
                </Label>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t justify-end">
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
            disabled={mutation.isPending}
            data-testid="button-submit"
          >
            {mutation.isPending ? "Adding..." : "Add Account"}
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
          editFormFields
        ) : (
          <Tabs defaultValue="manual" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
              <TabsTrigger value="import">XML Import</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="pt-4">
              {addFormFields}
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
