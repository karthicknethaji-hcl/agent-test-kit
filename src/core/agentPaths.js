// Single source of truth for every path inside one agent's folder. Every
// module that used to build its own path.join(agentDir, '<literal>') calls
// this instead, so the on-disk layout (config/ review/ results/) is defined
// in exactly one place — see docs/ARCHITECTURE.md "Per-agent folder layout".
const path = require('path');

function getAgentPaths(agentDir) {
  return {
    dir: agentDir,
    readme: path.join(agentDir, 'README.md'),
    config: {
      dir: path.join(agentDir, 'config'),
      testCases: path.join(agentDir, 'config', 'test-cases.json'),
      rubrics: path.join(agentDir, 'config', 'rubrics.js'),
      invokeConfig: path.join(agentDir, 'config', 'invoke-config.js'),
      scriptChecks: path.join(agentDir, 'config', 'scriptChecks.js')
    },
    review: {
      dir: path.join(agentDir, 'review'),
      testCasesReview: path.join(agentDir, 'review', 'test-cases.review.md'),
      rubricsReview: path.join(agentDir, 'review', 'rubrics.review.md'),
      reviewStatus: path.join(agentDir, 'review', 'review-status.json')
    },
    results: {
      dir: path.join(agentDir, 'results')
    }
  };
}

module.exports = { getAgentPaths };
