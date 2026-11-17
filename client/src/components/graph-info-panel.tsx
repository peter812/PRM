import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GraphInfoPanelProps {
  testId: string;
  /** Compact mobile summary row. */
  imageUrl?: string | null;
  fallback: string;
  avatarStyle?: CSSProperties;
  title: string;
  subtitle?: string | null;
  followers?: number;
  following?: number;
  viewHref: string;
  onClose: () => void;
  /** Full details: the whole panel on desktop, revealed by scrolling on mobile. */
  children: ReactNode;
}

/**
 * Selected-node info for the graph pages. Desktop: floating card top-left.
 * Mobile: a short sheet docked at the bottom showing a summary row; scrolling it expands to the full details.
 * Inside `children`, mark desktop-only header pieces `hidden md:flex` since the summary row replaces them.
 */
export function GraphInfoPanel({
  testId,
  imageUrl,
  fallback,
  avatarStyle,
  title,
  subtitle,
  followers,
  following,
  viewHref,
  onClose,
  children,
}: GraphInfoPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "absolute z-50 overflow-y-auto border shadow-lg backdrop-blur-sm bg-background/95 md:bg-background/80 transition-[max-height] duration-200",
        "left-0 right-0 bottom-0 rounded-t-xl",
        expanded ? "max-h-[60%]" : "max-h-[6.5rem]",
        "md:right-auto md:bottom-auto md:left-4 md:top-4 md:w-72 md:max-h-[calc(100%-2rem)] md:rounded-lg",
      )}
      onScroll={(e) => {
        if (!expanded && e.currentTarget.scrollTop > 0) setExpanded(true);
      }}
      data-testid={testId}
    >
      <div className="md:hidden sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <button
          type="button"
          className="block w-full pt-1.5 pb-1"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse details" : "Expand details"}
          data-testid={`${testId}-handle`}
        >
          <span className="mx-auto block h-1 w-10 rounded-full bg-muted-foreground/30" />
        </button>
        <div className="flex items-center gap-3 px-3 pb-2">
          <Avatar className="h-14 w-14 shrink-0" style={avatarStyle}>
            {imageUrl && <AvatarImage src={imageUrl} alt={title} />}
            <AvatarFallback>{fallback}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            {followers !== undefined && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{followers.toLocaleString()}</span> followers ·{" "}
                <span className="font-medium text-foreground">{(following ?? 0).toLocaleString()}</span> following
              </p>
            )}
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link href={viewHref} data-testid={`${testId}-view`}>View</Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
