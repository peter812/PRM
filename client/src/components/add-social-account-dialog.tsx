import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertSocialAccountSchema, type InsertSocialAccount } from "@shared/schema";
import { ImageUpload } from "./image-upload";

interface AddSocialAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSocialAccountDialog({ open, onOpenChange }: AddSocialAccountDialogProps) {
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const form = useForm<InsertSocialAccount>({
    resolver: zodResolver(insertSocialAccountSchema),
    defaultValues: {
      username: "",
      accountUrl: "",
      ownerUuid: null,
      imageUrl: null,
      following: [],
      followers: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertSocialAccount) => {
      return await apiRequest("POST", "/api/social-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social-accounts"] });
      toast({
        title: "Success",
        description: "Social account added successfully",
      });
      form.reset();
      setImageUrl(null);
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
