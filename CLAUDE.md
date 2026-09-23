# Project instructions

## Publishing / repo-handler switches

This repo can be pushed to different git handlers/accounts (e.g.
`kkarthicknethaji`, `karthicknethaji-hcl`, or others). Whenever the target
git handler for a push changes, update these two files to match the new
handler **before** committing/pushing:

- `package.json`
  - `name` — scope to `@<handler>/agent-test-kit`
  - `repository.url` — `git+https://github.com/<handler>/agent-test-kit.git`
- `.github/workflows/publish.yml`
  - `scope: '@<handler>'` under the `setup-node` step
  - the comment header at the top of the file (mentions the scope/user the
    `NPM_TOKEN` secret belongs to)

The npm account tied to `NPM_TOKEN` must match the scope in `package.json`
name and the workflow's `scope`, otherwise `npm publish` will fail on
scope/permission mismatch. When given a new npm token, verify its account
with `npm whoami --registry=https://registry.npmjs.org --//registry.npmjs.org/:_authToken=<token>`
before assuming which handler it belongs to.
