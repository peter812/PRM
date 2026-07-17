// Static metadata for the PRM-osint tools, mirroring GET /api/v1/tools in
// PRM-osint/README.md. Used to render the demo landing cards and to drive each
// tool's demo form (which target types it accepts). The live server remains the
// source of truth for validation; this is only for the UI.

export type OsintTargetType = "username" | "email";

export interface OsintToolMeta {
  /** Slug used in the tool's API `tool` field and the demo route. */
  name: string;
  label: string;
  description: string;
  supportedTargetTypes: OsintTargetType[];
}

export const OSINT_TOOLS: OsintToolMeta[] = [
  {
    name: "sherlock",
    label: "Sherlock",
    description: "Hunt down social media accounts by username across hundreds of sites.",
    supportedTargetTypes: ["username"],
  },
  {
    name: "maigret",
    label: "Maigret",
    description: "Collect a dossier on a person by username from many sites, with tags.",
    supportedTargetTypes: ["username"],
  },
  {
    name: "socialscan",
    label: "Socialscan",
    description: "Check whether an email or username is registered on online platforms.",
    supportedTargetTypes: ["email", "username"],
  },
  {
    name: "blackbird",
    label: "Blackbird",
    description: "Search for accounts by username or email across many modules.",
    supportedTargetTypes: ["email", "username"],
  },
  {
    name: "user-scanner",
    label: "User Scanner",
    description: "Scan an email or username across modules, including breach hits.",
    supportedTargetTypes: ["email", "username"],
  },
];

export function getOsintTool(name: string | undefined): OsintToolMeta | undefined {
  return OSINT_TOOLS.find((t) => t.name === name);
}
