import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

  const { data: accounts = [] } = useQuery<SocialAccount[]>({
    queryKey: ["/api/social-accounts"],
  });

  const linkedAccounts = accounts.filter((acc) =>
    socialAccountUuids.includes(acc.id)
  );

  const handleDialogClose = (updated: boolean) => {
    setIsDialogOpen(false);
    if (updated && onUpdate) {
      onUpdate();
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-3">
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
                className="cursor-pointer hover-elevate"
                onClick={() => setIsDialogOpen(true)}
                data-testid={`chip-social-account-${account.id}`}
              >
                @{account.username}
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
