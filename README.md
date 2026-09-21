# agent-test-kit

Agent-agnostic AI agent test execution framework: generate, review, and run
rubric-scored test suites against any AI agent, in any codebase — as an
`npx`-installable CLI plus a companion Claude Code plugin for the
LLM-in-the-loop steps.

Extracted from an internal framework built and proven on two production AI
agents. See `docs/ARCHITECTURE.md` for what's genuinely generic vs. what a
consuming repo still has to author.

## The pipeline

1. **Generate** (Claude Code skill) — draft `test-cases.json`/`rubrics.js`/`invoke-config.js` from your agent's real source.
2. **Gate 1 review** (Claude Code skill) — product review.
3. **Gate 2 review** (Claude Code skill) — technical fidelity review, including actually executing `scriptChecks.js` against mocks.
4. **Run** (`npx agent-test-kit run <agent>`) — deterministic; refuses unless schema-valid and both gates are approved.

Full walkthrough: `docs/GETTING-STARTED.md`. File/interface contracts:
`docs/CONTRACT.md`. Why each pluggable seam exists: `docs/ARCHITECTURE.md`.

## Status

**Private preview.** Published to a private registry only (see below) while
it's validated against real agents outside the codebase it was extracted
from. Public npm release is a later, separate decision.

## Publishing (maintainers)

Publishing to GitHub Packages happens via `.github/workflows/publish.yml`,
triggered by pushing a `vX.Y.Z` tag (or manually via "Run workflow" in the
Actions tab). It uses GitHub's own built-in `GITHUB_TOKEN` — no publish
token is ever stored in this repo or handled outside CI.

```
npm version 0.1.1   # bumps package.json + creates the git tag
git push --follow-tags
```

## Installing from the private registry

This package publishes to GitHub Packages under this org. In the consuming
repo, add to `.npmrc`:

```
@karthicknethaji-hcl:registry=https://npm.pkg.github.com
```

Then authenticate (`npm login --registry=https://npm.pkg.github.com`, or a
`NODE_AUTH_TOKEN`/`GITHUB_TOKEN` with `read:packages` scope in CI) and:

```
npm install --save-dev @karthicknethaji-hcl/agent-test-kit
```

## Installing the Claude Code plugin

```
claude plugin marketplace add <this-repo-url>/plugin
claude plugin install agent-test-kit
```

(Exact subcommands per Anthropic's current Claude Code plugin docs — verify
before relying on this if it's been a while since this was written.)

## Repo layout

```
bin/            CLI entry point
src/core/       evaluator, runner, schema, config, validate — agent-agnostic
src/adapters/   pluggable judgeClient / resultsSink / credentialResolver / traceResolver
examples/       bundled reference agent (no external dependencies)
plugin/         Claude Code plugin: the 4 pipeline skills + marketplace.json
docs/           CONTRACT.md, ARCHITECTURE.md, GETTING-STARTED.md
test/           this package's own end-to-end test (npm test)
```

## Development

```
npm install
npm test
```
