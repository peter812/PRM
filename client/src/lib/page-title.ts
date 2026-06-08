export function getPageTitle(location: string): string {
  if (location === "/" || location === "/people") return "People";
  if (location === "/home") return "Home";
  if (location.startsWith("/person/")) return "Person";
  if (location === "/me") return "Me";
  if (location === "/groups") return "Groups";
  if (location.startsWith("/group/")) return "Group";
  if (location === "/social-accounts") return "Social Accounts";
  if (location.startsWith("/social-accounts/")) return "Social Account";
  if (location === "/account-matching") return "Link Accounts";
  if (location === "/graph") return "Graph";
  if (location === "/social-graph-3d") return "Social Graph";
  if (location === "/elo-ranking") return "ELO Ranking";
  if (location === "/prm-face-demo") return "PRM-Face Demo";
  if (location === "/prm-face-save-demo") return "PRM-Face Save Demo";
  if (location === "/ai-desc-demo") return "AI desc demo";
  if (location === "/ai-chat-demo") return "Chat";
  if (location === "/images") return "Images";
  if (location.startsWith("/image/")) return "Image";
  if (location === "/daily-notes") return "Daily Notes";
  if (location.startsWith("/daily-notes/")) return "Daily Note";
  if (location.startsWith("/settings")) return "Settings";
  return "";
}
