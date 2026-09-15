import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { ImportBackupDialog, type ImportBackupSource } from "@/components/import-backup-dialog";
import { ConversationListPane } from "@/components/conversation-list-pane";
import { ConversationThreadPane } from "@/components/conversation-thread-pane";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SocialAccountWithCurrentProfile } from "@shared/schema";

interface MessagesTabProps {
  personId?: string;
  socialAccountId?: string;
}

// Messages live on profile pages only (there is no global messages page).
// Non-me profiles render in perspective mode: the subject's outgoing messages
// on the right, incoming on the left — as if you were looking at their phone.
export function MessagesTab({ personId, socialAccountId }: MessagesTabProps) {
  if (personId) {
    return <PersonMessagesView personId={personId} />;
  }
  if (socialAccountId) {
    return <AccountMessagesView socialAccountId={socialAccountId} />;
  }
  return null;
}

function AccountMessagesView({ socialAccountId }: { socialAccountId: string }) {
  const { data: account } = useQuery<SocialAccountWithCurrentProfile>({
    queryKey: [`/api/social-accounts/${socialAccountId}`],
  });

  return (
    <EmbeddedMessagesView
      socialAccountId={socialAccountId}
      perspective
      title="DMs"
      // The account is the root account of any backup imported from its profile
      importSource={
        account
          ? { kind: "instagram", rootSocialAccountId: account.id, rootUsername: account.username }
          : undefined
      }
    />
  );
}

function PersonMessagesView({ personId }: { personId: string }) {
  const { data: me } = useQuery<any>({ queryKey: ["/api/me"] });
  const { data: person } = useQuery<any>({ queryKey: [`/api/people/${personId}`] });
  const { data: allAccounts = [] } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  // The person's linked social accounts: explicit links on the person plus
  // accounts that name them as owner
  const linkedIds = new Set<string>(person?.socialAccountUuids || []);
  for (const a of allAccounts as any[]) {
    if (a.ownerUuid === personId) linkedIds.add(a.id);
  }

  const isMe = me?.id === personId;

  return (
    <EmbeddedMessagesView
      personId={personId}
      perspective={!isMe}
      perspectiveAccountIds={[...linkedIds]}
      title={isMe ? "Messages" : "Their Messages"}
      // An SMS backup imported from a profile came from that person's phone
      importSource={
        person
          ? { kind: "sms", rootPersonId: personId, personName: `${person.firstName} ${person.lastName}` }
          : undefined
      }
    />
  );
}

interface EmbeddedMessagesViewProps {
  personId?: string;
  socialAccountId?: string;
  perspective: boolean;
  perspectiveAccountIds?: string[];
  title: string;
  /** When set, shows the "Import Backup" action for this profile's backup type */
  importSource?: ImportBackupSource;
}

function EmbeddedMessagesView({
  personId,
  socialAccountId,
  perspective,
  perspectiveAccountIds,
  title,
  importSource,
}: EmbeddedMessagesViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const isMobile = useIsMobile();

  const showList = !isMobile || selectedId === null;
  const showThread = !isMobile || selectedId !== null;

  return (
    <div className="flex flex-1 h-full w-full overflow-hidden bg-background">
      {showList && (
        <div className={isMobile ? "w-full flex flex-col" : "w-72 lg:w-80 border-r shrink-0 flex flex-col"}>
          <ConversationListPane
            selectedId={selectedId}
            onSelect={setSelectedId}
            onImport={importSource ? () => setIsImportDialogOpen(true) : undefined}
            socialAccountId={socialAccountId}
            personId={personId}
            perspective={perspective}
            perspectiveAccountIds={perspectiveAccountIds}
            title={title}
          />
        </div>
      )}

      {showThread && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedId ? (
            <ConversationThreadPane
              key={selectedId}
              conversationId={selectedId}
              perspectiveSocialAccountId={perspective ? socialAccountId : undefined}
              perspectivePersonId={perspective ? personId : undefined}
              perspectiveAccountIds={perspective ? perspectiveAccountIds : undefined}
              onBack={isMobile ? () => setSelectedId(null) : undefined}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground select-none">
              <MessageCircle className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">Select a conversation</p>
            </div>
          )}
        </div>
      )}

      {importSource && (
        <ImportBackupDialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen} source={importSource} />
      )}
    </div>
  );
}
