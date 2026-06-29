import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, ChevronsUpDown, X, Phone, Mail, Instagram, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Person, SocialAccountWithCurrentProfile } from "@shared/schema";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPersonId?: string;
  initialSocialAccountId?: string;
}

const CHANNEL_TYPES = [
  { value: "phone", label: "Phone (SMS)", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "instagram", label: "Instagram", icon: Instagram },
  { value: "generic", label: "Generic Message", icon: MessageSquare },
];

export function NewConversationDialog({
  open,
  onOpenChange,
  initialPersonId,
  initialSocialAccountId,
}: NewConversationDialogProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [channelType, setChannelType] = useState("phone");
  const [socialAccountId, setSocialAccountId] = useState(initialSocialAccountId || "");
  const [externalUrl, setExternalUrl] = useState("");

  const [selectedPeople, setSelectedPeople] = useState<Person[]>([]);
  const [peopleSearchOpen, setPeopleSearchOpen] = useState(false);

  // Queries
  const { data: allPeople = [] } = useQuery<Person[]>({
    queryKey: ["/api/people"],
  });

  const { data: allSocialAccounts = [] } = useQuery<SocialAccountWithCurrentProfile[]>({
    queryKey: ["/api/social-accounts"],
  });

  // Pre-populate if initialPersonId is passed
  useState(() => {
    if (initialPersonId && allPeople.length > 0) {
      const person = allPeople.find(p => p.id === initialPersonId);
      if (person) {
        setSelectedPeople([person]);
      }
    }
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/conversations", payload);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/paginated"] });
      if (initialPersonId) {
        queryClient.invalidateQueries({ queryKey: [`/api/people/${initialPersonId}/conversations`] });
      }
      if (initialSocialAccountId) {
        queryClient.invalidateQueries({ queryKey: [`/api/social-accounts/${initialSocialAccountId}/conversations`] });
      }
      toast({
        title: "Conversation created",
        description: "Your new conversation log has been created successfully.",
      });
      onOpenChange(false);
      navigate(`/messages/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error creating conversation",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPeople.length === 0) {
      toast({
        title: "Validation error",
        description: "Please select at least one recipient/participant.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      title: title.trim() || null,
      channelType,
      socialAccountId: socialAccountId || null,
      externalUrl: externalUrl.trim() || null,
      participantPersonIds: selectedPeople.map(p => p.id),
      participantSocialAccountIds: socialAccountId ? [socialAccountId] : [],
    });
  };

  const handleSelectPerson = (person: Person) => {
    if (selectedPeople.some(p => p.id === person.id)) {
      setSelectedPeople(selectedPeople.filter(p => p.id !== person.id));
    } else {
      setSelectedPeople([...selectedPeople, person]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Conversation Log</DialogTitle>
            <DialogDescription>
              Create a thread to log messages, emails, or DMs with your contacts.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title / Subject */}
            <div className="grid gap-2">
              <Label htmlFor="title">Title / Subject (Optional)</Label>
              <Input
                id="title"
                placeholder="e.g. Catch up meeting, Project Sync, Follow Up"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

            {/* Channel Type */}
            <div className="grid gap-2">
              <Label htmlFor="channelType">Channel Type</Label>
              <Select value={channelType} onValueChange={setChannelType}>
                <SelectTrigger id="channelType">
                  <SelectValue placeholder="Select Channel" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_TYPES.map(ch => {
                    const Icon = ch.icon;
                    return (
                      <SelectItem key={ch.value} value={ch.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span>{ch.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Recipients (Multiple People) */}
            <div className="grid gap-2">
              <Label>Recipients / Participants</Label>
              
              {/* Selected People Badges */}
              {selectedPeople.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-muted/30">
                  {selectedPeople.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full"
                    >
                      <span>{p.firstName} {p.lastName}</span>
                      <button
                        type="button"
                        onClick={() => handleSelectPerson(p)}
                        className="hover:text-destructive transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Popover open={peopleSearchOpen} onOpenChange={setPeopleSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  >
                    <span>Add participant...</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[450px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search people..." />
                    <CommandList>
                      <CommandEmpty>No person found.</CommandEmpty>
                      <CommandGroup>
                        {allPeople.map(person => {
                          const isSelected = selectedPeople.some(p => p.id === person.id);
                          return (
                            <CommandItem
                              key={person.id}
                              value={`${person.firstName} ${person.lastName} ${person.company || ""}`}
                              onSelect={() => handleSelectPerson(person)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  isSelected ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span className="font-medium">{person.firstName} {person.lastName}</span>
                                {person.company && (
                                  <span className="text-xs text-muted-foreground">{person.company}</span>
                                )}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Social Account selection (optional) */}
            {channelType !== "phone" && channelType !== "email" && (
              <div className="grid gap-2">
                <Label htmlFor="socialAccountId">Tied to Social Account (Optional)</Label>
                <Select value={socialAccountId} onValueChange={setSocialAccountId}>
                  <SelectTrigger id="socialAccountId">
                    <SelectValue placeholder="Select account reference..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none_account">-- None --</SelectItem>
                    {allSocialAccounts
                      .filter(acc => {
                        // Filter matching channel type if possible
                        if (channelType === "instagram") return acc.username.startsWith("@") || acc.typeId?.includes("instagram");
                        return true;
                      })
                      .map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.username} ({acc.typeId || "unknown"})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* External URL Reference */}
            <div className="grid gap-2">
              <Label htmlFor="externalUrl">External Source URL (Optional)</Label>
              <Input
                id="externalUrl"
                placeholder="e.g. Gmail thread URL, Instagram DM link"
                value={externalUrl}
                onChange={e => setExternalUrl(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Thread"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
