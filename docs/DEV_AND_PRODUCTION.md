# How development is kept apart from production

**Development** is this repository: the source, the tests and the build in `dist/`.

**Production** is what users run: the package on npm and the GitHub Action, from
launch.

- `package.json` was marked `"private": true` until launch, so the package could not
  be published by accident. At launch it was removed, and `prepublishOnly` runs the
  build and the tests, so a broken build cannot be published.
- The author publishes from his own npm account. Since the first publish
  (2026-10-22) the machine the agent works on holds that npm login in `~/.npmrc`, so
  the agent's settings, committed in `.claude/settings.json`, deny reading `.npmrc`
  and make `npm publish`, the other npm release commands, `gh release` and pushing a
  tag stop for the author's confirmation.
- Every release is tagged (`v0.4.0` and later); the GitHub Action is used by tag.
