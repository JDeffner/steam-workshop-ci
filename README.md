# ck3-mod-ci

A reusable GitHub Actions workflow that publishes a Steam Workshop item from a
git repository. Bump a version line, push, and the item updates. Do anything
else and the Workshop is left alone.

It was written for three Crusader Kings III mods and still carries that name,
but nothing in the workflow knows what CK3 is. The game is an AppID you pass
in, the version is a regex you choose, the folder that ships is a path. CK3 is
the worked example throughout because it is the case that runs in production;
every step below names the general rule next to it.

## What happens when

| The event | The outcome |
|---|---|
| Pull request | The tree and the metadata are validated. Nothing is uploaded. |
| Push to `main`, version line changed | **Release.** Content folder, preview image and a change note built from the commits since the last release. |
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
.github/workflows/ci.yml      the caller, below
```

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
    uses: JDeffner/ck3-mod-ci/.github/workflows/mod-ci.yml@main
    with:
      app_id: "1158310"
      content_dir: mod
      preview_file: mod/thumbnail.png
      version_file: mod/descriptor.mod
    secrets:
      STEAM_USERNAME: ${{ secrets.STEAM_USERNAME }}
      STEAM_CONFIG_VDF: ${{ secrets.STEAM_CONFIG_VDF }}
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

The change note covers every commit since the previous release, as a BBCode
`[list]` under a `v<version>` heading.

With `release_on: version`, the workflow walks the history of the version file
backwards — past the commits that already carry the current version — to the
commit that introduced the previous one, and lists the non-merge commit subjects
after it. With `release_on: tag`, the range is the previous tag to the tag being
pushed. With neither, it falls back to the subject of the last commit. The note
is capped at Steam's 8000 characters, and a listing update sends none at all.

Commit subjects become public release notes. That is worth remembering while
writing them.

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
API to compare the description. It talks to nothing else.

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
uses: JDeffner/ck3-mod-ci/.github/workflows/mod-ci.yml@v1
```

To move a caller to the general version, spell out what used to be implicit:

```yaml
with:
  app_id: "1158310"
  content_dir: mod
  preview_file: mod/thumbnail.png
  version_file: mod/descriptor.mod
```

Behaviour changes beyond the inputs, all of them in the caller's favour:

- A release is now detected across a whole push rather than against the previous
  commit alone. A push whose version bump is not the tip commit used to be
  missed, and published nothing.
- `preview_file` may be omitted, which leaves the item's existing image alone.
- The metadata folder is `workshop_dir` and no longer hardcoded.
- `release_on: tag` and the `mode` override are new.

The repository name is cosmetic — callers reference the workflow by path, so
renaming it would only break existing `uses:` lines, never any behaviour.

## Self-test

This repository is other repositories' quality gate, so it has one of its
own in `.github/workflows/ci.yml`. It runs `actionlint` (with `shellcheck`,
which reads the `run:` bodies) on every change, and on a pull request it calls
`mod-ci.yml` against the fixture in `mod/` and `workshop/`. That fixture is
why a workflow repository carries a mod tree: it is a self test, not a mod,
and it is never uploaded. The self-test job stays off pushes, because a
fixture version bump would send the publish job at Steam.

## License

GNU General Public License v3.0, the same as the sibling repositories. See
`LICENSE`.
