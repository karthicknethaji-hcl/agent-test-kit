const fs = require('fs');
const path = require('path');
const { saveReviewStatus, defaultReviewStatus } = require('../../core/reviewStatus');

function slugToPascal(slug) {
  return slug.split(/[-_]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

const TEST_CASES_TEMPLATE = (agentName) => JSON.stringify({
  agentName,
  schemaVersion: '1.0',
  note: 'Author test cases directly here — validated against src/core/schema/testCase.schema.json. See docs/CONTRACT.md.',
  testCases: [
    {
      testId: agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '-001',
      category: 'example',
      rubric: 'EX1',
      v1Scope: true,
      executionMode: 'single-turn',
      probe: { content: 'Replace this with a real probe for your agent.' },
      expectedBehaviorNote: 'Describe what a correct response looks like.',
      failureModeNote: 'Describe what a failing response looks like.'
    }
  ]
}, null, 2) + '\n';

const RUBRICS_TEMPLATE = `// See docs/CONTRACT.md "rubrics.js" for the full contract.
module.exports = {
  EX1: {
    metric: 'example-metric',
    evaluatorType: 'llm_judge',
    scale: 'binary',
    judgePromptTemplate:
      'Did the response satisfy the requirement below? Respond with ONLY ' +
      'JSON: {"violated": boolean, "recommendation": string|null}.\\n\\n' +
      'Requirement: describe it here.\\n\\nResponse:\\n{{output}}'
  }
};
`;

const INVOKE_CONFIG_TEMPLATE = (agentName, className) => `// See docs/CONTRACT.md "invoke-config.js" for the full contract:
// module.exports = { agentName, createConversationState(), async sendMessage(state, action) }
// Optionally also export smokeTestAction() if your agent's action shape
// isn't a plain {content} probe.

module.exports = {
  agentName: '${agentName}',

  createConversationState() {
    return { transcript: [] };
  },

  async sendMessage(state, action) {
    // TODO: replace this with your real call — see docs/CONTRACT.md for the
    // required return shape and docs/ARCHITECTURE.md "credentialResolver"
    // for how to resolve auth/session values instead of hardcoding them.
    throw new Error('${className}InvokeConfig.sendMessage() is not implemented yet.');
  }

  // async smokeTestAction() { return { content: 'ping' }; }
};
`;

const README_TEMPLATE = (agentName) => `# ${agentName}

Onboarded via agent-test-kit. See the root docs/CONTRACT.md for the file
contracts and docs/GETTING-STARTED.md for the pipeline this folder goes
through (generate -> Gate 1 review -> Gate 2 review -> run).

## Files
- \`test-cases.json\` — what to test (schema: src/core/schema/testCase.schema.json)
- \`rubrics.js\` — how each rubric is scored (schema: src/core/schema/rubric.schema.json)
- \`invoke-config.js\` — how to actually call this agent
- \`scriptChecks.js\` — only needed if any rubric is \`evaluatorType: 'script_diff'\`
- \`review-status.json\` — Gate 1 / Gate 2 approval, enforced by \`agent-test-kit run\`
`;

function addAgent(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit add-agent <name>');
  const agentDir = path.join(agentsDir, agentName);
  if (fs.existsSync(agentDir)) throw new Error('Agent folder already exists: ' + agentDir);

  fs.mkdirSync(agentDir, { recursive: true });
  const className = slugToPascal(agentName);
  fs.writeFileSync(path.join(agentDir, 'test-cases.json'), TEST_CASES_TEMPLATE(agentName), 'utf8');
  fs.writeFileSync(path.join(agentDir, 'rubrics.js'), RUBRICS_TEMPLATE, 'utf8');
  fs.writeFileSync(path.join(agentDir, 'invoke-config.js'), INVOKE_CONFIG_TEMPLATE(agentName, className), 'utf8');
  fs.writeFileSync(path.join(agentDir, 'README.md'), README_TEMPLATE(agentName), 'utf8');
  saveReviewStatus(agentDir, defaultReviewStatus());

  console.log('Scaffolded ' + agentDir);
  console.log('Next: fill in invoke-config.js, author real test-cases.json/rubrics.js, then:');
  console.log('  npx agent-test-kit validate ' + agentName);
}

module.exports = { addAgent };
