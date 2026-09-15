import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Phone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ImportBackupDialog, ImportFilterSwitches, type ImportFilters } from "@/components/import-backup-dialog";
import { cn } from "@/lib/utils";

interface PersonOption {
  id: string;
  firstName: string;
  lastName: string;
  company?: string | null;
}

// Settings entry point for SMS/MMS/RCS backups. The upload itself is the same
// dialog the person profile uses; this page only picks whose phone it came from.
export default function ImportMessagesPage() {
  const { data: me } = useQuery<PersonOption>({ queryKey: ["/api/me"] });
  const { data: people = [] } = useQuery<PersonOption[]>({ queryKey: ["/api/people"] });

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filters, setFilters] = useState<ImportFilters>({ skipAutomated: true, skipNoise: true });

  const ownerId = pickedId ?? me?.id ?? null;
  const owner = people.find((p) => p.id === ownerId) ?? (me?.id === ownerId ? me : undefined);

  return (
    <div className="container max-w-full md:max-w-2xl py-3 md:py-8 px-4 md:pl-12 mx-auto md:mx-0 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold" data-testid="text-import-messages-title">Import Messages</h1>
        <p className="text-muted-foreground">
          Import SMS, MMS, and RCS conversations from an Android phone backup.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            SMS Backup &amp; Restore XML
          </CardTitle>
          <CardDescription>
            Export your messages with the <span className="font-medium text-foreground">SMS Backup &amp; Restore</span>{" "}
            app and upload the XML file. Every thread is imported as a conversation owned by the phone's owner;
            numbers that match a person's phone are linked to them, and the rest can be linked later. Re-importing
            the same backup skips messages that are already stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Whose phone is this backup from?</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between" data-testid="button-pick-owner">
                  <span>{owner ? `${owner.firstName} ${owner.lastName}` : "Select a person..."}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search people..." />
                  <CommandList>
                    <CommandEmpty>No person found.</CommandEmpty>
                    <CommandGroup>
                      {people.map((person) => (
                        <CommandItem
                          key={person.id}
                          value={`${person.firstName} ${person.lastName} ${person.company || ""}`}
                          onSelect={() => {
                            setPickedId(person.id);
                            setPickerOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", person.id === ownerId ? "opacity-100" : "opacity-0")} />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {person.firstName} {person.lastName}
                              {person.id === me?.id && <span className="ml-1 text-xs text-muted-foreground">(me)</span>}
                            </span>
                            {person.company && <span className="text-xs text-muted-foreground">{person.company}</span>}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <ImportFilterSwitches value={filters} onChange={setFilters} />

          <Button onClick={() => setDialogOpen(true)} disabled={!owner} data-testid="button-choose-backup">
            <Upload className="h-4 w-4 mr-2" />
            Choose Backup XML
          </Button>
        </CardContent>
      </Card>

      {owner && (
        <ImportBackupDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          source={{ kind: "sms", rootPersonId: owner.id, personName: `${owner.firstName} ${owner.lastName}` }}
          filters={filters}
        />
      )}
    </div>
  );
}
