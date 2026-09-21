---
name: review-agent-test-cases
description: Gate 1 product-review support — check a drafted test-cases.json/rubrics.js for citation accuracy, rubric-code collisions with other onboarded agents, and threshold reasoning, surfacing exactly the decisions that need the reviewer's own product judgment rather than deciding them. Use when the user asks to "review <agent>'s test cases", "do Gate 1 review for <agent>", or wants help deciding on a drafted test suite.
---

# Review agent test cases (Gate 1)

Supports — never replaces — the human product reviewer's own judgment call.
This skill's job is to make that judgment call well-informed, not to make it
for them. It never sets `review-status.json`'s `gate1.approved` to `true`
itself; it records findings and asks the reviewer to decide.

## 1. Load context

- `<agentsDir>/<agent>/test-cases.json` and `rubrics.js` (required — if
  missing, point at `generate-agent-test-suite` instead).
- The agent's real source code each test case claims to be testing.
- Every OTHER agent's `rubrics.js` under `agentsDir`, for the collision check
  below.

## 2. Citation verification

For every test case whose `expectedBehaviorNote`/`failureModeNote` makes a
factual claim about the agent's own prompt/logic ("the system prompt says
X", "the code enforces Y"), verify it against the actual source — quote the
real line. Flag any claim you can't verify, or that the source contradicts.

## 3. Rubric-code collision check

Read every other onboarded agent's `rubrics.js`. If this agent reuses a code
another agent already uses (e.g. both define `"B"`) with a **different**
`metric` meaning, flag it — this is exactly the kind of silent collision that
broke a shared evaluator dispatch once before (see `docs/ARCHITECTURE.md`).
Reusing a code with the SAME meaning is fine and not worth flagging.

## 4. Surface product judgment calls, don't make them

Separate your findings into two buckets:
- **Mechanical facts** (citation is wrong, a threshold's own math doesn't
  match its stated intent, a rubric collision) — just report these as
  findings to fix.
- **Genuine policy calls** (is this severity threshold too strict/lenient
  for this product, is this behavior actually acceptable, should this edge
  case even be in v1 scope) — list these explicitly as "needs your decision,"
  with the tradeoff stated plainly, and do not resolve them yourself.

## 5. Record and ask

Write your findings into `<agentsDir>/<agent>/review-status.json`'s
`gate1.notes` (reviewer/date left for the human to fill in, or filled in with
their name once they confirm). Ask the reviewer explicitly: "Gate 1 findings
above — do you approve this test suite as-is, or do you want changes first?"
Only set `gate1.approved: true` (and fill in `reviewer`/`date`) after they say
yes.
