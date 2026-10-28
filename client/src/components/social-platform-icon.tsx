import type { IconType } from "react-icons";
import {
  SiBluesky, SiDiscord, SiFacebook, SiGithub, SiInstagram, SiLinkedin, SiMastodon, SiPinterest,
  SiReddit, SiSnapchat, SiTelegram, SiThreads, SiTiktok, SiTwitch, SiWhatsapp, SiX, SiYoutube,
} from "react-icons/si";
import type { SocialAccountType } from "@shared/schema";
import { cn, isValidHexColor } from "@/lib/utils";

// Account types are user-editable, so match on name rather than id.
const ICONS: Record<string, IconType> = {
  instagram: SiInstagram, facebook: SiFacebook, discord: SiDiscord, x: SiX, "x.com": SiX, twitter: SiX,
  bluesky: SiBluesky, github: SiGithub, linkedin: SiLinkedin, mastodon: SiMastodon, pinterest: SiPinterest,
  reddit: SiReddit, snapchat: SiSnapchat, telegram: SiTelegram, threads: SiThreads, tiktok: SiTiktok,
  twitch: SiTwitch, whatsapp: SiWhatsapp, youtube: SiYoutube,
};

/** Small platform logo for a social account type; falls back to a colored dot. */
export function SocialPlatformIcon({
  type,
  className,
  onClick,
}: {
  type: SocialAccountType;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const Icon = ICONS[type.name.trim().toLowerCase()];
  // Near-black brand colors (X) would vanish in dark mode; let those inherit the text color.
  const color = isValidHexColor(type.color) && type.color.toLowerCase() !== "#000000" ? type.color : undefined;
  return (
    <span
      title={type.name}
      aria-label={type.name}
      role={onClick ? "button" : "img"}
      className={cn("inline-flex items-center justify-center shrink-0", onClick && "cursor-pointer", className)}
      style={{ color }}
      onClick={onClick}
    >
      {Icon ? (
        <Icon className="h-4 w-4" />
      ) : (
        <span className="w-2.5 h-2.5 rounded-full bg-current" />
      )}
    </span>
  );
}
