# ck3-mod-ci

Shared CI for the CK3 mod repos. One reusable workflow,
[`.github/workflows/mod-ci.yml`](.github/workflows/mod-ci.yml), used by
`ck3-gesta`, `ck3-custom-name-lists` and `ck3-hide-decisions`.

It does two things:

- **On every pull request**, validates the shipping tree and the Workshop
  metadata. Nothing is uploaded.
- **On a push to `main`**, publishes to the Steam Workshop, but only when the
  `version=` line in `mod/descriptor.mod` changed. Bumping the version is the
  release action. Everything else merges without touching the Workshop.

## What a mod repo needs

```
mod/descriptor.mod          version=, name=, supported_version=, remote_file_id=
mod/thumbnail.png           the Workshop preview, 1 MB maximum
workshop/item.json          {"title": "...", "publishedfileid": "..."}
workshop/description.bbcode the Steam listing body, Steam BBCode, 8000 chars max
.github/workflows/ci.yml    the caller below
```

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  ci:
    uses: JDeffner/ck3-mod-ci/.github/workflows/mod-ci.yml@main
    secrets: inherit
```

`mod/` is uploaded verbatim, exactly as the Paradox launcher does it, so
anything sitting in that folder ships. The validation step blocks the known
offenders (`__pycache__`, `.pyc`, `.claude`, a real `.git` directory) but it is
not a substitute for looking.

## Steam credentials

Each mod repo needs two secrets. SteamCMD cannot answer a Steam Guard prompt, so
it reuses a session you create once on your own machine.

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
   install, or `~/Steam/config/config.vdf`) and store it as the repository
   secret `STEAM_CONFIG_VDF`. Store the account name as `STEAM_USERNAME`.

   ```
   base64 -w0 config/config.vdf
   ```

These sessions expire. When a publish fails with a Steam Guard message, repeat
the steps and replace `STEAM_CONFIG_VDF`.

## Two things this deliberately does not do

**Tags.** Steam's build manifest has no field for Workshop tags, so CI never
sets them. Existing tags survive an update untouched. Change them in the
Workshop UI.

**Visibility.** The manifest only understands public, friends-only and private.
It has no value for *unlisted*, so writing visibility at all could flip an
unlisted item public. Visibility stays a manual switch in the Workshop UI.

## Verifying an upload

The last step re-reads the item from Steam's public API and compares the
published description against `workshop/description.bbcode`, warning on a
mismatch. Steam only serves details for publicly readable items, so a hidden or
unlisted mod skips that check and you should eyeball the listing yourself.
