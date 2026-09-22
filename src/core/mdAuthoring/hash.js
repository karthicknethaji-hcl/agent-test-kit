// Shared sha256 helper — used both for the Markdown staleness marker
// (render.js/sync.js) and the gate-approval integrity check
// (reviewStatus.js's checkGateContentDrift), so the two mechanisms hash
// content identically.
const crypto = require('crypto');

function sha256(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

module.exports = { sha256 };
