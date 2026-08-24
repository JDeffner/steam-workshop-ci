# Changelog

The `## <version>` section of this file becomes the Workshop change note for
that version. The self-test fixture in `mod/descriptor.mod` carries the version
these sections describe.

## 0.1.0

### Added
- The reusable `mod-ci.yml` workflow: validation on every pull request, a
  release on a version bump, a listing update when only the metadata changed.
- Localized Workshop listings, validated but never uploaded.
- `release_on: tag` and the `mode` override.
- Change notes taken from this changelog, and an optional Discord announcement
  posted as a full-width message rather than an embed.

### Fixed
- A release is detected across a whole push rather than against `HEAD^` alone.
- Straight quotes survive inside BBCode tags.
