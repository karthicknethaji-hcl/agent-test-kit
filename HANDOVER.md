# Handover — agent-test-kit, for the testing thread

## What this is

`agent-test-kit` is a standalone extraction of an internal "Agent Test
Execution Framework" into a repo-agnostic npm package + Claude Code plugin,
so ANY repo can adopt the same generate → Gate 1 review → Gate 2 review →
run pipeline for testing an AI agent, not just the two production agents it
was originally proven on.

Read in this order:
1. `README.md` — repo layout, pipeline overview, current status.
2. `docs/ARCHITECTURE.md` — the 4-stage pipeline, the 4 pluggable adapter
   seams (`judgeClient`/`resultsSink`/`credentialResolver`/`traceResolver`)
   and why each exists, what's genuinely fixed vs. what a consuming repo
   must always author itself.
3. `docs/CONTRACT.md` — the exact file/interface shapes
   (`invoke-config.js`, `scriptChecks.js`, `test-cases.json`, `rubrics.js`,
   the four adapter interfaces, the canonical result-row schema).
4. `docs/GETTING-STARTED.md` — the actual walkthrough commands.

## Current state (as of this handover)

- Repo: https://github.com/karthicknethaji-hcl/agent-test-kit — **public**
  (source only). No npm package has been published anywhere yet (neither
  the private GitHub Packages registry nor public npm) — that's a separate,
  later step, deliberately not done.
- 2 commits on `main`: initial extraction + a CI/publish-workflow commit
  (`.github/workflows/ci.yml`, `.github/workflows/publish.yml` — the publish
  one triggers on a `vX.Y.Z` tag push and uses GitHub's own built-in token,
  nothing stored in the repo).
- Local verification already done (by the building thread, not yet by a
  fresh outside perspective):
  - `npm test` — 4/4 passing (`test/run-example-agent.test.js`), using a
    stub judge client, no external API needed.
  - CLI commands (`init`, `add-agent`, `status`, `validate`, `smoke`, `run`)
    exercised by hand in a scratch directory and against the bundled
    `examples/example-agent`.
  - Found and fixed one real bug during that manual testing: the default
    `anthropicJudgeClient` was throwing for a missing `ANTHROPIC_API_KEY`
    even on a `--only` run that never needed a judge call at all (fixed to
    check lazily, at call time).
  - Schema validation confirmed to genuinely reject a malformed
    `test-cases.json` (not just accept anything).
  - Gate enforcement (`review-status.json`) confirmed to block `run` when
    either gate isn't approved, and to accept `--skip-gate-check` for local
    iteration.

## What's explicitly NOT yet done — this is the real point of the new thread

The original plan's verification checklist had one item that's still
open, and it's the most important one:

> Install the Claude Code plugin into a **separate, throwaway scratch repo**
> (not the original codebase, not agent-test-kit itself) and walk a **new
> toy agent** through all 4 stages (generate → Gate 1 → Gate 2 → run) using
> only the plugin + package, with no hand-written glue code — this is the
> real "does this actually work for a repo that isn't the one this was
> extracted from" test.

Everything verified so far was against the bundled `examples/example-agent`
— which is a toy built specifically to be easy to pass. It does NOT prove
the plugin's skills (`generate-agent-test-suite`,
`review-agent-test-cases`, `review-agent-invoke-config`, `run-agent-tests`)
actually work when pointed at unfamiliar, real source code in a repo that
has never seen this framework before. That's the test this new thread
should run.

Suggested first steps for that thread:
1. Pick (or create) a small throwaway scratch repo with SOME kind of real
   AI agent code in it (doesn't need to be sophisticated — even a simple
   LLM-calling function is enough to be a genuine test, as long as it's
   NOT `examples/example-agent`).
2. Install the plugin there (`claude plugin marketplace add
   <path-or-url-to-this-repo>/plugin`, then `claude plugin install
   agent-test-kit` — verify the exact current subcommands against
   Anthropic's live docs first; this was written from memory, not
   verified against this repo, per `docs/ARCHITECTURE.md`'s own caveat).
3. Install the npm package into that scratch repo. Since nothing's
   published yet, use a local/relative install for now:
   `npm install --save-dev "file:../agent-test-kit"` (adjust the path), or
   `npm install --save-dev github:karthicknethaji-hcl/agent-test-kit` (works
   now that the repo is public, without any registry auth).
4. Run `npx agent-test-kit init` and `add-agent <name>`, then actually ask
   Claude Code to run the `generate-agent-test-suite` skill against that
   repo's real agent code, and walk it through both review gates and a real
   `run`.
5. Report back what breaks. Expect it to — this is the first time these
   skills have been pointed at anything other than their own bundled
   example or the codebase they were extracted from.

## Standing constraints to carry into the new thread

- **Never `git commit`/push in this repo without an explicit ask** — same
  rule carried over from the thread this was extracted from.
- **No public npm publish** without first seeking approvals and validating
  results (this is exactly what the new thread's testing is for) — the
  private-registry-first decision still holds for the *package*, even
  though the *source repo* itself was made public.
- **Credential handling**: never type/enter API keys or tokens on the
  agent's behalf; only use secrets the user explicitly supplies (env var,
  or an active browser session they signed into themselves).
- If SQL or any other manual-run artifact ends up being relevant to whatever
  scratch agent gets tested, it should be handed to the user as a file to
  run themselves, never executed directly — same convention carried over
  from the original codebase.
