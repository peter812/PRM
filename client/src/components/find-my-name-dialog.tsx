import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Check, Sparkles, UserPlus, UserSearch, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonDialog } from "@/components/person-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn, getInitials, isSelfMessage } from "@/lib/utils";
import { cleanPhoneNumberForStorage, formatPhoneNumberForDisplay, type Person } from "@shared/schema";
import { format } from "date-fns";

/** Counterpart numbers of a phone thread that no participant's phone covers */
export function unlinkedAddresses(conversation: any): string[] {
  if (conversation?.channelType !== "phone") return [];
  const linked = new Set(
    (conversation.participants ?? []).flatMap((p: any) =>
      p.person ? [p.person.phone, ...(p.person.additionalPhones ?? [])].map(cleanPhoneNumberForStorage) : []
    )
  );
  return ((conversation.metadata?.addresses ?? []) as string[]).filter((a) => !linked.has(a));
}

interface NameGuess {
  firstName: string | null;
  lastName: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface FindMyNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: any;
}

export function FindMyNameDialog({ open, onOpenChange, conversation }: FindMyNameDialogProps) {
  const { toast } = useToast();
  const unlinked = unlinkedAddresses(conversation);
  const [chosenAddress, setChosenAddress] = useState<string | null>(null);
  const address = chosenAddress && unlinked.includes(chosenAddress) ? chosenAddress : unlinked[0];
  const displayed = formatPhoneNumberForDisplay(address);
  const isGroup = (conversation?.metadata?.addresses?.length ?? 0) > 1;
  const contactName: string | null = !isGroup ? conversation?.metadata?.contactName ?? null : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  // Held in state so PersonDialog's prefill is referentially stable while it is open
  const [newPerson, setNewPerson] = useState<{ firstName: string; lastName: string; phone: string } | null>(null);

  const { data: firstPage, isLoading: isMsgsLoading } = useQuery<{ messages: any[] }>({
    queryKey: [`/api/conversations/${conversation?.id}/messages`, "first"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${conversation.id}/messages?offset=0&limit=30&order=asc`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return await res.json();
    },
    enabled: open && !!conversation?.id,
  });

  const { data: people = [] } = useQuery<Person[]>({ queryKey: ["/api/people"], enabled: open });

  const guess = useMutation({
    mutationFn: async (): Promise<NameGuess> => {
      const res = await apiRequest("POST", `/api/conversations/${conversation.id}/find-name`, { address });
      return await res.json();
    },
    onSuccess: (g) => setSearchQuery([g.firstName, g.lastName].filter(Boolean).join(" ")),
  });

  const link = useMutation({
    mutationFn: async (personId: string) => {
      const res = await apiRequest("POST", `/api/conversations/${conversation.id}/link-phone`, { address, personId });
      return (await res.json()) as { conversationsUpdated: number };
    },
    onSuccess: ({ conversationsUpdated }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation.id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation.id}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({
        title: "Number linked",
        description: `${displayed} linked across ${conversationsUpdated} conversation${conversationsUpdated === 1 ? "" : "s"}.`,
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to link number", variant: "destructive" });
    },
  });

  const selectAddress = (a: string) => {
    setChosenAddress(a);
    guess.reset();
    setSearchQuery("");
    setSelectedPersonId(null);
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredPeople = q
    ? people.filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
    : people;

  const senderLabel = (m: any) =>
    isSelfMessage(m) ? "You"
    : m.senderPerson ? `${m.senderPerson.firstName} ${m.senderPerson.lastName}`
    : m.metadata?.senderName ?? "Unknown";
  const isFromNumber = (m: any) =>
    !isSelfMessage(m) && !m.senderPerson && (!isGroup || m.metadata?.senderName === displayed);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-lg p-4 md:p-6 max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-base md:text-lg flex items-center gap-2">
              <UserSearch className="h-5 w-5 text-primary" />
              Find my name
            </DialogTitle>
            <DialogDescription className="text-xs md:text-sm">
              Work out who {displayed} is from the start of the conversation, then link the number to a person.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
            {unlinked.length > 1 && (
              <Select value={address} onValueChange={selectAddress}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-find-name-number">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unlinked.map((a) => (
                    <SelectItem key={a} value={a}>{formatPhoneNumberForDisplay(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {contactName && (
              <p className="text-xs rounded-md bg-muted px-3 py-2">
                Saved on the phone as <span className="font-semibold">{contactName}</span>
              </p>
            )}

            {/* First messages */}
            <div className="rounded-md border max-h-56 overflow-y-auto text-xs divide-y">
              {isMsgsLoading ? (
                <div className="text-center py-6 text-muted-foreground">Loading messages...</div>
              ) : (
                (firstPage?.messages ?? []).filter((m) => m.content).map((m) => (
                  <div key={m.id} className={cn("px-3 py-1.5", isFromNumber(m) && "bg-primary/5")}>
                    <span className={cn("font-semibold", isFromNumber(m) ? "text-primary" : "text-muted-foreground")}>
                      {senderLabel(m)}
                    </span>
                    <span className="text-muted-foreground ml-2">{m.sentAt && format(new Date(m.sentAt), "MMM d, yyyy")}</span>
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                ))
              )}
            </div>

            {/* AI guess */}
            <div className="flex items-start gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => guess.mutate()}
                disabled={guess.isPending}
                data-testid="button-guess-name"
              >
                {guess.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="ml-1.5">{guess.data ? "Guess again" : "Guess name"}</span>
              </Button>
              <div className="text-xs min-w-0 flex-1 pt-1.5">
                {guess.error && <p className="text-destructive">{(guess.error as any).message}</p>}
                {guess.data && (
                  <>
                    <p>
                      <span className="font-semibold">
                        {[guess.data.firstName, guess.data.lastName].filter(Boolean).join(" ") || "No name found"}
                      </span>
                      <span className="text-muted-foreground"> · {guess.data.confidence} confidence</span>
                    </p>
                    {guess.data.reason && <p className="text-muted-foreground">{guess.data.reason}</p>}
                  </>
                )}
              </div>
            </div>

            {/* People search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search people by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs md:text-sm h-9"
                data-testid="input-search-find-name"
              />
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {filteredPeople.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">No people found</div>
              ) : (
                filteredPeople.map((person) => {
                  const isSelected = selectedPersonId === person.id;
                  return (
                    <Card
                      key={person.id}
                      className={cn("p-2.5 cursor-pointer border", isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
                      onClick={() => setSelectedPersonId(person.id)}
                      data-testid={`card-find-name-person-${person.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          {person.imageUrl && <AvatarImage src={person.imageUrl} alt="" />}
                          <AvatarFallback className="text-xs">{getInitials(person.firstName, person.lastName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-xs md:text-sm truncate">{person.firstName} {person.lastName}</p>
                          {person.phone && (
                            <p className="text-[11px] text-muted-foreground truncate">{formatPhoneNumberForDisplay(person.phone)}</p>
                          )}
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-3 border-t flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setNewPerson({
                  firstName: guess.data?.firstName ?? "",
                  lastName: guess.data?.lastName ?? "",
                  phone: displayed,
                })
              }
              data-testid="button-find-name-create-person"
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Create new person
            </Button>
            <Button
              size="sm"
              onClick={() => selectedPersonId && link.mutate(selectedPersonId)}
              disabled={!selectedPersonId || link.isPending}
              data-testid="button-find-name-link"
            >
              {link.isPending ? "Linking..." : "Link number"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PersonDialog
        open={newPerson !== null}
        onOpenChange={(isOpen) => !isOpen && setNewPerson(null)}
        initialValues={newPerson ?? undefined}
        onPersonCreated={(person) => link.mutate(person.id)}
      />
    </>
  );
}
