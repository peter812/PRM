import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AtSign, Plus, User as UserIcon } from "lucide-react";
import type { AiChatContextEntity, MegaSearchResult } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useDebounce } from "@/hooks/use-debounce";

const SEARCH_PARAMS = "includeGroups=false&includeInteractions=false&includeNotes=false&includeDailyNotes=false&includeChats=false";

/** "+" button that searches people and social accounts to pin to a chat. Stays open for multi-select. */
export function ChatContextPicker({ selected, onAdd, disabled }: {
  selected: AiChatContextEntity[];
  onAdd: (entity: AiChatContextEntity) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDebounce(query.trim(), 250);
  const { data, isFetching } = useQuery<MegaSearchResult>({
    queryKey: [`/api/mega-search?q=${encodeURIComponent(q)}&${SEARCH_PARAMS}`],
    enabled: open && q.length > 0,
  });
  const isSelected = (type: AiChatContextEntity["type"], id: string) => selected.some((e) => e.type === type && e.id === id);
  const people = (data?.people ?? []).filter((p) => !isSelected("person", p.id)).slice(0, 8);
  const accounts = (data?.socialProfiles ?? []).filter((a) => !isSelected("social_account", a.id)).slice(0, 8);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={disabled} title="Add people or social accounts to this chat" data-testid="button-add-chat-context">
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" side="top">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search people or accounts…" value={query} onValueChange={setQuery} data-testid="input-chat-context-search" />
          <CommandList>
            {q && q === query.trim() && !isFetching && <CommandEmpty>No matches.</CommandEmpty>}
            {people.length > 0 && (
              <CommandGroup heading="People">
                {people.map((p) => {
                  const label = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Unnamed person";
                  return (
                    <CommandItem key={p.id} value={`person-${p.id}`} onSelect={() => onAdd({ type: "person", id: p.id, label })}>
                      <UserIcon className="mr-2 h-4 w-4" />
                      <span className="truncate">{label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {accounts.length > 0 && (
              <CommandGroup heading="Social accounts">
                {accounts.map((a) => (
                  <CommandItem key={a.id} value={`account-${a.id}`} onSelect={() => onAdd({ type: "social_account", id: a.id, label: `@${a.username}` })}>
                    <AtSign className="mr-2 h-4 w-4" />
                    <span className="truncate">@{a.username}</span>
                    {a.nickname && <span className="ml-2 truncate text-xs text-muted-foreground">{a.nickname}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
