---
name: generate-agent-test-suite
description: Draft a new agent's agent-test-kit test suite (test-cases.json, rubrics.js, invoke-config.js, README.md, review-status.json, and scriptChecks.js if needed) directly from its real source code, then validate and smoke-test the draft. Use when the user asks to "onboard <agent> to agent-test-kit", "generate/draft test cases for <agent>", or similar.
---

# Generate agent test suite

Drafts a new agent's onboarding files by actually reading its real source
code — never by inventing behavior from the agent's name or from general
knowledge of what such an agent "usually" does. There is no separate
deterministic script for this step: inferring realistic test cases, rubrics,
and an accurate `invoke-config.js` from arbitrary source is a reasoning task,
not a mechanical transform.

Unlike the original 5-stage version of this pipeline, there is **no `.md`
draft step** — you author `test-cases.json`/`rubrics.js` directly, validated
against the schema as you go (`agent-test-kit validate`), which is what lets
`compile-agent-test-suite` not exist as a separate stage here at all.

## 1. Resolve the target

- Read `agent-test-kit.config.js` (repo root, or nearest ancestor) for
  `agentsDir` (default `test-suite/agents`). If it doesn't exist, tell the
  caller to run `npx agent-test-kit init` first.
- Derive the agent's folder name from what the caller named it (kebab-case).
  If a folder already exists at `<agentsDir>/<name>/` with `test-cases.json`
  already populated, stop and ask before overwriting — this could be a
  second onboarding pass, not a fresh one. Before drafting over an existing
  folder, run `npx agent-test-kit check-md-staleness <name>` and relay its
  output to the caller — if it warns that `test-cases.review.md`/
  `rubrics.review.md` hold edits never synced to JSON, tell them plainly that
  regenerating now will overwrite `test-cases.json`/`rubrics.js` and those MD
  edits will be lost unless they run `npx agent-test-kit sync <name>` first,
  then proceed if they still want to (informational only, never blocking).
- Locate the agent's real source: ask the caller which file(s)/module
  actually implement the agent if it isn't obvious from the repo.

## 2. Read the reference contract and reference agent

Before drafting anything, read:
- `docs/CONTRACT.md` (root of this package) — the exact required shape of
  every file you're about to produce.
- `examples/example-agent/` — a small, fully worked example of all of them
  together (structure only; its content is a toy note-taker, not a template
  for YOUR agent's actual behavior).
- Every other agent already onboarded under `agentsDir` (if any) — specifically
  their `rubrics.js` files, to avoid reusing a rubric code with a different
  meaning (see the collision check in `review-agent-test-cases`).

## 3. Draft, reading the real source

For each output below, cite the exact file/function/line in the agent's own
source that justifies each claim. Do not describe behavior you haven't
actually verified in the code.

1. `test-cases.json` — one entry per test case, matching
   `src/core/schema/testCase.schema.json`. Cover the agent's real behaviors:
   correctness, its actual constraints/guardrails as written in its own
   prompt/logic, and realistic failure modes — not generic AI-testing
   boilerplate.
2. `rubrics.js` — one entry per rubric code referenced above, matching
   `src/core/schema/rubric.schema.json`. Prefer `script_diff` wherever the
   check is a deterministic property of the output (format, presence of a
   field, a forbidden pattern) — reserve `llm_judge` for genuinely
   judgment-based checks (groundedness, tone, safety).
3. `invoke-config.js` — the two-function contract
   (`createConversationState()`/`async sendMessage(state, action)` returning
   `{rawText, parsed, parseError, clientTraceId, systemPrompt}`), calling the
   agent's REAL code path, not a hand-approximated re-implementation, wherever
   that's feasible headlessly. If the real orchestration code is
   DOM/session/framework-coupled and can't be called directly, say so
   explicitly in the drafted `README.md` and build the closest faithful
   approximation — never silently pretend it's calling the real thing.
   Resolve any credentials it needs via the repo's configured
   `credentialResolver` (see `docs/ARCHITECTURE.md`) — never hardcode a
   token/key inline.
4. `scriptChecks.js` — only if any rubric above is `script_diff`. One handler
   function per such rubric code. This is the file most likely to silently
   do nothing if you forget it — `agent-test-kit validate` will catch a
   missing handler, but only if you actually run it (step 5).
5. `README.md` — what this agent is, what `invoke-config.js`'s
   approximation/fidelity looks like, any known limitations.
6. `review-status.json` — both gates `approved: false` (use
   `agent-test-kit add-agent <name>` to scaffold this, or write it by hand
   matching `docs/CONTRACT.md`).

## 4. Validate, smoke-test, and render for review

```
npx agent-test-kit validate <name>
npx agent-test-kit smoke <name>
npx agent-test-kit render <name>
```

Fix issues and re-run until validate/smoke both pass. Report the smoke
test's actual output (the response it got back) — don't just report
"passed." `render` writes `test-cases.review.md`/`rubrics.review.md` from
the JSON/JS you just drafted — that's what the Gate 1 reviewer actually
edits (see `review-agent-test-cases`), not the raw JSON/JS.

## 5. Hand off

Tell the caller the draft is ready for Gate 1 (`review-agent-test-cases`) and
Gate 2 (`review-agent-invoke-config`) review — this skill never approves its
own output.
