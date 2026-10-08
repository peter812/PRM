import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTEREST_LEVELS, INTEREST_LEVEL_COLOR, INTEREST_LEVEL_LABEL, type InterestLevel } from "@shared/interest-level";

export const asLevel = (v: string | null | undefined): InterestLevel =>
  (INTEREST_LEVELS as readonly string[]).includes(v ?? "") ? (v as InterestLevel) : "none";

export function InterestLevelBadge({ level, className = "" }: { level: string | null | undefined; className?: string }) {
  const l = asLevel(level);
  return (
    <Badge className={`${INTEREST_LEVEL_COLOR[l]} text-white border-0 hover:${INTEREST_LEVEL_COLOR[l]} ${className}`} data-testid={`badge-interest-${l}`}>
      {INTEREST_LEVEL_LABEL[l]}
    </Badge>
  );
}

/** The badge as a button: click it to pick another level. */
export function InterestLevelChipPicker({
  level,
  onChange,
  disabled = false,
}: {
  level: string | null | undefined;
  onChange: (level: InterestLevel) => void;
  disabled?: boolean;
}) {
  const current = asLevel(level);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" aria-label="Change interest level">
          <InterestLevelBadge level={current} className="cursor-pointer" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={current} onValueChange={(v) => v !== current && onChange(v as InterestLevel)}>
          {INTEREST_LEVELS.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} data-testid={`menu-interest-${l}`}>
              <span className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${INTEREST_LEVEL_COLOR[l]}`} />
                {INTEREST_LEVEL_LABEL[l]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The level as a select; `allowAll` adds an "Any level" entry for filters. */
export function InterestLevelSelect({
  value,
  onChange,
  allowAll = false,
  className = "",
}: {
  value: string | null | undefined;
  onChange: (level: string) => void;
  allowAll?: boolean;
  className?: string;
}) {
  return (
    <Select value={value || (allowAll ? "all" : "none")} onValueChange={onChange}>
      <SelectTrigger className={className} data-testid="select-interest-level">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="all">Any level</SelectItem>}
        {INTEREST_LEVELS.map((l) => (
          <SelectItem key={l} value={l}>
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${INTEREST_LEVEL_COLOR[l]}`} />
              {INTEREST_LEVEL_LABEL[l]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
