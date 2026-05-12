# Release

1. `npm version patch` (or `minor` / `major`) — bumps `package.json`, commits, creates a `v*` tag.
2. `git push --follow-tags` — pushes the commit and tag.

The [Publish workflow](.github/workflows/publish.yml) runs on the tag push: it runs lint, tests, and build, verifies the tag matches `package.json`'s version, publishes to npm, and creates a GitHub release with auto-generated notes.
