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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertSocialAccountSchema, type InsertSocialAccount, type SocialAccountType } from "@shared/schema";
import { ImageUpload } from "./image-upload";

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

  const { data: socialAccountTypes } = useQuery<SocialAccountType[]>({
    queryKey: ["/api/social-account-types"],
  });

  const form = useForm<InsertSocialAccount>({
    resolver: zodResolver(insertSocialAccountSchema),
    defaultValues: {
      username: "",
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

  const onSubmit = (data: InsertSocialAccount) => {
    createMutation.mutate({
      ...data,
      imageUrl: imageUrl || null,
      typeId: selectedTypeId && selectedTypeId !== "none" ? selectedTypeId : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-add-account">
        <DialogHeader>
          <DialogTitle>Add Social Account</DialogTitle>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
