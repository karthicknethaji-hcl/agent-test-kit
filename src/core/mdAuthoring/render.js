// JSON -> Markdown rendering for the reviewer-facing "authoring layer" (see
// docs/SPEC-sink-reliability-and-md-authoring.md Feature 2). This is a
// round-trip format, not free-form Markdown: `sync.js` parses exactly what
// this file produces, so every shape choice here is also a parsing contract.
const fs = require('fs');
const { sha256 } = require('./hash');
const { getAgentPaths } = require('../agentPaths');

function jsonBlock(label, value) {
  return ['**' + label + ':**', '```json', JSON.stringify(value, null, 2), '```', ''];
}

function textBlock(label, value) {
  return ['**' + label + ':**', value, ''];
}

function renderTestCase(tc) {
  const lines = [];
  lines.push('## ' + tc.testId);
  lines.push('');
  lines.push('- **Category:** ' + tc.category);
  lines.push('- **Rubric:** ' + tc.rubric);
  lines.push('- **V1 Scope:** ' + tc.v1Scope);
  lines.push('- **Execution Mode:** ' + tc.executionMode);
  lines.push('');

  if (tc.executionMode === 'dual-conversation') {
    for (const convKey of ['conversationA', 'conversationB']) {
      const conv = tc[convKey] || {};
      lines.push('### Conversation ' + (convKey === 'conversationA' ? 'A' : 'B'));
      lines.push('');
      if (conv.setup !== undefined) lines.push(...jsonBlock('Setup', conv.setup));
      if (conv.probe !== undefined) lines.push(...jsonBlock('Probe', conv.probe));
    }
  } else {
    if (tc.probe !== undefined) lines.push(...jsonBlock('Probe', tc.probe));
    if (tc.setup !== undefined) lines.push(...jsonBlock('Setup', tc.setup));
  }

  if (tc.judgeContext !== undefined) lines.push(...jsonBlock('Judge Context', tc.judgeContext));
  if (tc.expectedBehaviorNote !== undefined) lines.push(...textBlock('Expected behavior', tc.expectedBehaviorNote));
  if (tc.failureModeNote !== undefined) lines.push(...textBlock('Failure mode', tc.failureModeNote));

  lines.push('---');
  lines.push('');
  return lines;
}

function renderTestCasesMd(testCasesModule, sourceHash) {
  const lines = [];
  lines.push('<!-- agent-test-kit:kind:test-cases -->');
  lines.push('<!-- agent-test-kit:agent:' + testCasesModule.agentName + ' -->');
  lines.push('<!-- agent-test-kit:source-hash:' + sourceHash + ' -->');
  lines.push('');
  lines.push('# Test Cases — ' + testCasesModule.agentName);
  lines.push('');
  lines.push('Schema version: ' + testCasesModule.schemaVersion);
  lines.push('');
  if (testCasesModule.sourceDoc !== undefined) lines.push(...textBlock('Source Doc', testCasesModule.sourceDoc));
  if (testCasesModule.note !== undefined) lines.push(...textBlock('Note', testCasesModule.note));

  for (const tc of testCasesModule.testCases) lines.push(...renderTestCase(tc));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderRubric(code, rubric) {
  const lines = [];
  lines.push('## ' + code);
  lines.push('');
  lines.push('- **Metric:** ' + rubric.metric);
  lines.push('- **Evaluator Type:** ' + rubric.evaluatorType);
  if (rubric.scale !== undefined) lines.push('- **Scale:** ' + rubric.scale);
  if (rubric.threshold !== undefined) lines.push('- **Threshold:** ' + rubric.threshold);
  lines.push('');

  if (rubric.judgePromptTemplate !== undefined) {
    lines.push('**Judge Prompt Template:**');
    lines.push('```');
    lines.push(rubric.judgePromptTemplate);
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  return lines;
}

function renderRubricsMd(rubricsConfig, agentName, sourceHash) {
  const lines = [];
  lines.push('<!-- agent-test-kit:kind:rubrics -->');
  lines.push('<!-- agent-test-kit:agent:' + agentName + ' -->');
  lines.push('<!-- agent-test-kit:source-hash:' + sourceHash + ' -->');
  lines.push('');
  lines.push('# Rubrics — ' + agentName);
  lines.push('');

  for (const code of Object.keys(rubricsConfig)) lines.push(...renderRubric(code, rubricsConfig[code]));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function requireFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

// renderAgent(agentDir) -> { testCasesMd, rubricsMd } — the actual entry
// point used by `agent-test-kit render` and by tests. Reads test-cases.json/
// rubrics.js straight off disk so the embedded source-hash always reflects
// exactly what's on disk right now, not whatever a stale require() cached.
function renderAgent(agentDir) {
  const paths = getAgentPaths(agentDir);
  const testCasesPath = paths.config.testCases;
  const rubricsPath = paths.config.rubrics;

  const testCasesRaw = fs.readFileSync(testCasesPath, 'utf8');
  const testCasesModule = JSON.parse(testCasesRaw);
  const rubricsRaw = fs.readFileSync(rubricsPath, 'utf8');
  const rubricsConfig = requireFresh(rubricsPath);

  const testCasesMd = renderTestCasesMd(testCasesModule, sha256(testCasesRaw));
  const rubricsMd = renderRubricsMd(rubricsConfig, testCasesModule.agentName, sha256(rubricsRaw));

  return { testCasesMd, rubricsMd };
}

module.exports = { renderTestCasesMd, renderRubricsMd, renderAgent };
