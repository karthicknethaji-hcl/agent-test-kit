// Loads agent-test-kit.config.js from the consuming repo (scaffolded by
// `agent-test-kit init`) and fills in zero-config defaults for every
// pluggable adapter, so `agent-test-kit run <agent>` works out of the box
// with nothing configured, and a repo that needs its own provider/DB/auth
// only overrides the seam it actually needs.
const fs = require('fs');
const path = require('path');

const { createAnthropicJudgeClient } = require('../adapters/judgeClients/anthropicJudgeClient');
const { createMarkdownSink } = require('../adapters/resultsSinks/markdownSink');
const { createEnvCredentialResolver } = require('../adapters/credentialResolvers/envCredentialResolver');
const { createIdentityTraceResolver } = require('../adapters/traceResolvers/identityTraceResolver');

const DEFAULT_CONFIG_FILENAME = 'agent-test-kit.config.js';

function findConfig(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, DEFAULT_CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadConfig(startDir) {
  const configPath = findConfig(startDir);
  const userConfig = configPath ? require(configPath) : {};
  const root = configPath ? path.dirname(configPath) : (startDir || process.cwd());
  const agentsDir = path.resolve(root, userConfig.agentsDir || 'test-suite/agents');

  return {
    configPath,
    root,
    agentsDir,
    createJudgeClient: userConfig.createJudgeClient || (() => createAnthropicJudgeClient()),
    // `dir`, not a fixed `filePath` — so the zero-config default gets a
    // fresh, timestamped file per run (see markdownSink.js) rooted at the
    // config's own directory rather than whatever process.cwd() happens to
    // be, without this file needing to know that naming scheme itself.
    // `agentName` is passed through from the CLI command (run/smoke) so the
    // default filename identifies which agent a report belongs to; a custom
    // `createResultsSink` override may ignore the argument if it doesn't need it.
    createResultsSink: userConfig.createResultsSink || ((agentName) => createMarkdownSink({ dir: root, agentName })),
    createCredentialResolver: userConfig.createCredentialResolver || (() => createEnvCredentialResolver()),
    createTraceResolver: userConfig.createTraceResolver || (() => createIdentityTraceResolver())
  };
}

module.exports = { DEFAULT_CONFIG_FILENAME, findConfig, loadConfig };
