# Plan: Extract the Agent Test Execution Framework into a standalone package

## Context

This package started as an internal framework that had already onboarded two
production AI agents, and in doing so, proved out a genuinely useful pattern:
read an agent's source → draft test cases/rubrics/invocation config → two
human gates (product, technical) → run against a live model with LLM-judge
scoring → machine-checked script-diff rubrics → persisted results. Building
the second agent also surfaced real gaps (a hardcoded dispatcher, an
undocumented schema, repo-specific plumbing baked into "generic" files) —
exactly the kind of thing that only shows up when you try to generalize.

The goal was to turn this into something **any developer, in any repo**, can
pull in with `npx` — not just something copy-pasted between one codebase's
own agents. Research done while extracting it confirmed:

- The evaluator was **already fully generic** — no repo-specific references,
  ships as-is.
- The runner's orchestration was generic in shape, but its judge-call HTTP
  body and results-persistence were hardwired to the original codebase's own
  proxy contract and database schema — needed to become pluggable.
- A couple of supporting scripts (an env-file reader, a smoke test's
  persistence check) were **not reusable at all** outside that codebase's
  own setup — needed to become optional/pluggable.
- The `invoke-config.js`/`scriptChecks.js`/`test-cases.json`/`rubrics.js`
  contract was real and mostly consistent across both agents, but it was
  **only documented in prose** — no schema, no types. This was the same
  class of gap that had caused a real dispatch bug in the original framework.
- Of the original 5 pipeline skills, generation and the product-review gate
  are fundamentally LLM-judgment tasks; the technical-review gate is mixed;
  the compile and run steps were mostly deterministic scripting wrapped in a
  skill for convenience.

Decisions made while scoping this extraction:

1. **Distribution**: private registry / git-installable first; public npm
   only after approvals + real-world validation. Code should be clean and
   repo-agnostic from day one regardless (that's an infra/access switch, not
   a code change).
2. **v1 scope**: ship the *whole* pipeline together (generate, both review
   gates, run) as one bundle — not the CLI alone. A partial tool with no
   generate/review story has no real value.
3. **Authoring format**: drop the `.md` draft → hand-transcribe → `.json`/`.js`
   two-step. Author `test-cases.json`/`rubrics.js` directly, JSON-Schema
   validated, from the start. This **eliminates the old "compile" stage**
   entirely — its two jobs (schema validity, gate enforcement) move into
   `generate` (produces valid files immediately) and `run`/`validate`
   (refuse to execute an un-approved or schema-invalid suite).
4. **Dogfooding**: build the package standalone, validated against a bundled
   example agent. Migrating the original codebase's own agents onto the new
   package is explicitly a **later, separate task** — out of scope here.

This plan covers designing and building that standalone package + Claude Code
plugin. It does **not** cover: standing up a public npm release, or migrating
the original codebase itself.

## Target architecture

A new standalone repo, tentatively named **`agent-test-kit`** (working
name — rename freely), publishing two complementary artifacts from one place:

1. **An npm package** (installable via `npx agent-test-kit <command>`) —
   the deterministic core: evaluator, runner, schemas, pluggable adapters,
   scaffolding CLI.
2. **A Claude Code plugin** (`marketplace.json` + `.claude-plugin/plugin.json`)
   bundling the 4 remaining pipeline skills, distributed from the same repo,
   depending on the npm package being installed in the target repo.

```
agent-test-kit/
  package.json                     # npm package "agent-test-kit"
  bin/agent-test-kit.js            # CLI entry
  src/
    core/
      evaluator.js                 # ported ~verbatim (already generic)
      runner.js                    # generalized executionMode dispatch,
                                    #   now takes injected
                                    #   judgeClient/resultsSink/credentialResolver
      schema/
        testCase.schema.json
        rubric.schema.json
        invokeConfig.contract.md   # formal interface spec (createConversationState/
                                    #   sendMessage/smokeTestAction), + a .d.ts
        scriptChecks.contract.md
    adapters/
      judgeClients/anthropicJudgeClient.js   # default; documented interface for others
      resultsSinks/{consoleSink.js, jsonFileSink.js}  # zero-config defaults;
                                    #   interface documented for a consumer's own
                                    #   sink (e.g. their own DB) — a custom sink
                                    #   maps this same row shape into it
      credentialResolvers/envCredentialResolver.js    # default: plain env vars;
                                    #   interface documented for e.g. browser-driven
    cli/commands/
      init.js                      # scaffold test-suite dir + agent-test-kit.config.js
      addAgent.js                  # scaffold a new agent folder from templates
      generate... (see note)       # NOT a CLI command — generation stays LLM-driven,
                                    #   see plugin/ below
      validate.js                  # schema-validate one agent's files, no execution
      smoke.js                     # response-shape check always; persistence check
                                    #   only if a sink is configured
      run.js                       # refuses to run unless schema valid AND both
                                    #   gates approved; wraps runner.js
      status.js                    # prints each agent's Gate1/Gate2 approval state
  examples/example-agent/          # small, self-contained reference agent
                                    #   used by the generator skill as its structural
                                    #   reference, and by the package's own tests
  plugin/
    .claude-plugin/plugin.json
    marketplace.json
    skills/
      generate-agent-test-suite/SKILL.md   # generalized; reads agent-test-kit.config.js;
                                            #   points at examples/example-agent;
                                            #   drafts test-cases.json/rubrics.js
                                            #   directly (schema-checked), no .md
      review-agent-test-cases/SKILL.md     # Gate 1 — generalized paths, methodology unchanged
      review-agent-invoke-config/SKILL.md  # Gate 2 — generalized paths, still actually
                                            #   executes scriptChecks.js against mocks
      run-agent-tests/SKILL.md             # thin wrapper: shells out to
                                            #   `npx agent-test-kit run <agent>`,
                                            #   still does browser-driven credential
                                            #   discovery when a resolver needs it
  docs/{CONTRACT.md, ARCHITECTURE.md, GETTING-STARTED.md}
  test/                            # package's own tests, run against examples/example-agent
```

### The pipeline, now 4 stages instead of 5

| Stage | Mechanism | Notes |
|---|---|---|
| 1. Generate | Claude Code skill (LLM) | Drafts `test-cases.json` + `rubrics.js` + `invoke-config.js` (+ optional `scriptChecks.js`) directly against the schema — no `.md` intermediate. |
| 2. Gate 1 review | Claude Code skill (LLM) | Product review of test-cases/rubrics content; records approval (e.g. in `agent-test-kit.config.js`'s agent entry or a small `review-status.json`). |
| 3. Gate 2 review | Claude Code skill (LLM + mock execution) | Technical fidelity review of `invoke-config.js`/`scriptChecks.js`; actually runs `scriptChecks.js` handlers against pass/fail mocks. |
| 4. Run | `npx agent-test-kit run <agent>` (deterministic CLI) | Validates schema, refuses if either gate isn't approved, executes, reports, persists via the configured sink. |

`smoke`/`validate` are deterministic CLI sub-steps usable before/around Gate 2,
with the persistence check made optional (skipped cleanly if no
`resultsSink` is configured).

### Pluggable seams (this is what makes it repo-agnostic)

- **`judgeClient(promptText) => Promise<string>`** — bring-your-own model call.
  Default adapter hits Anthropic directly (needs just an API key), documented
  interface for anything else (a proxy, OpenAI, etc.).
- **`resultsSink.write(row)`** — default: local JSON/NDJSON file (zero
  external dependencies, works out of the box). Documented interface for a
  consumer's own DB — a custom sink maps this same canonical row shape into
  its own schema/columns.
  Also a `consoleSink` (no persistence at all) as the absolute-zero-config
  default `init` picks.
- **`credentialResolver()`** — default: plain env vars by naming convention.
  Documented interface for anything more elaborate (browser-driven session
  tokens, secrets manager, etc.) — this is where a consumer repo plugs in
  whatever its own real auth/session mechanism is.
- **`invoke-config.js`'s two-function contract** (`createConversationState()`
  / `async sendMessage(state, action)`) stays exactly as already proven by
  the two agents this was extracted from — this was already agent-agnostic
  and doesn't need to change, just to be formally documented (JSON
  Schema-adjacent `.d.ts`/`.md` instead of "read the other agent's file").

## Execution roadmap

1. **Formalize the contracts** — write `docs/CONTRACT.md` +
   `testCase.schema.json`/`rubric.schema.json` + `invokeConfig.contract.md`
   from what the two source agents already prove works, closing the
   "no schema exists anywhere" gap found during extraction.
2. **Build the core package** — port the evaluator near-verbatim; refactor
   the original runner into `src/core/runner.js` taking injected
   judgeClient/resultsSink/credentialResolver; build the three default
   adapters; add `ajv`-based schema validation on load.
3. **Build the CLI** (`init`, `add-agent`, `validate`, `smoke`, `run`,
   `status`) as thin wrappers over the core package.
4. **Build `examples/example-agent`** — a small, fully self-contained
   reference agent (e.g. a toy Q&A agent hitting a public/mock endpoint) that
   replaces the two source agents as the generator's structural reference
   and as the package's own end-to-end test fixture.
5. **Generalize the 4 skills into `plugin/skills/`** — strip source-agent
   anecdotes, point at `examples/example-agent` and `agent-test-kit.config.js`
   instead of hardcoded paths, fold the old compile step's responsibilities
   into `generate`/`run` as decided above. Add `plugin/marketplace.json` +
   `.claude-plugin/plugin.json`.
6. **Docs** — `GETTING-STARTED.md` (install, init, add an agent, run the
   4-stage pipeline end to end using the example agent) and
   `ARCHITECTURE.md` (the adapter seams, for anyone extending it).
7. **Publish privately** — package to a private registry, install it into a
   scratch/throwaway repo, and run the full pipeline end-to-end there as the
   real validation before any public release is considered.

Explicitly deferred (not part of this plan): public npm release, and
migrating the original codebase's own agents onto the new package.

## Verification

- `examples/example-agent`'s suite runs clean end-to-end via
  `npx agent-test-kit run example-agent` inside the new repo — proves the
  core package works standalone with zero external DB/proxy setup (using the
  default console/JSON-file sink and a direct-to-Anthropic judge client).
- `npx agent-test-kit validate` rejects a deliberately malformed
  `test-cases.json`/`rubrics.js` (schema catches it) — proves the
  formalized contract actually guards against the class of bug that
  originally motivated formalizing it.
- Install the Claude Code plugin into a **separate, throwaway scratch repo**
  and walk a *new* toy agent through all 4 stages (generate → Gate 1 →
  Gate 2 → run) using only the plugin + package, with no hand-written glue
  code — this is the real "does this actually work for a repo that isn't
  the one this was extracted from" test.
- `run` and `smoke` both correctly refuse (with a clear message, not a silent
  no-op) when gates aren't approved / schema is invalid / no sink is
  configured for persistence-dependent checks.
