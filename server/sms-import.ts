/**
 * Parser for "SMS Backup & Restore" (SyncTech) XML exports.
 *
 * Groups every <sms> and <mms> into threads keyed by the set of counterpart
 * numbers, so a 1:1 thread and a group MMS each become one conversation.
 * Attribute-regex parsing is deliberate: files reach hundreds of MB and are
 * flat, so a DOM is not worth its memory.
 */
import crypto from "crypto";
import { cleanPhoneNumberForStorage } from "@shared/schema";
import { unescapeXml } from "./xml-utils";

export interface ParsedSmsMessage {
  externalId: string;
  sentAt: Date;
  /** Sent from the backup owner's phone */
  isOwner: boolean;
  /** Normalized counterpart number; null for owner messages */
  senderAddress: string | null;
  /** Null when the MMS carried only media */
  content: string | null;
  hasMedia: boolean;
}

export interface ParsedSmsThread {
  /** Sorted counterpart numbers joined by "," — stable identity across re-imports */
  key: string;
  addresses: string[];
  /** contact_name from the backup, when the phone had one */
  contactName: string | null;
  messages: ParsedSmsMessage[];
}

function attr(el: string, name: string): string {
  const m = el.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`));
  const v = m ? (m[1] ?? m[2]) : "";
  return v === "null" ? "" : unescapeXml(v);
}

function contactNameOf(el: string): string | null {
  const name = attr(el, "contact_name");
  return name && name !== "(Unknown)" ? name : null;
}

function externalId(parts: string[]): string {
  return `sms:${crypto.createHash("md5").update(parts.join("|")).digest("hex").slice(0, 16)}`;
}

export function parseSmsBackup(xml: string): { threads: ParsedSmsThread[]; ownerPhone: string | null } {
  // MMS addr type 151 is the device owner
  const ownerPhone = cleanPhoneNumberForStorage(attr(xml.match(/<addr [^>]*type="151"[^>]*\/>/)?.[0] ?? "", "address"));
  const threads = new Map<string, ParsedSmsThread>();

  const add = (addresses: string[], contactName: string | null, msg: ParsedSmsMessage) => {
    const key = [...new Set(addresses)].sort().join(",");
    if (!key) return;
    let thread = threads.get(key);
    if (!thread) {
      thread = { key, addresses: key.split(","), contactName: null, messages: [] };
      threads.set(key, thread);
    }
    thread.contactName ??= contactName;
    thread.messages.push(msg);
  };

  for (const el of xml.match(/<sms [^>]*\/>/g) ?? []) {
    const address = cleanPhoneNumberForStorage(attr(el, "address"));
    const date = attr(el, "date");
    const body = attr(el, "body");
    if (!address || !date || !body) continue;
    const isOwner = attr(el, "type") !== "1";
    add([address], contactNameOf(el), {
      externalId: externalId([date, address, body]),
      sentAt: new Date(parseInt(date)),
      isOwner,
      senderAddress: isOwner ? null : address,
      content: body,
      hasMedia: false,
    });
  }

  for (const el of xml.match(/<mms [^>]*>[\s\S]*?<\/mms>/g) ?? []) {
    const date = attr(el, "date");
    if (!date) continue;
    const isOwner = attr(el, "msg_box") !== "1";

    let from: string | null = null;
    const others: string[] = [];
    for (const a of el.match(/<addr [^>]*\/>/g) ?? []) {
      const address = cleanPhoneNumberForStorage(attr(a, "address"));
      if (!address || address === ownerPhone) continue;
      if (attr(a, "type") === "137") from = address;
      others.push(address);
    }
    // Older exports have no <addrs>; the address attr is tilde-joined
    if (others.length === 0) {
      for (const raw of attr(el, "address").split("~")) {
        const address = cleanPhoneNumberForStorage(raw);
        if (address && address !== ownerPhone) others.push(address);
      }
      from = others[0] ?? null;
    }

    const texts: string[] = [];
    let hasMedia = false;
    for (const part of el.match(/<part [^>]*\/>/g) ?? []) {
      const ct = attr(part, "ct");
      if (ct === "text/plain") texts.push(attr(part, "text"));
      else if (/^(image|video|audio)\//.test(ct)) hasMedia = true;
    }
    const content = texts.join("\n").trim() || null;
    if (!content && !hasMedia) continue;

    add(others, contactNameOf(el), {
      externalId: externalId([date, others.join(","), content ?? "media"]),
      sentAt: new Date(parseInt(date)),
      isOwner,
      senderAddress: isOwner ? null : from,
      content,
      hasMedia,
    });
  }

  for (const t of threads.values()) t.messages.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  return { threads: [...threads.values()], ownerPhone };
}
