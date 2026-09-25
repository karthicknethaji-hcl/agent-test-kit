const fs = require('fs');
const path = require('path');
const { renderAgent } = require('../../core/mdAuthoring/render');
const { checkMdStaleness } = require('../../core/mdAuthoring/sync');
const { getAgentPaths } = require('../../core/agentPaths');

// JSON -> Markdown. Warns (never blocks) if it's about to clobber unsynced
// .review.md edits — same "warn, don't block" posture as the rest of this
// package's persistence/authoring paths.
function renderCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit render <agent-name>');
  const agentDir = path.join(agentsDir, agentName);
  const paths = getAgentPaths(agentDir);

  const stale = checkMdStaleness(agentDir);
  if (stale.length > 0) {
    console.warn(
      '[render] ' + stale.join(', ') + ' has edits that were never synced to JSON — overwriting anyway. ' +
      'Run `agent-test-kit sync ' + agentName + '` first if you want to keep them.'
    );
  }

  const { testCasesMd, rubricsMd } = renderAgent(agentDir);
  fs.mkdirSync(paths.review.dir, { recursive: true });
  fs.writeFileSync(paths.review.testCasesReview, testCasesMd, 'utf8');
  fs.writeFileSync(paths.review.rubricsReview, rubricsMd, 'utf8');

  console.log('[render] wrote ' + paths.review.testCasesReview);
  console.log('[render] wrote ' + paths.review.rubricsReview);
}

module.exports = { renderCmd };
