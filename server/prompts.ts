/**
 * Every LLM prompt the app sends, editable from Settings → Intelligence → Prompts.
 * A prompt left at its default is stored empty, so later changes to the default still apply.
 */
import { storage } from "./storage";

export type PromptSection = "chat" | "dailyNotes" | "images" | "summaries" | "people" | "groups";

export const PROMPT_SECTIONS: { id: PromptSection; title: string; description: string }[] = [
  { id: "chat", title: "AI Chat", description: "The assistant chat and the tools it calls." },
  { id: "dailyNotes", title: "Daily Notes", description: "Processing daily journal entries." },
  { id: "images", title: "Images", description: "Describing stored photos." },
  { id: "summaries", title: "Social Summaries", description: "Post, story and social account summaries." },
  { id: "people", title: "People", description: "Building and identifying contacts." },
  { id: "groups", title: "Groups", description: "Explaining detected social groups." },
];

type PromptDef = {
  section: PromptSection;
  title: string;
  description: string;
  settingKey: string;
  /** What the code adds to the prompt at run time, shown read-only in the dialog. */
  appended?: string;
  default: string;
};

const PROMPT_DEFS = {
  chatSystem: {
    section: "chat",
    title: "Default System Message",
    description: "System message for every AI chat that doesn't set its own.",
    settingKey: "prompt_chat_system",
    appended: "A chat's own system message replaces this one. Pinned people and accounts are appended.",
    default:
      "You are an intelligent assistant integrated with a Personal Relationship Manager (PRM). " +
      "You have access to tools that allow you to read live data from the PRM — including people, " +
      "social accounts, notes, interactions, and daily notes. When the user asks about a person, " +
      "their notes, relationships, social accounts, or any stored data, always call the appropriate " +
      "tool to look up the current information rather than guessing. Use person_search to find " +
      "someone by name, person_pull to get their full details (which returns up to 10 relationships/notes/interactions as a brief overview), " +
      "person_pull_relationships to get up to 20 relationships (ideal when specifically asked about siblings, friends, family, or colleagues), and the other available tools as " +
      "needed. Combine tool results with your own reasoning to give accurate, helpful answers. " +
      "Important note: You also have a super_search tool which performs a semantic search across the entire PRM. " +
      "You should only use this tool if other specific search tools (like person_search, note_search, daily_note_search, interaction_search, or social_account_search) yield no results or yield bad/unhelpful results. " +
      "You can send clickable links that will appear as buttons at the bottom of the chat bubble. " +
      "You must use this capability to link the user to relevant data profiles (people, social accounts, images, etc.) or to pages where they can manage settings, data types, or make changes. " +
      "To include a link, format it exactly as: \"URL\"{title} (for example, \"/person/some-uuid\"{John Doe} or \"https://instagram.com/jdoe\"{Instagram Profile}). " +
      "You can place these links inline in your text or at the end of your response. The system will automatically parse them, convert them to standard markdown links in your text, and display them as clickable buttons at the bottom of the chat bubble. " +
      "Always use the exact \"URL\"{title} format. Never write links as plain text or standard markdown. " +
      "Examples of internal links you can use: " +
      "- People: \"/person/UUID\"{Person Name} (or \"/person\"{Person Name} to resolve by name lookup) " +
      "- Social accounts: \"/social-accounts/UUID\"{Username} (or \"/social-accounts\"{Username} to resolve by username lookup) " +
      "- Images: \"/image/UUID\"{Image Description} " +
      "- Groups: \"/group/UUID\"{Group Name} " +
      "- Daily Notes: \"/daily-notes/UUID\"{Date} " +
      "- Settings: \"/settings/user\"{User Settings}, \"/settings/data-types\"{Data Types}, \"/settings/app\"{App Options}, \"/settings/import-export/application\"{Import/Export Application}. " +
      "Examples of external links you can use: \"https://example.com\"{Example website}. " +
      "Always include these links when discussing specific people, social accounts, images, or configuration pages so that the user can navigate to them directly.",
  },
  chatAgentic: {
    section: "chat",
    title: "Agentic Mode",
    description: "Added to the system message when a chat has agent mode on.",
    settingKey: "prompt_chat_agentic",
    default:
      "[AGENTIC MODE ACTIVE: HIGH AUTONOMY & MULTI-STEP REASONING REQUIRED]\n" +
      "You are running in AGENTIC mode. Your primary objective is to solve the user's request thoroughly, even if it requires a complex, multi-step process. " +
      "Follow these guidelines strictly:\n" +
      "1. BE PROACTIVE WITH TOOLS: Do not hesitate to call multiple tools in sequence. If you need more information to answer a question or perform an action, run the tools necessary to get it. Do not ask the user for permission to search or query if you have tools available to find the answer yourself.\n" +
      "2. THINK STEP-BY-STEP: Before calling tools or answering, analyze what you need to solve the request. Write down a clear plan or mental model, and execute it step-by-step. If one tool call doesn't yield the result, try a different tool or strategy.\n" +
      "3. MULTI-STEP INVESTIGATION: If the user's request is broad or ambiguous, use search tools (like person_search, super_search, social_account_search, etc.) to discover clues, and then pull full details (using person_pull, etc.) for any relevant entities. Don't stop at the first result; verify facts, explore relationships, and cross-reference details across different entities.\n" +
      "4. GENERATE PLANS: When dealing with complex questions (e.g., finding connections, compiling summaries, or solving data discrepancies), outline your steps and explain your reasoning clearly to the user. Do not give up easily or return partial answers when further tool execution could provide the complete picture.",
  },
  chatAskUser: {
    section: "chat",
    title: "Asking the User Questions",
    description: "Added to the system message when the ask_user tool is enabled.",
    settingKey: "prompt_chat_ask_user",
    default:
      "[ASKING THE USER QUESTIONS]\n" +
      "You have an ask_user tool. Calling it pauses your turn and shows the user a short form; their answers come back as the tool result and you then continue in the same turn. " +
      "Use it only when a decision genuinely depends on the user: the request is ambiguous, required information is missing, or you must choose between materially different actions. " +
      "Do NOT use it for anything you can look up with your other tools, and never just to confirm you understood. " +
      "Ask at most 3 questions per call and batch related questions into one call rather than asking one at a time. Keep every question short and self-contained.\n" +
      "Question types: " +
      "true_false for a yes/no decision; " +
      "multiple_choice for 2–4 mutually exclusive options (an 'Other' free-text option is offered automatically, so the user can give a more nuanced answer if your choices don't fit — set allowOther to false only when the answer must be one of your choices); " +
      "open_ended for free text you cannot enumerate; " +
      "slider for degree, intensity, or preference — set lowLabel and highLabel to describe the two ends; the answer arrives as a number from 0 (low) to 100 (high).\n" +
      "When the answers arrive, act on them immediately and do not re-ask. If the result says the user skipped, proceed with a sensible default and state the assumption you made.",
  },
  chatSummarize: {
    section: "chat",
    title: "Message Chain Summarizer",
    description: "System prompt for the tool that condenses a message chain.",
    settingKey: "prompt_chat_summarize",
    appended: "The message chain and any highlight request are sent as the user message.",
    default:
      "You are an expert AI summarizer. Your task is to condense large conversation logs and chat history into short, high-density, accurate summaries. Focus on extracting key dates, facts, plans, and answers to any special highlight instructions, removing all filler and small talk.",
  },
  dailyNoteEvents: {
    section: "dailyNotes",
    title: "Event Extraction",
    description: "System prompt for extracting events from a daily note's markdown body.",
    settingKey: "ai_events_prompt",
    appended: "The model is also constrained at the API level to return JSON shaped { events: [{ text }] }.",
    default: [
      "You extract a list of distinct events from a daily journal entry.",
      "An \"event\" is a concrete thing that happened that day: meetings, calls, meals, travel, milestones, decisions, conversations, or notable observations.",
      "Each event must be a short, standalone past-tense statement (one sentence, ideally under 120 characters).",
      "Do not include opinions, plans for the future, or generic reflections. Do not invent events that aren't supported by the text.",
      "Return strictly the JSON shape requested by the schema: { \"events\": [ { \"text\": string } ] }. If no events are present, return { \"events\": [] }.",
    ].join(" "),
  },
  imageDescribe: {
    section: "images",
    title: "Image Description",
    description: "Sent to the vision model when describing a stored photo.",
    settingKey: "ai_vision_prompt",
    appended: "Names of recognized faces are appended.",
    default: "Return 2 sentences explaining what is happening in this image.",
  },
  summaryScene: {
    section: "summaries",
    title: "Image Scene Description",
    description: "Sent to the scene model for each image in a post.",
    settingKey: "summary_scene_prompt",
    appended: "Recognized people, known facts and user corrections are appended.",
    default:
      "Describe the scene in this image in 2-3 sentences: the setting, people, actions, notable objects, and any visible text.",
  },
  summaryPost: {
    section: "summaries",
    title: "Post Summary",
    description: "Combines a post's scene descriptions into one summary.",
    settingKey: "summary_post_prompt",
    appended: "The word limit and the data-tags safety note are appended.",
    default:
      "Combine the image scene descriptions below into a concise 2-4 sentence summary of this social media post or story. Focus on what is happening, who is involved, where it takes place, and the overall intent or takeaway.",
  },
  summaryStory: {
    section: "summaries",
    title: "Story Summary",
    description: "Summarizes a story from its images or video transcript.",
    settingKey: "summary_story_prompt",
    appended: "The word limit and the data-tags safety note are appended.",
    default:
      "Summarize this social media story in 2-4 sentences. Focus on what is happening, who is involved, where it takes place, and the overall intent or takeaway.",
  },
  summaryAccount: {
    section: "summaries",
    title: "Account Summary",
    description: "Synthesizes post and story summaries into an account profile.",
    settingKey: "summary_account_prompt",
    appended: "The connections guide and the data-tags safety note are appended.",
    default:
      "Synthesize the chronological post and story summaries below into a structured profile summary of this social media account. Cover: 1) Identity & lifestyle overview, 2) Key interests & recurring themes, 3) Frequently seen people & locations, 4) Notable events or timeline changes, and 5) Closest connections: who this account interacts with most, how (comments, mentions, bio), whether it's mutual, and any shift over time. Use the connections list for this and the posts for context about those people.",
  },
  summaryNotes: {
    section: "summaries",
    title: "Notes From Corrections",
    description: "Pulls durable facts out of a user's correction to an AI description.",
    settingKey: "summary_notes_prompt",
    appended: "The data-tags safety note is appended.",
    default:
      "The user corrected an AI description of a photo. From the correction, pull out durable facts about the listed candidates that later summaries should know: relationships (e.g. the child is a nephew, not a son), whose house, car or pet something is, identities, and similar lasting facts. Skip anything only true of this one photo and anything already in a candidate's existing notes. Reply with only a JSON array like [{\"target\": \"C1\", \"note\": \"One sentence.\"}], or [] when there is nothing durable.",
  },
  describeMe: {
    section: "people",
    title: "Describe Me Extraction",
    description: "Turns a spoken description of a person into proposed interactions, notes and tags.",
    settingKey: "prompt_describe_me",
    appended: "Today's date and the data-tags safety note are appended.",
    default: `You analyze a spoken, informal description of a person and extract structured information for their contact profile.

You have 3 tools to propose updates for this person:
1. create_potential_interaction: Call for any interactions, meetings, conversations, or events mentioned (resolve relative dates like "yesterday", "last weekend" using today's date, given below).
2. create_potential_note: Call for general facts, personal background, preferences, hobbies, and traits (write in third person, concise, no conversational filler).
3. create_potential_tags: Call to propose keyword tags (skills, roles, locations, hobbies).

Call all relevant tools. If your environment does not support native function/tool calling, respond with ONLY a JSON object:
{
  "interactions": [ { "title": "...", "date": "YYYY-MM-DD", "description": "...", "type": "..." } ],
  "notes": [ { "title": "...", "content": "..." } ],
  "tags": [ "tag1", "tag2" ]
}`,
  },
  findName: {
    section: "people",
    title: "Find Name From Messages",
    description: "Guesses who an unknown phone number belongs to from a conversation's first messages.",
    settingKey: "prompt_find_name",
    appended: "The data-tags safety note is appended.",
    default: `You identify the real name of the person behind an unknown phone number from the opening messages of a text conversation.
Look for introductions ("Hi, it's Sarah from the gym"), sign-offs, how the owner addresses them, and names others use for them.
Respond with ONLY a JSON object, no prose:
{"firstName": string|null, "lastName": string|null, "confidence": "high"|"medium"|"low", "reason": string}
Use null for any part of the name the messages do not support. Keep "reason" to one sentence quoting the decisive message.`,
  },
  groupExplainer: {
    section: "groups",
    title: "Group Explainer",
    description: "Explains why community detection grouped a set of accounts and suggests a name.",
    settingKey: "prompt_group_explainer",
    appended: "The data-tags safety note is appended. The reply is constrained to { explanation, suggestedName, outliers } JSON.",
    default: `You explain why a community-detection algorithm (Louvain) grouped a set of social media accounts together.
The graph combined these signals into weighted edges between accounts:
- mutualFollow: both accounts follow each other (strong, 3.5 per pair)
- oneWayFollow: one follows the other (1.0 per pair)
- coFollow: they follow many of the same accounts (shared audience/interests)
- coMention: they were tagged together in the same posts (2.5 per post)
- bio: their bios share uncommon keywords
Reply as JSON:
- explanation: 2-4 plain sentences on why these accounts form a group. Lead with the signals that carry the most weight and cite concrete evidence (shared follows, keywords, hub accounts). Don't restate raw percentages mechanically.
- suggestedName: a short, human group name (2-5 words) describing what the group likely is (e.g. "Denver climbing crew"). No @handles.
- outliers: for each account listed in weak_members, one short reason it fits the group weakly. Only use usernames from weak_members; return [] if there are none.`,
  },
} satisfies Record<string, PromptDef>;

export type PromptKey = keyof typeof PROMPT_DEFS;

export function isPromptKey(key: string): key is PromptKey {
  return Object.hasOwn(PROMPT_DEFS, key);
}

export async function getPrompt(key: PromptKey): Promise<string> {
  const def: PromptDef = PROMPT_DEFS[key];
  return (await storage.getAppSetting(def.settingKey))?.trim() || def.default;
}

export async function setPrompt(key: PromptKey, value: string): Promise<void> {
  const def: PromptDef = PROMPT_DEFS[key];
  await storage.setAppSetting(def.settingKey, value.trim() === def.default ? "" : value);
}

export async function listPrompts() {
  return Promise.all(
    (Object.entries(PROMPT_DEFS) as [PromptKey, PromptDef][]).map(async ([key, def]) => {
      const value = await getPrompt(key);
      return {
        key,
        section: def.section,
        title: def.title,
        description: def.description,
        appended: def.appended ?? null,
        value,
        default: def.default,
        modified: value !== def.default,
      };
    }),
  );
}
