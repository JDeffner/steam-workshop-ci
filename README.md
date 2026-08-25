# steam-workshop-ci

A reusable GitHub Actions workflow that publishes a Steam Workshop item from a
git repository. Bump a version line, push, and the item updates. Do anything
else and the Workshop is left alone.

It was written for three Crusader Kings III mods, but nothing in the workflow
knows what CK3 is. The game is an AppID you pass in, the version is a regex
you choose, the folder that ships is a path. CK3 is the worked example
throughout because it is the case that runs in production; every step below
names the general rule next to it.

## What happens when

| The event | The outcome |
|---|---|
| Pull request | The tree and the metadata are validated. Nothing is uploaded. |
| Push to `main`, version line changed | **Release.** Content folder, preview image and a change note taken from the changelog section for that version. |
| Push to `main`, metadata folder changed, version unchanged | **Listing update.** Title and description only. No content, no change note, so Steam records no new update entry. |
| Push to `main`, neither changed | Nothing. |
| Push of a tag, with `release_on: tag` | **Release.** |
| Manual run (`workflow_dispatch`) | Listing update, unless `mode` says otherwise. |

Bumping the version is the release action. That is the whole design: work merges
freely, and publishing is one deliberate edit.

Only the repository's default branch publishes. The workflow checks that
itself, so a push to any other branch validates and stops even when the
caller's `on:` block carries no branch filter. A tag push is exempt, since
that is the point of `release_on: tag`.

Two uploads never run at once. The publish job queues per item, so merging
twice in quick succession sends the second upload after the first, and neither
is cancelled.

## Before you start

**The Workshop item has to exist already.** This workflow updates an item, it
never creates one. Upload once by hand — from the game's own mod tools, the
launcher, or the Workshop web page — then take the numeric id out of the item's
URL: `steamcommunity.com/sharedfiles/filedetails/?id=3012345678`. Creating items
from CI would mean a manifest with no id, which makes a *new* item on every run,
and writing the fresh id back into the repository needs push rights the workflow
deliberately does not have.

**You need the AppID of the game.** It is the number in the store page URL:
`store.steampowered.com/app/1158310/Crusader_Kings_III/` → `1158310`.

**You need a Steam account that owns the item**, and one SteamCMD session
exported from your own machine. See [Steam credentials](#steam-credentials).

## Setting it up, with a CK3 mod as the example

### 1. Lay out the repository

Two folders: the one that ships, and the one that describes the listing.

```
mod/                          uploaded to the Workshop verbatim
  descriptor.mod              version="1.4.2", the release trigger
  thumbnail.png               the preview image, 1 MB maximum
  common/ events/ ...         the mod itself
workshop/                     never uploaded as files, only read
  item.json                   {"title": "...", "publishedfileid": "3012345678"}
  description.bbcode          the listing body, Steam BBCode, 8000 chars max
  german/title.txt            optional localized listing
  german/description.bbcode
CHANGELOG.md                  the change note for each version
.github/workflows/ci.yml      the caller, below
```

(`tools/` in *this* repository holds the preview helper described under
[Discord announcements](#discord-announcements); a mod repository needs no such
folder.)

Both folder names are inputs. A RimWorld repo can call them `Mod/` and `steam/`;
nothing cares as long as the paths match what the caller passes.

The content folder is uploaded exactly as it sits, so anything inside it ships.
Validation blocks the usual accidents — `__pycache__`, `.pyc`, `.claude`, a real
`.git` directory, an empty folder — but that list is not a substitute for looking
at what you committed.

### 2. Write the listing metadata

`workshop/item.json` needs two keys:

```json
{
  "title": "Better Bastards",
  "publishedfileid": "3012345678"
}
```

`workshop/description.bbcode` is the Workshop description, in Steam's BBCode.
Write it the way you want it to appear; the workflow uploads it byte for byte,
apart from the quote handling described [further down](#a-note-on-quotes).

A CK3 descriptor already carries the item id as `remote_file_id`. When it does,
the two are cross-checked, and a mismatch fails the run before anything is
uploaded — that check is what stops a copied repository from publishing over
somebody else's item. Other games have no such field, and the check then
skips silently.

### 3. Add the caller workflow

`.github/workflows/ci.yml` in the mod's repository:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  ci:
    uses: JDeffner/steam-workshop-ci/.github/workflows/mod-ci.yml@main
    with:
      app_id: "1158310"
      content_dir: mod
      preview_file: mod/thumbnail.png
      version_file: mod/descriptor.mod
    secrets:
      STEAM_USERNAME: ${{ secrets.STEAM_USERNAME }}
      STEAM_CONFIG_VDF: ${{ secrets.STEAM_CONFIG_VDF }}
      DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

`app_id` and `content_dir` are the only required inputs. `version_pattern`
already matches a Paradox descriptor, which is why the CK3 caller does not set
it; `id_pattern` already matches `remote_file_id`.

`secrets: inherit` works too and passes every secret the repository holds. Name
the two explicitly when the repository holds others. A pull request from a fork
never receives secrets at all, because the caller runs on `pull_request` and not
on `pull_request_target`.

Ready-made callers live in [`examples/`](examples): a minimal one, the CK3 one,
and a tag-driven one.

### 4. Store the two secrets

`STEAM_USERNAME` and `STEAM_CONFIG_VDF`, on the mod's repository. The
[Steam credentials](#steam-credentials) section has the exact commands.

### 5. Prove it on a pull request first

Open a pull request with the workflow in it. Both validation steps run and
nothing can be uploaded, whatever the branch contains. The metadata step prints
what it found:

```
ok: "Better Bastards", item 3012345678, 1240 chars of description, localized: german
```

If you want to watch a real upload before pointing it at a mod people use,
upload a throwaway item by hand, put its id in `workshop/item.json`, and let one
release run against that.

### 6. Release

Bump `version=` in the descriptor, merge to `main`. The run logs its decision in
the job summary:

```
release — Version went 1.4.1 -> 1.4.2, publishing.
```

Merge anything else and it says so instead: `Version is still 1.4.2, so nothing
is published.` That line is a normal outcome, not a failure.

## Inputs

| Input | Required | Default | What it is |
|---|---|---|---|
| `app_id` | yes | — | The Steam AppID that owns the item. |
| `content_dir` | yes | — | The folder uploaded to the Workshop, verbatim. |
| `workshop_dir` | no | `workshop` | Where `item.json`, `description.bbcode` and the localized folders live. |
| `preview_file` | no | *(none)* | The preview image, 1 MB maximum. Empty leaves the item's current image alone. |
| `version_file` | no | *(none)* | The file holding the version line. Required when `release_on` is `version`. |
| `version_pattern` | no | `^version="(.*)"` | Regex, matched multiline, whose first group is the version. |
| `id_pattern` | no | `^remote_file_id="([0-9]+)"` | Regex whose first group is the item id inside `version_file`, cross-checked against `item.json`. Empty disables the check. |
| `changelog_file` | no | `CHANGELOG.md` | The Markdown changelog whose `## <version>` section becomes the change note. |
| `discord_format` | no | `message` | `message` or `embed` — the shape of the Discord announcement. |
| `release_on` | no | `version` | `version` or `tag` — what counts as a release. |
| `mode` | no | `auto` | `auto`, `release`, `listing` or `validate`. Overrides the decision. |

The item id itself always comes from `publishedfileid` in `item.json` and is
required.

## Choosing a release trigger

**`release_on: version`** watches one line in one file. The workflow compares
the version at the commit the push started from against the version at its tip,
so a push carrying five commits still releases when the bump sits in the middle
of them.

`version_pattern` is any regex with one capture group, matched with the `m`
flag. These are tested and work:

| The file looks like | `version_pattern` |
|---|---|
| `version="1.4.2"` (Paradox descriptor) | `^version="(.*)"` |
| `"version": "1.4.2",` (JSON manifest) | `^\s*"version"\s*:\s*"([^"]*)"` |
| `<version>1.4.2</version>` (XML) | `<version>([^<]*)</version>` |
| `version: 1.4.2` (YAML) | `^version:\s*(.+)$` |
| `version = "1.4.2"` (Lua, TOML) | `version\s*=\s*"([^"]*)"` |
| a `VERSION` file holding just `1.4.2` | `^(.+)$` |

Check yours before pushing:

```
node -e 'console.log(require("fs").readFileSync("mod/descriptor.mod","utf8").match(/^version="(.*)"/m)[1])'
```

**`release_on: tag`** is for items whose files carry no version number anywhere.
Push `v1.4.2` and it publishes as `1.4.2`; the leading `v` is stripped. Ordinary
pushes to `main` can still send listing updates. No `version_file` is needed:

```yaml
on:
  push:
    branches: [main]
    tags: ['v*']

    # ...
    with:
      app_id: "0000000"
      content_dir: content
      release_on: tag
```

When both a version file and a tag are present, the file wins as the *name* of
the release and the tag remains the *trigger*.

## Forcing a mode

`mode` overrides the whole decision, which is how you re-send a listing that
Steam mangled, or push a release without a version bump:

| `mode` | Effect |
|---|---|
| `auto` | Decide from the event. The default. |
| `release` | Upload content, preview and change note. |
| `listing` | Title and description only. |
| `validate` | Validate and stop, whatever the event was. |

Wiring it to a dropdown in the caller:

```yaml
on:
  workflow_dispatch:
    inputs:
      mode:
        type: choice
        default: listing
        options: [listing, release, validate]

    # ...
    with:
      mode: ${{ inputs.mode || 'auto' }}
```

Forcing `release` or `listing` on a `pull_request` event is refused with an
error. Everything else is the caller's call.

## Change notes

The changelog is the one source of release notes. `changelog_file` says where
it is; by default that is `CHANGELOG.md` at the repository root, in Keep a
Changelog style:

```markdown
# Changelog

## 1.1.0 - 2026-08-21
### Added
- Record Their Name asks which records to write to.
### Fixed
- The die no longer renders as a black blob.

## 1.0.0 - 2026-08-19
- First release.
```

A section starts at `## <version>`. The first token of that line is the
version and everything after it (the date) is ignored. A leading `v` on either
side is ignored too, so `## v1.1.0` matches version `1.1.0`. The section runs
to the next `## ` or to the end of the file. The `### Added|Changed|Fixed|Removed`
subsections are optional; a plain bullet list is just as good.

**A release whose version has no section fails validation.** When a release is
on the cards, CI requires a section for exactly that version with a non-empty
body, and says so with an `::error::` when there is none. A pull request that
bumps the version is checked the same way, so the section is there before the
merge that publishes. When the version did not change, the changelog is not
looked at and ordinary commits merge freely.

The section is then converted to BBCode, prefixed with a `v<version>` line, and
sent as the Workshop change note (capped at Steam's 8000 characters). The
conversion is deliberately small:

| Markdown | BBCode |
|---|---|
| `### Added` | `[b]Added[/b]` |
| a run of `- ` or `* ` lines | one `[list]` of `[*]` items |
| `**bold**` | `[b]bold[/b]` |
| `_italic_`, `*italic*` | `[i]italic[/i]` |
| `` `code` `` | the text, backticks removed |
| `[text](url)` | `[url=url]text[/url]` |
| a blank line | a single blank line |

A listing update sends no change note at all.

## Discord announcements

After a successful release, and only for a release, the workflow posts the
changelog section to the webhook in `DISCORD_WEBHOOK_URL`.

By default it is a **plain message, not an embed.** An embed is pinned to a
narrow column on the desktop client whatever the window is doing, while
ordinary message content runs the full width of the channel — which is what a
bullet list of changes wants. The message looks like this:

```
## Better Bastards v1.4.2

### Added
- A **new** court position, the *Master of Hounds*
- `remote_file_id` is cross-checked against the listing

### Fixed
- Kennels no longer vanish on succession

-# [View on the Steam Workshop](<…>)
```

Discord renders Markdown in message content, so the section goes out very
nearly as it is written in the changelog — headings, bullets, bold, italics and
code spans all survive untouched. Three things are adjusted on the way:

- Discord's headings stop at `###`, so `####` and deeper are flattened to it.
- Every link is wrapped in `<…>`, which stops the client from hanging a preview
  card underneath — that card would be the embed this is avoiding. Links inside
  code spans and fenced blocks are left alone, since they are being shown
  rather than linked, and sentence punctuation after a bare URL stays outside
  the link.
- Message content is capped at 2000 characters, rather than the 4096 an embed
  description allows. A longer section is cut on a line boundary and marked
  with an `…`, so the message never ends mid-bullet.

Nothing in a changelog can ping the channel: the post sends
`allowed_mentions: {"parse": []}`, so an `@everyone` in the text renders as
text. Without the secret the step prints a notice and skips. A webhook that
refuses the post only warns, since the release has already happened.

### Going back to an embed

Set `discord_format: embed` on the caller when a repo wants the old shape:

```yaml
with:
  app_id: "1158310"
  content_dir: mod
  discord_format: embed
```

The embed carries the title and the Workshop link as fields of its own, plus
the colour bar down the side, and its description may run to 4096 characters
rather than 2000 — which is the one substantive reason to choose it, if a
release's notes are genuinely too long for a message.

The changelog is treated differently in each shape, because the two render
differently:

| | `message` (default) | `embed` |
|---|---|---|
| Width | Full channel width | A narrow fixed column |
| Limit | 2000 characters | 4096 characters |
| Headings | Kept, flattened to `###` | Turned into bold lines |
| Links | Wrapped in `<…>` | Left as written |
| Colour bar | None | Yes |

Headings become bold in the embed rather than staying as headings: `###`
renders in message content for certain, while embed descriptions are less
clear-cut, and bold renders in both. An embed grows no preview cards from its
own description, so links there need no wrapping.

The value is checked during validation, alongside `mode` and `release_on`, so a
typo fails the pull request rather than surfacing as the wrong shape after a
release has already gone out.

### Seeing it before you release

The workflow only announces after a real Steam upload, which is an awkward way
to find out that a message looked wrong. `tools/preview-discord.js` posts the
same payloads to a webhook of your choosing, from a checkout, without releasing
anything:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...   node tools/preview-discord.js
```

Run it from a mod repository's root; it reads that repository's `CHANGELOG.md`
and `workshop/item.json`, exactly as the workflow does. With no arguments it
sends both shapes, so you can compare them in the channel and pick one.

| Flag | Default | What it does |
|---|---|---|
| `--format` | `both` | `message`, `embed` or `both`. |
| `--section` | newest | Which changelog version to announce. |
| `--changelog` | `CHANGELOG.md` | Where to read the notes from. |
| `--workshop-dir` | `workshop` | Where to read `item.json` from. |

Point it at a webhook on a server nobody minds you posting to. The URL is a
bearer credential — anyone holding it can post to that channel — so pass it in
the environment rather than on the command line, where it would be written to
your shell history.

The tool and the workflow cannot share this code: a reusable workflow's `run:`
steps see the calling repository's checkout, not this one, which is why the
announce step is written inline. So the two copies are compared by this
repository's own CI instead, and a change to one without the other fails the
build.

## Localized listings

Steam shows a Workshop title and description per language. Put each one in
`<workshop_dir>/<language>/` with `title.txt` (one line, 128 chars max) and
`description.bbcode` (8000 chars max), where `<language>` is Steam's API
language code: `french`, `german`, `schinese`, `koreana`, `brazilian` and so on.
English stays in `item.json` and `description.bbcode`.

**These files are validated but never uploaded.** No headless way to set a
localized listing exists: the SteamCMD build manifest has no language field
(passing one returns Success and changes nothing), and the Web API's
`CPublishedFile_Update_Request` has none either. The folders are the source you
paste into the Workshop UI by hand, and CI only checks that the language code is
real and that the two size limits hold.

## Steam credentials

Each repository needs two secrets. SteamCMD cannot answer a Steam Guard prompt,
so it reuses a session you create once on your own machine.

1. Install SteamCMD locally and log in once, answering the Steam Guard prompt:

   ```
   steamcmd +login <username> +quit
   ```

2. Run it a second time. If it does not ask for a code again, the session is
   cached:

   ```
   steamcmd +login <username> +quit
   ```

3. Base64-encode the resulting `config/config.vdf` (next to the SteamCMD install
   on Windows, `~/Steam/config/config.vdf` on Linux) and store it as the
   repository secret `STEAM_CONFIG_VDF`. Store the account name as
   `STEAM_USERNAME`. With the GitHub CLI, from Git Bash:

   ```
   base64 -w0 /f/Programms/steamcmd/config/config.vdf | gh secret set STEAM_CONFIG_VDF -R JDeffner/<repo>
   gh secret set STEAM_USERNAME -R JDeffner/<repo> --body "<username>"
   ```

   PowerShell has no `base64`; use
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("F:\Programms\steamcmd\config\config.vdf"))`
   instead.

These sessions expire. When a publish fails with a Steam Guard message, repeat
the steps and replace `STEAM_CONFIG_VDF`.

A third secret, `DISCORD_WEBHOOK_URL`, is optional and only drives the
announcement. Create the webhook in the channel it should post to (Server
settings, then Integrations, then Webhooks), copy its URL and store it:

```
gh secret set DISCORD_WEBHOOK_URL -R JDeffner/<repo> --body "<url>"
```

Anyone holding that URL can post to the channel, so keep it a secret and never
echo it in a step.

## Pointing it at a different game

Four things change, and only four:

1. **`app_id`** — from the store page URL.
2. **`content_dir`** — whatever folder that game expects to receive.
3. **`version_file` and `version_pattern`** — from the recipes above. If the mod
   format has no version anywhere, switch to `release_on: tag` and skip both.
4. **`id_pattern`** — set it to empty unless the format mirrors the Workshop id
   the way a Paradox descriptor does.

Everything else is Steam, not the game: the 1 MB preview cap, the 8000-character
description, the language codes, the manifest quirks, the read-back check
against Steam's public API. Any AppID whose Workshop accepts a SteamCMD
`workshop_build_item` upload works the same way.

## Troubleshooting

| What you see | What it means |
|---|---|
| `no mod/ directory` | `content_dir` is wrong, or relative to the wrong place. Every path is relative to the repository root. |
| `mod/ holds no files` | The folder exists but is empty, and Steam would happily publish that. |
| `... has no line matching /^version="(.*)"/m` | `version_pattern` does not fit the file. Test it with the `node -e` line above. |
| `item.json publishedfileid X disagrees with mod/descriptor.mod Y` | The two ids point at different Workshop items. Fix whichever is stale. |
| `release_on is "version" but no version_file was given` | Set `version_file`, or switch to `release_on: tag`. |
| `STEAM_USERNAME and STEAM_CONFIG_VDF are not set` | The secrets are missing — or the run is a pull request from a fork, which never receives secrets. |
| `SteamCMD did not report success` | Nearly always an expired session: re-prime `STEAM_CONFIG_VDF`. Otherwise check that `app_id` really owns that item. |
| `Version is still 1.4.2, so nothing is published` | Working as intended. Bump the version to release. |
| `item ... is not publicly readable` | The read-back check skipped, which is normal for a hidden or unlisted item. |
| `The published description does not match` | A warning, not a failure. Look at how quotes and newlines survived the upload. |

## Trust model

The workflow reads the calling repository's checkout and the two secrets. It
sends the content folder, the preview image and the listing text to Steam
through SteamCMD, and after a publish it reads the item back from Steam's public
API to compare the description. When `DISCORD_WEBHOOK_URL` is set it also posts
the release announcement to that webhook. It talks to nothing else.

`STEAM_CONFIG_VDF` is a logged-in Steam session and grants full access to that
account, not just to Workshop uploads. Put it only in repositories you control,
where nobody else can add a workflow or a step that would print it. The workflow
never echoes it, runs no shell tracing, and requests only
`permissions: contents: read`. Third-party actions are pinned to a commit SHA.

## Three things this deliberately does not do

**Tags.** Steam's build manifest has no field for Workshop tags, so CI never
sets them. Existing tags survive an update untouched. Change them in the
Workshop UI.

**Visibility.** The manifest only understands public, friends-only and private.
It has no value for *unlisted*, so writing visibility at all could flip an
unlisted item public. Visibility stays a manual switch in the Workshop UI.

**Creating items.** An item with no id would be created fresh on every single
run. The id belongs in the repository, put there once by a human.

## A note on quotes

SteamCMD does not process escape sequences in `workshop_build_item`. A `\n` in
the manifest arrives at the Workshop as a backslash and an n, and a double quote
would end the value with no way to escape it. So the workflow writes newlines
raw, leaves backslashes alone, and rewrites double quotes in the title and the
description as typographic quotes, opening and closing by turns. Write `"` in
your BBCode if you like; the listing will show `“` and `”`.

Text inside square brackets is left alone, so a tag such as
`[url="https://example.com"]` keeps its straight quotes and still works.

## Upgrading from the version with CK3 defaults

The earlier workflow defaulted `app_id` to CK3, `content_dir` to `mod`,
`preview_file` to `mod/thumbnail.png` and `version_file` to
`mod/descriptor.mod`, so a CK3 caller could pass no inputs at all. Those
defaults are gone: a workflow that silently uploads to Crusader Kings III is
the wrong thing to hand somebody modding another game.

Existing callers follow `@main`, so they pick this up the moment it lands. Tag
the last commit before the change and pin them to that tag instead — worth doing
regardless, since `@main` means every caller inherits every future edit the
minute it is pushed:

```
git tag v1 <the commit before this change> && git push origin v1
```

```yaml
uses: JDeffner/steam-workshop-ci/.github/workflows/mod-ci.yml@v1
```

To move a caller to the general version, spell out what used to be implicit:

```yaml
with:
  app_id: "1158310"
  content_dir: mod
  preview_file: mod/thumbnail.png
  version_file: mod/descriptor.mod
```

**Every repository now needs a changelog.** The change note used to be built
from commit subjects; it is now the `## <version>` section of `CHANGELOG.md`,
and a release whose version has no section fails validation instead of
publishing. Write the section for the version you are about to release before
you bump it — a pull request that bumps the version is checked too, so the gap
shows up before the merge rather than after it.

Behaviour changes beyond that, all of them in the caller's favour:

- A release is now detected across a whole push rather than against the previous
  commit alone. A push whose version bump is not the tip commit used to be
  missed, and published nothing.
- Only the default branch publishes, checked by the workflow itself.
- Uploads for one item queue instead of running at once.
- `preview_file` may be omitted, which leaves the item's existing image alone.
- The metadata folder is `workshop_dir` and no longer hardcoded.
- `release_on: tag` and the `mode` override are new.
- An optional `DISCORD_WEBHOOK_URL` secret announces each release, as a
  full-width message by default or as an embed with `discord_format: embed`.

The repository used to be called `ck3-mod-ci`. GitHub redirects the old name,
so existing `uses: JDeffner/ck3-mod-ci/...` lines keep working after the
rename — but update them to `steam-workshop-ci` anyway, since the redirect
only holds until someone claims the old name.

## Self-test

This repository is other repositories' quality gate, so it has one of its
own in `.github/workflows/ci.yml`. It runs `actionlint` (with `shellcheck`,
which reads the `run:` bodies) on every change, checks that
`tools/preview-discord.js` still builds the same payloads as the announce step,
and on a pull request it calls `mod-ci.yml` against the fixture in `mod/` and
`workshop/`. That fixture is why a workflow repository carries a mod tree: it
is a self test, not a mod, and it is never uploaded. The self-test job stays
off pushes, because a fixture version bump would send the publish job at Steam.

## License

GNU General Public License v3.0, the same as the sibling repositories. See
`LICENSE`.
