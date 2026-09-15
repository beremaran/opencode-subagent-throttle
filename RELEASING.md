# Releasing

Releases are tagged from `main` and created as GitHub Releases.

## Steps

1. **Bump the version** in `package.json` (keep `0.x` semver; the version in
   `package-lock.json` is updated by `npm install` or `npm version`).

2. **Add a CHANGELOG entry.** Create a new `## X.Y.Z - YYYY-MM-DD` heading at
   the top of `CHANGELOG.md` (above `## [Unreleased]`, or move the Unreleased
   content into it). Group changes under `### Added`, `### Fixed`, and
   `### Changed`. For **breaking** changes in 0.x — anything that changes
   default behavior for existing users — use `### Changed (Breaking)`.

3. **Commit** the changes on `main`:

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   git push origin main
   ```

4. **Tag and push the tag:**

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. **Create the GitHub Release.** Select the `vX.Y.Z` tag and use the matching
   CHANGELOG section as the release notes.

## Notes

- The tag must be exactly `v` + the `package.json` version (e.g. version
  `0.1.0` → tag `v0.1.0`).
- "Unreleased" entries are never tagged; move their content into the dated
  release section before tagging.
