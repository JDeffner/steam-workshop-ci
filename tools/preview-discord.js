#!/usr/bin/env node
// Post a release announcement to a Discord webhook without cutting a release.
//
// The workflow can only announce after a real Steam upload, which makes the
// look of the message awkward to iterate on. This posts the same payloads
// against a webhook of your choosing, so you can see both shapes in a channel
// and decide which one a repository should use.
//
//   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... \
//     node tools/preview-discord.js [--format message|embed|both] [--section 1.2.0]
//
// Reads CHANGELOG.md and workshop/item.json from the working directory, the
// same two files the workflow reads. --section picks which version's notes to
// send; the newest one is used when it is left out.
//
// The webhook URL is a bearer credential: anyone holding it can post to that
// channel. Pass it in the environment, never on the command line, where it
// would land in your shell history.
"use strict";

const fs = require("fs");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const die = (message) => { console.error(`error: ${message}`); process.exit(1); };

const webhook = process.env.DISCORD_WEBHOOK_URL || "";
if (!webhook) die("set DISCORD_WEBHOOK_URL in the environment");

const format = arg("format", "both");
if (!["message", "embed", "both"].includes(format)) die(`--format must be message, embed or both, not "${format}"`);

const changelogFile = arg("changelog", "CHANGELOG.md");
const workshopDir = arg("workshop-dir", "workshop");
for (const f of [changelogFile, `${workshopDir}/item.json`]) {
  if (!fs.existsSync(f)) die(`${f} is missing — run this from the mod repository's root`);
}

// The same section reader the workflow uses.
const sections = (text) => {
  const found = [];
  let current = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const head = line.match(/^## +(\S+)/);
    if (head) { current = { version: head[1].replace(/^v/i, ""), lines: [] }; found.push(current); continue; }
    if (current) current.lines.push(line);
  }
  return found.map((s) => ({ version: s.version, body: s.lines.join("\n").trim() }));
};

const all = sections(fs.readFileSync(changelogFile, "utf8"));
if (!all.length) die(`${changelogFile} has no "## <version>" sections`);
const wanted = arg("section", "");
const picked = wanted ? all.find((s) => s.version === wanted.replace(/^v/i, "")) : all[0];
if (!picked) die(`${changelogFile} has no "## ${wanted}" section. It has: ${all.map((s) => s.version).join(", ")}`);
if (!picked.body) die(`the "## ${picked.version}" section of ${changelogFile} is empty`);

const item = JSON.parse(fs.readFileSync(`${workshopDir}/item.json`, "utf8"));
const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${String(item.publishedfileid)}`;
const heading = `${item.title} v${picked.version}`;
const markdown = picked.body;

// ---------------------------------------------------------------------------
// Kept in step with the "Announce the release on Discord" step of
// .github/workflows/mod-ci.yml. Change one, change the other.
// ---------------------------------------------------------------------------
const fit = (text, room) => {
  if (text.length <= room) return text;
  const cut = text.slice(0, room - 2);
  const nl = cut.lastIndexOf("\n");
  return `${(nl > 0 ? cut.slice(0, nl) : cut).trimEnd()}\n…`;
};

const linkify = (text) => text
  .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?\s*\)/g, "[$1](<$2>)")
  .replace(/(?<![<(])\bhttps?:\/\/[^\s<>()]+/g, (u) => {
    const tail = (u.match(/[.,;:!?]+$/) || [""])[0];
    return `<${u.slice(0, u.length - tail.length)}>${tail}`;
  });

const asMessage = () => {
  const body = markdown
    .replace(/^([ \t]*)#{4,} +/gm, "$1### ")
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : linkify(part)))
    .join("")
    .trim();
  const head = `## ${heading}`;
  const foot = `-# [View on the Steam Workshop](<${url}>)`;
  const room = 2000 - head.length - foot.length - "\n\n\n\n".length;
  return { content: `${head}\n\n${fit(body, room)}\n\n${foot}`, flags: 4 };
};

const asEmbed = () => ({
  embeds: [{
    title: heading,
    url,
    description: fit(markdown.replace(/^[ \t]*#{1,6} +(.*)$/gm, "**$1**").trim(), 4096),
    color: 3447003,
  }],
});
// ---------------------------------------------------------------------------

const post = async (label, payload) => {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
  const size = payload.content ? `${payload.content.length}/2000 chars` : `${payload.embeds[0].description.length}/4096 chars`;
  if (res.ok) console.log(`${label}: posted, ${size}`);
  else console.log(`${label}: Discord answered ${res.status} — ${(await res.text()).slice(0, 300)}`);
};

(async () => {
  console.log(`Announcing "${heading}" from the "## ${picked.version}" section of ${changelogFile}.\n`);
  if (format !== "embed") await post("message", asMessage());
  if (format !== "message") await post("embed  ", asEmbed());
})().catch((e) => die(e.message));
