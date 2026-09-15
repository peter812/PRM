/**
 * Checks the message classifier and the SMS Backup & Restore parser.
 *
 *   npx tsx scripts/test-message-import.ts
 *
 * Nothing here touches the database. The parser half runs against the sample
 * export in attached_assets/, so it also documents how many of that file's
 * messages the "skip automated" option would drop.
 */
import fs from "fs";
import { classifyMessage, type AutomatedCategory } from "../server/message-classifier";
import { parseSmsBackup } from "../server/sms-import";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

function classifies(text: string, expect: AutomatedCategory | null) {
  const actual = classifyMessage(text);
  check(`${JSON.stringify(text.slice(0, 60))} → ${expect}`, actual === expect, `actual ${actual}`);
}

console.log("classifier: security codes are dropped");
classifies("Your ExampleCo verification code is 482913", "security_code");
classifies("G-582910 is your Google verification code.", "security_code");
classifies("Use 7731 as your login code. Do not share this code with anyone.", "security_code");
classifies("Your one-time passcode: 993211. It expires in 10 minutes.", "security_code");
classifies("Your Apple Account code is: 552916. Don't share it with anyone.", "security_code");
classifies("Your access code 48213 is valid for 5 minutes", "security_code");

console.log("classifier: shipping / transactional / promotional");
classifies(
  "ACCREDO: Your order has shipped. Check its status at FedEx Tracking https://www.fedex.com/fedextrack/?trknbr=459504207962 . Reply HELP for help, STOP to cancel. Msg&data rates may apply",
  "shipping",
);
classifies("USPS: Your package is out for delivery. Track: https://tools.usps.com/go/x", "shipping");
classifies("Amazon: Delivered. Your package was left near the front door. https://a.co/d/x", "shipping");
classifies("Your order confirmed! View your receipt at https://sq.com/r/abc", "transactional");
classifies("Appointment reminder: Dr. Lee, Tue 3pm. Reply C to confirm or STOP to opt out.", "transactional");
classifies("New voicemail from +1 206-795-3558 (00:01):\n\nNo transcript available.\n\nTo listen to this message, call +1 650-503-4700.", null);
classifies("ACCREDO: Your medicine is due to be filled. Call us at 8006896592 to place your order. Reply HELP for help, STOP to cancel. Msg&data rates may apply", "transactional");
classifies("Flash sale! Save 40% today only. Shop now: https://shop.example/x Reply STOP to unsubscribe", "promotional");
classifies("From EWU - Win $150 Eagle Flex Cash! Register for the Fall term by Sunday. Register here: https://inside.ewu.edu/x", "promotional");
classifies("Reply STOP to opt out. Msg&data rates may apply.", "promotional");

console.log("classifier: platform echoes");
classifies("Liked a message", "system_noise");
classifies("Loved “Plan for CG tomorrow:\n-Eat pizza at our place arou…”", "system_noise");
classifies("Reacted ❤️ to your message", "system_noise");

console.log("classifier: real conversation is kept");
classifies("did your package arrive yet?", null);
classifies("Bro I thought these were photoshop but I think this is a real camera", null);
classifies("my tracking number says delivered but nothing here, can you check the porch?", null);
classifies("ok see you at 5:30, I'll bring the pizza", null);
classifies("Plan for CG tomorrow:\n-Eat pizza at our place around 5:30", null);
classifies("call me at 5093591185 when you land", null);
classifies("the code for the gate is 4471", null);

console.log("classifier: account-safety alerts are kept");
classifies("Chase: Unusual activity on your card ending 4412. If this wasn't you, call 800-935-9935. Code 553127", null);
classifies("Your password was changed. If this wasn't you, reset it now: https://example.com/reset", null);

console.log("parser: sample SMS Backup & Restore export");
const sample = fs.readdirSync("attached_assets").find((f) => /^sms-example.*\.xml$/.test(f));
if (!sample) {
  check("attached_assets/sms-example*.xml present", false);
} else {
  const { threads, ownerPhone } = parseSmsBackup(fs.readFileSync(`attached_assets/${sample}`, "utf-8"));
  const all = threads.flatMap((t) => t.messages);
  check(`owner phone detected (${ownerPhone})`, ownerPhone === "15092902463");
  check(`threads parsed (${threads.length})`, threads.length > 0);
  check("every thread has ≥1 counterpart", threads.every((t) => t.addresses.length > 0));
  check("owner never listed as a group counterpart", threads.every((t) => t.addresses.length === 1 || !t.addresses.includes(ownerPhone!)));
  check("group MMS became a multi-address thread", threads.some((t) => t.addresses.length > 2));
  check("&#10; decoded to newlines", all.some((m) => m.content?.includes("\n")));
  check("no message has 'null' as content", all.every((m) => m.content !== "null"));
  check("every message has a valid date", all.every((m) => !Number.isNaN(m.sentAt.getTime())));
  check("externalIds unique", new Set(all.map((m) => m.externalId)).size === all.length);
  check("received messages carry a sender", all.filter((m) => !m.isOwner).every((m) => m.senderAddress));

  const tally: Record<string, number> = {};
  for (const m of all) {
    const c = m.content && !m.hasMedia ? classifyMessage(m.content) : null;
    if (c) tally[c] = (tally[c] ?? 0) + 1;
  }
  const automated = Object.values(tally).reduce((n, c) => n + c, 0);
  console.log(`  info ${all.length} messages in ${threads.length} threads; skip-automated would drop ${automated}: ${JSON.stringify(tally)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
