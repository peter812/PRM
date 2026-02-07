import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SocialAccount } from "@shared/schema";
import { LinkSocialAccountDialog } from "./link-social-account-dialog";

interface PersonSocialAccountsChipsProps {
  personId: string;
  socialAccountUuids: string[];
  onUpdate?: () => void;
}

export function PersonSocialAccountsChips({
  personId,
  socialAccountUuids,
  onUpdate,
}: PersonSocialAccountsChipsProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: accounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const linkedAccounts = accounts.filter((acc) =>
    socialAccountUuids.includes(acc.id)
  );

  const removeMutation = useMutation({
    mutationFn: async (accountIdToRemove: string) => {
      const updatedUuids = socialAccountUuids.filter(
        (id) => id !== accountIdToRemove
      );
      return await apiRequest("PATCH", `/api/people/${personId}`, {
        socialAccountUuids: updatedUuids,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", personId] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      if (onUpdate) {
        onUpdate();
      }
      toast({
        title: "Success",
        description: "Social account removed",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove social account",
        variant: "destructive",
      });
    },
  });

  const handleRemove = (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    removeMutation.mutate(accountId);
  };

  const handleDialogClose = (updated: boolean) => {
    setIsDialogOpen(false);
    if (updated && onUpdate) {
      onUpdate();
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {linkedAccounts.length === 0 ? (
          <Badge
            variant="outline"
            className="cursor-pointer hover-elevate"
            onClick={() => setIsDialogOpen(true)}
            data-testid="chip-add-social-account"
          >
            <Plus className="h-3 w-3 mr-1" />
            Social account
          </Badge>
        ) : (
          <>
            {linkedAccounts.map((account) => (
              <Badge
                key={account.id}
                variant="secondary"
                className="flex items-center gap-1 cursor-pointer"
                onClick={() => navigate(`/social-accounts/${account.id}`)}
                data-testid={`chip-social-account-${account.id}`}
              >
                <span>@{account.username}</span>
                <button
                  onClick={(e) => handleRemove(e, account.id)}
                  className="ml-1 hover:bg-secondary-foreground/20 rounded p-0.5"
                  data-testid={`button-remove-social-account-${account.id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Badge
              variant="outline"
              className="cursor-pointer hover-elevate"
              onClick={() => setIsDialogOpen(true)}
              data-testid="chip-add-more-social-accounts"
            >
              <Plus className="h-3 w-3" />
            </Badge>
          </>
        )}
      </div>

      <LinkSocialAccountDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        personId={personId}
        linkedAccountIds={socialAccountUuids}
      />
    </>
  );
}
