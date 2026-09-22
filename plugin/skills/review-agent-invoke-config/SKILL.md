---
name: review-agent-invoke-config
description: Gate 2 technical review support — verify a drafted invoke-config.js's (and scriptChecks.js's, if present) factual claims against the real source they cite, line by line, and actually execute scriptChecks.js handlers against mock pass/fail inputs. Use when the user asks to "review <agent>'s invoke-config", "do Gate 2 review for <agent>", or similar.
---

# Review agent invoke-config (Gate 2)

Supports — never replaces — the human technical reviewer's own sign-off. This
skill never sets `review-status.json`'s `gate2.approved` to `true` itself.

## 1. Load context

- `<agentsDir>/<agent>/invoke-config.js` and `scriptChecks.js` (if present).
- The agent's real source code (whatever `invoke-config.js` claims to call
  or approximate).
- `docs/CONTRACT.md` for the exact contract both files must satisfy.

## 2. Verify invoke-config.js's claims against real source

Extract every falsifiable claim the file's comments/structure make about the
agent's real runtime behavior ("this calls the real X function", "this
approximates Y because Z is DOM-coupled") and verify each one directly
against the cited source — quote the real line. Flag anything that's
actually a hand-approximation being presented as calling the real thing, or
vice versa.

Also confirm:
- `agentName`, `createConversationState()`, `sendMessage()` are present and
  match the contract in `docs/CONTRACT.md`.
- Any credential/auth values are resolved via the repo's configured
  `credentialResolver`, not hardcoded inline.
- `smokeTestAction()` (if present) actually produces a valid `action` for
  this agent's real shape.

## 3. Actually execute scriptChecks.js, don't just read it

For each `script_diff` rubric's handler function:
1. Build one mock `callResult`/`context` that SHOULD pass (based on a real
   test case in `test-cases.json`) and run the handler against it — confirm
   it returns `pass: true`.
2. Build one mock that SHOULD fail (deliberately violate the rule the rubric
   checks) and run the handler against it — confirm it returns `pass: false`
   with a real `recommendation`.

If a handler passes on both mocks, or fails on both, that's a real
finding — its check logic doesn't actually discriminate. Report it, don't
approve past it.

## 4. Record and ask

Write findings into `review-status.json`'s `gate2.notes`. Ask the reviewer
explicitly: "Gate 2 findings above — do you approve `invoke-config.js`
(and `scriptChecks.js`) as-is, or do you want changes first?" Only set
`gate2.approved: true` (and fill in `reviewer`/`date`) after they say yes —
and when you do, also stamp `gate2.approvedContentHash` with the current
`test-cases.json` + `rubrics.js` combined-content hash, so a later hand-edit
or `sync` can be detected as drift against this approval:

```
node -e "console.log(require('agent-test-kit').reviewStatus.computeContentHash('<agentsDir>/<agent>'))"
```

Once both gates are approved, `agent-test-kit run <agent>` will accept the
suite.
