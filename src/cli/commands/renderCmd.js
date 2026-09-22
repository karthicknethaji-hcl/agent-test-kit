const fs = require('fs');
const path = require('path');
const { renderAgent } = require('../../core/mdAuthoring/render');
const { checkMdStaleness } = require('../../core/mdAuthoring/sync');

// JSON -> Markdown. Warns (never blocks) if it's about to clobber unsynced
// .review.md edits — same "warn, don't block" posture as the rest of this
// package's persistence/authoring paths.
function renderCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit render <agent-name>');
  const agentDir = path.join(agentsDir, agentName);

  const stale = checkMdStaleness(agentDir);
  if (stale.length > 0) {
    console.warn(
      '[render] ' + stale.join(', ') + ' has edits that were never synced to JSON — overwriting anyway. ' +
      'Run `agent-test-kit sync ' + agentName + '` first if you want to keep them.'
    );
  }

  const { testCasesMd, rubricsMd } = renderAgent(agentDir);
  const testCasesMdPath = path.join(agentDir, 'test-cases.review.md');
  const rubricsMdPath = path.join(agentDir, 'rubrics.review.md');
  fs.writeFileSync(testCasesMdPath, testCasesMd, 'utf8');
  fs.writeFileSync(rubricsMdPath, rubricsMd, 'utf8');

  console.log('[render] wrote ' + testCasesMdPath);
  console.log('[render] wrote ' + rubricsMdPath);
}

module.exports = { renderCmd };
