# ck3-mod-ci

A reusable GitHub Actions workflow that keeps a Steam Workshop item in a git
repository. It grew out of three Crusader Kings III mods, hence the name, but it
works for any Steam AppID. The name can be changed later without changing
behaviour, since callers reference it by path.

- **On every pull request**, it validates the shipping tree and the Workshop
  metadata. Nothing is uploaded.
- **On a push to `main`**, it publishes to the Steam Workshop, but only when the
  version line changed. Bumping the version is the release action.
- **On a push to `main` that leaves the version alone but changes `workshop/`**,
  it sends a listing update: title and description only, no content upload, no
  change note, so Steam records no new update entry. A manual run of the caller
  (`workflow_dispatch`) forces the same listing update.
- Everything else merges without touching the Workshop.

## What a repo needs

```
mod/                        the folder uploaded verbatim
mod/thumbnail.png           the Workshop preview, 1 MB maximum
mod/descriptor.mod          carries version="x", the release trigger
CHANGELOG.md                the change note for each version
workshop/item.json          {"title": "...", "publishedfileid": "123"}
workshop/description.bbcode the listing body, Steam BBCode, 8000 chars max
workshop/<lang>/title.txt   optional, one localized listing per folder
workshop/<lang>/description.bbcode
.github/workflows/ci.yml    the caller below
```

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  ci:
    uses: JDeffner/ck3-mod-ci/.github/workflows/mod-ci.yml@main
    secrets:
      STEAM_USERNAME: ${{ secrets.STEAM_USERNAME }}
      STEAM_CONFIG_VDF: ${{ secrets.STEAM_CONFIG_VDF }}
      DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

`secrets: inherit` also works and passes every secret the repo holds. Name the
two explicitly when the repo holds others. A pull request from a fork never
receives secrets at all, because the workflow runs on `pull_request` and not on
`pull_request_target`.

The content folder is uploaded verbatim, so anything sitting in it ships.
Validation blocks the known offenders (`__pycache__`, `.pyc`, `.claude`, a real
`.git` directory) but it is not a substitute for looking.

## Inputs

Every input has a default that reproduces the Crusader Kings III layout above.

| Input | Default | What it is |
|---|---|---|
| `app_id` | `1158310` | The Steam AppID that owns the item. |
| `content_dir` | `mod` | The folder uploaded to the Workshop. |
| `preview_file` | `mod/thumbnail.png` | The preview image, 1 MB maximum. |
| `version_file` | `mod/descriptor.mod` | The file holding the version line. |
| `version_pattern` | `^version="(.*)"` | Regex, matched multiline, whose first group is the version. |

The item id comes from `publishedfileid` in `workshop/item.json` and is
required. When `version_file` also contains a `remote_file_id="123"` line, as a
Paradox descriptor does, the two are cross-checked. Otherwise that check is
skipped silently.

## Change notes

`CHANGELOG.md` at the repository root is the one source of release notes, in
Keep a Changelog style:

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
version and everything after it (the date) is ignored. The section runs to the
next `## ` or to the end of the file. The `### Added|Changed|Fixed|Removed`
subsections are optional; a plain bullet list is just as good.

**A release whose version has no section fails validation.** When the version
changed, CI requires a section for exactly that version with a non-empty body,
and says so with an `::error::` when there is none. When the version did not
change, `CHANGELOG.md` is not looked at, so ordinary commits merge freely.

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

After a successful release, and only for a release, the workflow posts one
embed to the webhook in `DISCORD_WEBHOOK_URL`: the item title with the new
version, a link to the Workshop page, and the changelog section as Markdown
(Discord renders it, so the bullets survive and the `###` headings become bold
lines), truncated at 4000 characters. Without the secret the step prints a
notice and skips. A webhook that refuses the post only warns, since the release
has already happened.

## Localized listings

Steam shows a Workshop title and description per language. Put each one in
`workshop/<lang>/` with `title.txt` (one line, 128 chars max) and
`description.bbcode` (8000 chars max). `<lang>` is Steam's API language code
(`french`, `german`, `schinese`, `koreana` and so on). English stays in
`workshop/item.json` and `workshop/description.bbcode`.

**These files are validated but never uploaded.** No headless way to set a
localized listing exists: the SteamCMD build manifest has no language field
(passing one returns Success and changes nothing), and the Web API's
`CPublishedFile_Update_Request` has none either. So the folders are the source
you paste into the Workshop UI by hand, and CI only checks that the language
code is real and that the two size limits hold.

## Steam credentials

Each repo needs two secrets. SteamCMD cannot answer a Steam Guard prompt, so it
reuses a session you create once on your own machine.

1. Install SteamCMD locally and log in once, answering the Steam Guard prompt:

   ```
   steamcmd +login <username> +quit
   ```

2. Run it a second time. If it does not ask for a code again, the session is
   cached:

   ```
   steamcmd +login <username> +quit
   ```

3. Base64-encode the resulting `config/config.vdf` (next to the SteamCMD
   install on Windows, `~/Steam/config/config.vdf` on Linux) and store it as
   the repository secret `STEAM_CONFIG_VDF`. Store the account name as
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

## Trust model

The workflow reads the calling repository's checkout and the two secrets. It
sends the content folder, the preview image and the listing text to Steam
through SteamCMD, and after a publish it reads the item back from Steam's public
API to compare the description. When `DISCORD_WEBHOOK_URL` is set it also posts
the release announcement to that webhook. It talks to nothing else.

`STEAM_CONFIG_VDF` is a logged-in Steam session and grants full access to that
account, not just to Workshop uploads. Put it only in repositories you control,
where nobody else can add a workflow or a step that would print it. The workflow
itself never echoes it, runs no shell tracing, and requests only
`permissions: contents: read`. Third-party actions are pinned to a commit SHA.

## Two things this deliberately does not do

**Tags.** Steam's build manifest has no field for Workshop tags, so CI never
sets them. Existing tags survive an update untouched. Change them in the
Workshop UI.

**Visibility.** The manifest only understands public, friends-only and private.
It has no value for *unlisted*, so writing visibility at all could flip an
unlisted item public. Visibility stays a manual switch in the Workshop UI.

## A note on quotes

SteamCMD does not process escape sequences in `workshop_build_item`. A `\n` in
the manifest arrives at the Workshop as a backslash and an n, and a double quote
would end the value with no way to escape it. So the workflow writes newlines
raw, leaves backslashes alone, and rewrites double quotes in the title and the
description as typographic quotes (opening and closing by turns) before
uploading. Write `"` in your BBCode if you like; the listing will show `“` and
`”`.
