---
name: run-agent-tests
description: Run an onboarded agent's approved test suite (npx agent-test-kit run <name>) from within Claude Code, resolving credentials automatically wherever possible instead of requiring the user to open a terminal. Use when the user asks to "run <agent>'s tests", "test <agent>", or similar.
---

# Run agent tests

Runs `agent-test-kit run <name>` for an already-validated, gate-approved
agent — entirely through your own tool calls, never by telling the caller to
open a terminal themselves. That friction is exactly what this skill exists
to remove.

## 1. Gather input

| Input | Required? | If not given |
|---|---|---|
| Agent name | **Yes** | Stop and ask. |
| `--only <ids>` / `--all` | No | Default: no flags — runs every `v1Scope: true` case. |

First run `npx agent-test-kit status <name>` — if it isn't schema-valid or
both gates aren't approved, stop and say so rather than attempting
`--skip-gate-check` on the caller's behalf; that flag is for the caller's own
deliberate local iteration, not something this skill should reach for.

## 2. Resolve credentials

Read `agent-test-kit.config.js` for which `credentialResolver` is configured.

- If it's the default `envCredentialResolver`: check `<AGENT_NAME>_<VAR>` env
  vars (named in the agent's own README.md). If any are missing, ask the
  caller to supply them, or — if this repo's agent needs a live session
  token the way a browser-authenticated app would (check the agent's
  README.md for this) — use the browser tool: start the app locally, check
  for an active session, and read the token via the page's own JS if one
  exists. Never type credentials yourself; ask the caller to sign in in the
  pane if no session is active, then continue once they confirm.
- If a custom resolver is configured: read its own file/comments for what it
  needs and how, and follow that instead.

## 3. Resolve the judge model

Check `agent-test-kit.config.js` for `createJudgeClient`. If it's the default
(`anthropicJudgeClient`) and `ANTHROPIC_API_KEY` isn't set: ask the caller
directly for one, OR offer the interactive alternative — `skillJudgeClient`
(see `docs/ARCHITECTURE.md`) — where you (this running session) answer each
judge prompt yourself instead of an API key being required. If you offer
that path, you must actually watch the exchange directory and respond to
each request file promptly; don't offer it and then not follow through.

## 4. Run it yourself

```
npx agent-test-kit run <agent-name> [--only <ids>] [--all]
```

Never hand this command to the caller to run themselves — that defeats the
point of this skill.

## 5. Report back

List every test id with its own PASS/FAIL/ERROR — the CLI's own console
output already prints one line per test id as it runs; include that full
list, not just the aggregate summary. Alongside it: the `runId`, where
results were persisted (the configured `resultsSink`'s destination — e.g. a
file path for the default `jsonFileSink`), any `ERROR` rows with their
message, and — for any failing case — its `recommendation` from the console
output, rather than making the caller go look it up themselves.
