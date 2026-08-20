import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Database,
  User,
  Home,
  Phone,
  Mail,
  Users,
  UserPlus,
  FileText,
  ExternalLink,
  Calendar,
  Check,
  X,
  Edit2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  type TruePersonSearch,
  type TpsAddress,
  type TpsRelation,
  type PersonWithRelations,
  formatPhoneNumberForDisplay,
  getTruePeopleSearchUrl,
} from "@shared/schema";

interface TrueDbTabProps {
  person: PersonWithRelations;
}

interface RecommendationItem {
  type: "birthday" | "address" | "email" | "phone";
  value: string;
  label: string;
}

const tpsPersonUrl = (tpsId?: string | null) =>
  tpsId ? `https://www.truepeoplesearch.com/find/person/${tpsId}` : null;

/** A titled section with an icon; renders nothing when it has no content. */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2 text-foreground/80">
        <Icon className="h-5 w-5 text-primary" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words">{value}</div>
    </div>
  );
}

function RelationList({ items }: { items: TpsRelation[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((r, i) => {
        const url = tpsPersonUrl(r.tpsId);
        const label = `${r.name}${r.age ? ` · ${r.age}` : ""}`;
        return url ? (
          <a
            key={`${r.name}-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {label}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
        ) : (
          <span key={`${r.name}-${i}`} className="rounded-full border px-3 py-1 text-sm">
            {label}
          </span>
        );
      })}
    </div>
  );
}

function RecommendationRow({ rec, person }: { rec: RecommendationItem; person: PersonWithRelations }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(rec.value);
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (updatedData: Partial<any>) => {
      return apiRequest("PATCH", `/api/people/${person.id}`, updatedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people", person.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/people/${person.id}/true-person-search`] });
      toast({ title: "Updated successfully" });
    },
  });

  const handleConfirm = () => {
    const patch: any = {};
    if (rec.type === "birthday") {
      patch.birthday = rec.value;
    } else if (rec.type === "address") {
      patch.address = rec.value;
    } else if (rec.type === "email") {
      if (!person.email) {
        patch.email = rec.value;
      } else {
        patch.additionalEmails = [...(person.additionalEmails || []), rec.value];
      }
    } else if (rec.type === "phone") {
      if (!person.phone) {
        patch.phone = rec.value;
      } else {
        patch.additionalPhones = [...(person.additionalPhones || []), rec.value];
      }
    }
    updateMutation.mutate(patch);
  };

  const handleDeny = () => {
    const denied = [...(person.deniedRecommendations || []), rec.value];
    updateMutation.mutate({ deniedRecommendations: denied });
  };

  const handleSaveEdit = () => {
    if (!editValue.trim()) return;
    const patch: any = {};
    if (rec.type === "birthday") {
      patch.birthday = editValue;
    } else if (rec.type === "address") {
      patch.address = editValue;
    } else if (rec.type === "email") {
      if (!person.email) {
        patch.email = editValue;
      } else {
        patch.additionalEmails = [...(person.additionalEmails || []), editValue];
      }
    } else if (rec.type === "phone") {
      if (!person.phone) {
        patch.phone = editValue;
      } else {
        patch.additionalPhones = [...(person.additionalPhones || []), editValue];
      }
    }
    // Deny original value so it doesn't show up again
    patch.deniedRecommendations = [...(person.deniedRecommendations || []), rec.value];
    updateMutation.mutate(patch);
    setIsEditing(false);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg border border-dashed bg-card/50 hover:bg-accent/5 hover:border-solid transition-all gap-2 text-xs group">
      {isEditing ? (
        <div className="flex items-center gap-2 flex-1 w-full">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="flex-1 min-w-0 bg-background border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <Button size="sm" className="min-h-0 h-7 px-2.5" onClick={handleSaveEdit}>
            <Check className="h-3 w-3 mr-1" />
            Save
          </Button>
          <Button size="sm" variant="ghost" className="min-h-0 h-7 px-2" onClick={() => setIsEditing(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 text-foreground/90 font-medium">
            <span className="break-all">{rec.label}?</span>
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="outline"
              className="min-h-0 h-7 px-2.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 border-emerald-200/50 hover:border-emerald-300"
              onClick={handleConfirm}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-0 h-7 px-2 text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/20 border-sky-200/50 hover:border-sky-300"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-0 h-7 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 border-rose-200/50 hover:border-rose-300"
              onClick={handleDeny}
            >
              Deny
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function TrueDbTab({ person }: TrueDbTabProps) {
  const { data: records, isLoading, isError } = useQuery<TruePersonSearch[]>({
    queryKey: [`/api/people/${person.id}/true-person-search`],
  });

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (records && records.length > 0) {
      if (!selectedRecordId || !records.some((r) => r.id === selectedRecordId)) {
        setSelectedRecordId(records[0].id);
      }
    }
  }, [records, selectedRecordId]);

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-sm text-destructive font-medium">
        Failed to load the TrueDB records.
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="max-w-3xl p-6">
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center bg-card/20 px-4">
          <Database className="h-10 w-10 text-muted-foreground/45" />
          <div className="text-sm font-semibold text-foreground">No TrueDB record linked</div>
          <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">
            Extract one from a TruePeopleSearch person page with the PRM Chrome extension, and it will
            appear here.
          </p>
          {person.phone && (
            <a
              href={getTruePeopleSearchUrl(person.phone)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-primary border border-primary/20 rounded-md hover:bg-primary/5 transition-colors"
            >
              Search TruePeopleSearch for {formatPhoneNumberForDisplay(person.phone)}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }

  const data = records.find((r) => r.id === selectedRecordId) || records[0];

  const akas = (data.akas as string[] | null) ?? [];
  const addresses = (data.addresses as TpsAddress[] | null) ?? [];
  const phones = (data.phoneNumbers as string[] | null) ?? [];
  const emails = (data.emails as string[] | null) ?? [];
  const relatives = (data.relatives as TpsRelation[] | null) ?? [];
  const associates = (data.associates as TpsRelation[] | null) ?? [];
  const sourceUrl = tpsPersonUrl(data.tpsId);

  // Compute recommendations from the latest record (records[0])
  const recommendations: RecommendationItem[] = [];
  const latestRecord = records[0];
  const denied = person.deniedRecommendations || [];

  if (latestRecord) {
    // Birthday suggestion
    if (
      latestRecord.birthday &&
      latestRecord.birthday !== person.birthday &&
      !denied.includes(latestRecord.birthday)
    ) {
      recommendations.push({
        type: "birthday",
        value: latestRecord.birthday,
        label: `Birthday: ${latestRecord.birthday}`,
      });
    }

    // Current address suggestion
    if (
      latestRecord.currentAddress &&
      latestRecord.currentAddress !== person.address &&
      !denied.includes(latestRecord.currentAddress)
    ) {
      recommendations.push({
        type: "address",
        value: latestRecord.currentAddress,
        label: `Current Address: ${latestRecord.currentAddress}`,
      });
    }

    // Additional addresses suggestions
    const extraAddresses = (latestRecord.addresses as TpsAddress[]) || [];
    for (const addr of extraAddresses) {
      if (
        addr.address &&
        addr.address !== person.address &&
        addr.address !== latestRecord.currentAddress &&
        !denied.includes(addr.address)
      ) {
        recommendations.push({
          type: "address",
          value: addr.address,
          label: `Previous Address: ${addr.address}`,
        });
      }
    }

    // Phone suggestions
    const phoneList = (latestRecord.phoneNumbers as string[]) || [];
    for (const ph of phoneList) {
      const phClean = ph.replace(/\D/g, "");
      const primaryClean = person.phone?.replace(/\D/g, "") || "";
      const isPrimary = phClean === primaryClean;
      const isAdditional = person.additionalPhones?.some((ap) => ap.replace(/\D/g, "") === phClean);
      if (!isPrimary && !isAdditional && !denied.includes(ph)) {
        recommendations.push({
          type: "phone",
          value: ph,
          label: `Phone: ${formatPhoneNumberForDisplay(ph)}`,
        });
      }
    }

    // Email suggestions
    const emailList = (latestRecord.emails as string[]) || [];
    for (const em of emailList) {
      const emLower = em.toLowerCase().trim();
      const primaryLower = person.email?.toLowerCase().trim() || "";
      const isPrimary = emLower === primaryLower;
      const isAdditional = person.additionalEmails?.some(
        (ae) => ae.toLowerCase().trim() === emLower
      );
      if (!isPrimary && !isAdditional && !denied.includes(em)) {
        recommendations.push({
          type: "email",
          value: em,
          label: `Email: ${em}`,
        });
      }
    }
  }

  return (
    <div className="max-w-3xl space-y-6 p-6">
      {/* Version Selector Dropdown */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border bg-muted/20 px-4 py-3 rounded-lg">
        <div className="flex items-center gap-2.5">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Scraped Record:
          </span>
          <select
            value={selectedRecordId || ""}
            onChange={(e) => setSelectedRecordId(e.target.value)}
            className="bg-background border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer font-medium"
          >
            {records.map((rec, idx) => (
              <option key={rec.id} value={rec.id}>
                {rec.importDate
                  ? new Date(rec.importDate).toLocaleString()
                  : `Version ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-semibold"
          >
            View source on TruePeopleSearch
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Recommendations Card */}
      {recommendations.length > 0 && (
        <Card className="p-4 border bg-amber-50/10 dark:bg-amber-950/10 border-amber-200/30 dark:border-amber-900/30 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <Database className="h-4.5 w-4.5" />
            <h4 className="text-sm font-bold">Unconfirmed Suggestions</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Hover over any suggested data imported from TrueDB to confirm, deny, or edit it.
          </p>
          <div className="space-y-2 pt-1">
            {recommendations.map((rec, idx) => (
              <RecommendationRow key={`${rec.type}-${rec.value}-${idx}`} rec={rec} person={person} />
            ))}
          </div>
        </Card>
      )}

      {/* Identity */}
      <Section icon={User} title="Identity">
        <div className="space-y-3">
          <Field label="Full Name" value={data.fullName} />
          <Field label="Birthday" value={data.birthday} />
          {akas.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Also Seen As
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {akas.map((a, i) => (
                  <Badge key={`${a}-${i}`} variant="secondary">
                    {a}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Addresses */}
      {(data.currentAddress || addresses.length > 0) && (
        <Section icon={Home} title="Addresses">
          <div className="space-y-4">
            {data.currentAddress && (
              <div className="rounded-md border p-3 bg-card/30">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current Address
                </div>
                <div className="text-sm text-foreground">{data.currentAddress}</div>
                {data.currentAddressPropertyDetails && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {data.currentAddressPropertyDetails}
                  </div>
                )}
                {data.currentAddressPropertyUrl && (
                  <a
                    href={data.currentAddressPropertyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Property record <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
            {addresses.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  All Addresses
                </div>
                <ul className="space-y-1">
                  {addresses.map((a, i) => (
                    <li key={`${a.address}-${i}`} className="text-sm">
                      {a.propertyUrl ? (
                        <a
                          href={a.propertyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {a.address}
                        </a>
                      ) : (
                        <span className="text-foreground">{a.address}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Contact */}
      {(phones.length > 0 || emails.length > 0) && (
        <Section icon={Phone} title="Contact">
          <div className="space-y-3">
            {phones.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Phone Numbers
                </div>
                <div className="flex flex-wrap gap-2">
                  {phones.map((p, i) => (
                    <Badge key={`${p}-${i}`} variant="outline" className="gap-1">
                      <Phone className="h-3 w-3" />
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {emails.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email Addresses
                </div>
                <div className="flex flex-col gap-1">
                  {emails.map((e, i) => (
                    <a
                      key={`${e}-${i}`}
                      href={`mailto:${e}`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline w-fit"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {e}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Relatives */}
      {relatives.length > 0 && (
        <Section icon={Users} title="Possible Relatives">
          <RelationList items={relatives} />
        </Section>
      )}

      {/* Associates */}
      {associates.length > 0 && (
        <Section icon={UserPlus} title="Possible Associates">
          <RelationList items={associates} />
        </Section>
      )}

      {/* Background */}
      {data.backgroundProfile && (
        <Section icon={FileText} title="Background Profile">
          <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {data.backgroundProfile}
          </p>
        </Section>
      )}
    </div>
  );
}
