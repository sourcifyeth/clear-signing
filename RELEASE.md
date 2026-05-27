# Release

1. `git checkout main && git pull && git checkout -b release` — branch off the latest `main`.
2. `npm version patch` (or `minor` / `major`) — bumps `package.json`, commits, creates a `v*` tag locally.
3. `git push -u origin release` — pushes the commit only (no tag yet).
4. Open a pull request from `release` into `main`. **Critical:** it MUST be merged using a merge commit (not squash or rebase) so the tagged commit is preserved on `main`.
5. After the PR is merged, push the tag: `git push origin v<version>` (e.g. `git push origin v0.1.6`). This triggers the publish workflow.

The [Publish workflow](.github/workflows/publish.yml) runs on the tag push: it runs lint, tests, and build, verifies the tag matches `package.json`'s version, publishes to npm, and creates a GitHub release with auto-generated notes.
