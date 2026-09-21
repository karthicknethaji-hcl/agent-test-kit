// Two-gate approval tracking — replaces REVIEW.md's hand-checked "[x]
// Approved" markers with a small machine-readable file `run`/`validate` can
// actually enforce, since the old two-step ".md draft -> hand-transcribe"
// flow (and its own manual-gate-check step, "compile-agent-test-suite") is
// gone: agents now author test-cases.json/rubrics.js directly, so gate
// enforcement has to live in the tool that runs them, not in a separate
// compile step.
const fs = require('fs');
const path = require('path');

function reviewStatusPath(agentDir) {
  return path.join(agentDir, 'review-status.json');
}

function defaultReviewStatus() {
  return {
    gate1: { approved: false, reviewer: null, date: null, notes: '' },
    gate2: { approved: false, reviewer: null, date: null, notes: '' }
  };
}

function loadReviewStatus(agentDir) {
  const p = reviewStatusPath(agentDir);
  if (!fs.existsSync(p)) return defaultReviewStatus();
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveReviewStatus(agentDir, status) {
  fs.writeFileSync(reviewStatusPath(agentDir), JSON.stringify(status, null, 2) + '\n', 'utf8');
}

function isFullyApproved(status) {
  return !!(status && status.gate1 && status.gate1.approved && status.gate2 && status.gate2.approved);
}

module.exports = { reviewStatusPath, defaultReviewStatus, loadReviewStatus, saveReviewStatus, isFullyApproved };
