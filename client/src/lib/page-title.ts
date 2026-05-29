export function getPageTitle(location: string): string {
  if (location === "/" || location === "/people") return "People";
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
  if (location === "/api-playground") return "API Playground";
  if (location === "/prm-face-demo") return "PRM-Face Demo";
  if (location === "/prm-face-save-demo") return "PRM-Face Save Demo";
  if (location.startsWith("/settings")) return "Settings";
  return "";
}
