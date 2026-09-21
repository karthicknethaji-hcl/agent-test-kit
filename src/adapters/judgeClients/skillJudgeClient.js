// Optional judgeClient adapter for the Claude-Code-in-the-loop path.
//
// The CLI (bin/agent-test-kit.js) always runs as its own Node subprocess —
// even when launched from inside a Claude Code session, it has no privileged
// access to "that session's own model." The default judgeClient
// (anthropicJudgeClient) therefore makes its own independent API call and
// needs its own ANTHROPIC_API_KEY.
//
// This adapter is the alternative for the interactive path only: it writes
// each judge prompt to a request file and BLOCKS waiting for a response file
// to appear, so a wrapping Claude Code skill (e.g. the run-agent-tests skill
// in plugin/skills/) can watch the request directory, answer each prompt
// itself — reasoning as the running assistant, no API key needed — and drop
// the answer in the response file. This is useless for headless/CI use
// (nothing is watching the directory there); use anthropicJudgeClient (or
// your own provider) for that.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createSkillJudgeClient(options) {
  const opts = options || {};
  const dir = opts.exchangeDir || path.join(process.cwd(), '.agent-test-kit-judge-exchange');
  const pollMs = opts.pollIntervalMs || 500;
  const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;

  fs.mkdirSync(dir, { recursive: true });

  return async function callJudgeModel(promptText) {
    const id = crypto.randomUUID();
    const reqPath = path.join(dir, id + '.request.txt');
    const resPath = path.join(dir, id + '.response.txt');
    fs.writeFileSync(reqPath, promptText, 'utf8');

    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(resPath)) {
      if (Date.now() > deadline) {
        throw new Error(
          'skillJudgeClient: no response for judge request ' + id + ' within ' + timeoutMs + 'ms. ' +
          'Is the wrapping Claude Code skill actually watching ' + dir + '?'
        );
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    const responseText = fs.readFileSync(resPath, 'utf8');
    fs.unlinkSync(reqPath);
    fs.unlinkSync(resPath);
    return responseText;
  };
}

module.exports = { createSkillJudgeClient };
