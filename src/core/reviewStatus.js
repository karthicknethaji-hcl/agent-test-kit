// Two-gate approval tracking — replaces REVIEW.md's hand-checked "[x]
// Approved" markers with a small machine-readable file `run`/`validate` can
// actually enforce, since the old two-step ".md draft -> hand-transcribe"
// flow (and its own manual-gate-check step, "compile-agent-test-suite") is
// gone: agents now author test-cases.json/rubrics.js directly, so gate
// enforcement has to live in the tool that runs them, not in a separate
// compile step.
const fs = require('fs');
const path = require('path');
const { sha256 } = require('./mdAuthoring/hash');
const { getAgentPaths } = require('./agentPaths');

function reviewStatusPath(agentDir) {
  return getAgentPaths(agentDir).review.reviewStatus;
}

function defaultReviewStatus() {
  return {
    gate1: { approved: false, reviewer: null, date: null, notes: '', approvedContentHash: null },
    gate2: { approved: false, reviewer: null, date: null, notes: '', approvedContentHash: null }
  };
}

function loadReviewStatus(agentDir) {
  const p = reviewStatusPath(agentDir);
  if (!fs.existsSync(p)) return defaultReviewStatus();
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveReviewStatus(agentDir, status) {
  const p = reviewStatusPath(agentDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(status, null, 2) + '\n', 'utf8');
}

function isFullyApproved(status) {
  return !!(status && status.gate1 && status.gate1.approved && status.gate2 && status.gate2.approved);
}

// Hash of the combined test-cases.json + rubrics.js content — recorded as
// gate1/gate2's approvedContentHash at approval time, and recomputed here to
// detect drift since. Both files feed the combined hash via two independent
// sha256 calls (not string concatenation with a delimiter), so a change to
// either one invalidates what was actually reviewed with no risk of a
// delimiter character colliding with real file content.
function computeContentHash(agentDir) {
  const paths = getAgentPaths(agentDir);
  const testCasesRaw = fs.readFileSync(paths.config.testCases, 'utf8');
  const rubricsRaw = fs.readFileSync(paths.config.rubrics, 'utf8');
  return sha256(sha256(testCasesRaw) + sha256(rubricsRaw));
}

// Returns the list of approved gates (e.g. ['gate1'], ['gate1', 'gate2']) whose
// approvedContentHash no longer matches the on-disk content — i.e. the files
// changed (by hand, or via `sync`) since that gate was approved. A gate with
// no recorded approvedContentHash (approved before this field existed, or
// never stamped) is never flagged — informational only, never blocking.
function checkGateContentDrift(agentDir, status) {
  if (!status) return [];
  let currentHash;
  try {
    currentHash = computeContentHash(agentDir);
  } catch (e) {
    // Missing test-cases.json/rubrics.js (agent not fully onboarded yet) is
    // expected and fine — nothing to compare against. Anything else (a
    // permissions error, a bug in this brand-new hashing path) is a real
    // problem and must stay visible rather than silently going dark, even
    // though this check itself never blocks the caller.
    if (e && e.code !== 'ENOENT') {
      console.warn('[reviewStatus] could not check gate-content drift for ' + agentDir + ': ' + e.message);
    }
    return [];
  }
  const drifted = [];
  for (const gateName of ['gate1', 'gate2']) {
    const gate = status[gateName];
    if (gate && gate.approved && gate.approvedContentHash && gate.approvedContentHash !== currentHash) {
      drifted.push(gateName);
    }
  }
  return drifted;
}

// Shared by runCmd.js/validateCmd.js/syncCmd.js so the drift note's wording
// lives in exactly one place instead of being re-derived independently by
// every caller.
function warnIfGateContentDrifted(agentDir, status) {
  const drifted = checkGateContentDrift(agentDir, status);
  if (drifted.length > 0) {
    console.warn(
      'Note: test-cases.json/rubrics.js changed since ' + drifted.join('/') + ' ' +
      (drifted.length > 1 ? 'were' : 'was') + ' approved — you may want to re-review before trusting this run.'
    );
  }
  return drifted;
}

module.exports = {
  reviewStatusPath, defaultReviewStatus, loadReviewStatus, saveReviewStatus, isFullyApproved,
  computeContentHash, checkGateContentDrift, warnIfGateContentDrifted
};
