import { Link } from "wouter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";

/**
 * An account as a row: avatar plus a link to its profile.
 *
 * The follower list, the following list, the differences dialog and the history
 * modal all render the same thing, so it lives here rather than in each of them.
 * `testIdPrefix` keeps each caller's existing `card-*` / `link-*` test ids.
 */
export function SocialAccountRow({
  id,
  username,
  imageUrl,
  testIdPrefix,
  onNavigate,
}: {
  id: string;
  username: string;
  imageUrl?: string | null;
  testIdPrefix: string;
  onNavigate?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 p-2 rounded-md hover-elevate"
      data-testid={`card-${testIdPrefix}-${id}`}
    >
      <Avatar className="w-8 h-8">
        {imageUrl && <AvatarImage src={imageUrl} alt={username} />}
        <AvatarFallback className="text-xs">{getInitials(username)}</AvatarFallback>
      </Avatar>
      <Link
        href={`/social-accounts/${id}`}
        className="text-sm font-medium hover:underline"
        onClick={onNavigate}
        data-testid={`link-${testIdPrefix}-${id}`}
      >
        {username}
      </Link>
    </div>
  );
}
