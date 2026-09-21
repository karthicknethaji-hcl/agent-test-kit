// Loads agent-test-kit.config.js from the consuming repo (scaffolded by
// `agent-test-kit init`) and fills in zero-config defaults for every
// pluggable adapter, so `agent-test-kit run <agent>` works out of the box
// with nothing configured, and a repo that needs its own provider/DB/auth
// only overrides the seam it actually needs.
const fs = require('fs');
const path = require('path');

const { createAnthropicJudgeClient } = require('../adapters/judgeClients/anthropicJudgeClient');
const { createJsonFileSink } = require('../adapters/resultsSinks/jsonFileSink');
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
    createResultsSink: userConfig.createResultsSink || (() => createJsonFileSink({ filePath: path.join(root, '.agent-test-kit-results.ndjson') })),
    createCredentialResolver: userConfig.createCredentialResolver || (() => createEnvCredentialResolver()),
    createTraceResolver: userConfig.createTraceResolver || (() => createIdentityTraceResolver())
  };
}

module.exports = { DEFAULT_CONFIG_FILENAME, findConfig, loadConfig };
