const path = require('path');
const { checkMdStaleness } = require('../../core/mdAuthoring/sync');

// Read-only; always exits 0. Exists so the generate-agent-test-suite skill
// can call it before drafting fresh JSON and relay the warning, per
// docs/SPEC-sink-reliability-and-md-authoring.md "Staleness protection".
function checkMdStalenessCmd(agentsDir, agentName) {
  if (!agentName) throw new Error('Usage: agent-test-kit check-md-staleness <agent-name>');
  const agentDir = path.join(agentsDir, agentName);
  const stale = checkMdStaleness(agentDir);

  if (stale.length === 0) {
    console.log('[check-md-staleness] ' + agentName + ': up to date (or nothing rendered yet).');
  } else {
    console.warn(
      '[check-md-staleness] ' + agentName + ': ' + stale.join(', ') + ' no longer matches the JSON/JS it was ' +
      'rendered from — run `agent-test-kit sync ' + agentName + '` to pull the .review.md\'s current content ' +
      'into test-cases.json/rubrics.js, or `agent-test-kit render ' + agentName + '` to overwrite the .review.md ' +
      'from the current JSON/JS. If you\'re about to regenerate test-cases.json/rubrics.js from scratch (e.g. via ' +
      'the generate-agent-test-suite skill), doing so now will discard whichever side has the newer edits.'
    );
  }

  return stale;
}

module.exports = { checkMdStalenessCmd };
