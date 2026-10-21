# How development is kept apart from production

**Development** is this repository: the source, the tests and the build in `dist/`.

**Production** is what users run: the package on npm and the GitHub Action, from
launch.

- `package.json` was marked `"private": true` until launch, so the package could not
  be published by accident. At launch it was removed, and `prepublishOnly` runs the
  build and the tests, so a broken build cannot be published.
- The agent holds no npm credentials (no token on the machine it works on). The
  author publishes from his own npm account.
- Every release is tagged (`v0.4.0` and later); the GitHub Action is used by tag.
