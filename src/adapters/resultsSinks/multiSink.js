// Fans write()/finalize() out to a list of sinks, so a repo can persist
// results to more than one destination in a single run (e.g. a Markdown
// report AND a database table) without either sink knowing the other
// exists. Each child sink still receives the exact same canonical row.
function createMultiSink(sinks) {
  if (!Array.isArray(sinks) || sinks.length === 0) {
    throw new Error('multiSink: sinks must be a non-empty array.');
  }
  function label(sink) {
    return typeof sink.describe === 'function' ? sink.describe() : 'unnamed sink';
  }

  return {
    describe() {
      return sinks.map(label).join('; ');
    },
    // Fans out to every child that implements preflight(), skipping the
    // rest — a child with no preflight() has nothing cheap to probe. Runs
    // them concurrently (each is typically an independent network probe,
    // e.g. two Supabase-backed sinks) and isolates each child's own
    // rejection into an { ok: false, reason } entry rather than letting one
    // failing child's exception take down every other child's result (and,
    // via runCmd.js, the whole run) — preflight() is documented as never
    // throwing, and a well-behaved child sink shouldn't either, but a
    // third-party one might. Returns one { describe, ok, reason? } entry per
    // probed child so a caller can report per-sink, not just per-run.
    async preflight() {
      const probed = sinks.filter((sink) => typeof sink.preflight === 'function');
      const results = await Promise.all(probed.map((sink) =>
        Promise.resolve()
          .then(() => sink.preflight())
          .catch((e) => ({ ok: false, reason: e.message }))
      ));
      return probed.map((sink, i) => Object.assign({ describe: label(sink) }, results[i]));
    },
    // Isolates each child's own rejection (warn + continue) rather than
    // letting one misbehaving sink's throw abort the loop and silently skip
    // every sink listed after it — the same isolation posture preflight()
    // and close() already apply, for the same reason: every built-in sink
    // already avoids throwing from write()/finalize(), but nothing enforces
    // that for a third-party one.
    async write(row) {
      const outcomes = await Promise.allSettled(sinks.map((sink) => sink.write(row)));
      outcomes.forEach((outcome, i) => {
        if (outcome.status === 'rejected') {
          console.warn('[multiSink] ' + label(sinks[i]) + ' write() failed for ' + row.testId + ': ' + outcome.reason.message);
        }
      });
    },
    async finalize(runSummary) {
      const finalizable = sinks.filter((sink) => typeof sink.finalize === 'function');
      const outcomes = await Promise.allSettled(finalizable.map((sink) => sink.finalize(runSummary)));
      outcomes.forEach((outcome, i) => {
        if (outcome.status === 'rejected') {
          console.warn('[multiSink] ' + label(finalizable[i]) + ' finalize() failed: ' + outcome.reason.message);
        }
      });
    },
    // Best-effort, never throws — attempts EVERY child's close() even if an
    // earlier one fails, so one misbehaving child (e.g. an mcpSink whose
    // transport teardown errors) can never prevent its siblings from closing
    // their own resources (a naive sequential loop with a bare `await` would
    // abandon later children on the first rejection).
    async close() {
      const closable = sinks.filter((sink) => typeof sink.close === 'function');
      const outcomes = await Promise.allSettled(closable.map((sink) => sink.close()));
      outcomes.forEach((outcome, i) => {
        if (outcome.status === 'rejected') {
          console.warn('[multiSink] ' + label(closable[i]) + ' close() failed: ' + outcome.reason.message);
        }
      });
    },
    // One level only — a caller that needs to reach into a nested multiSink
    // (a multiSink whose own children include another multiSink) recurses
    // itself; see resultsCmd.js's resolveQuerySinks().
    getChildren() {
      return sinks.slice();
    },
    // One entry per child sink (so a caller can print one line per sink),
    // with stats: null for children that don't track attempted/failed
    // counts, or that threw while computing them (isolated the same way as
    // preflight() above, so one misbehaving child doesn't blank out the
    // others' real stats).
    getStats() {
      return sinks.map((sink) => {
        if (typeof sink.getStats !== 'function') return { describe: label(sink), stats: null };
        try {
          return { describe: label(sink), stats: sink.getStats() };
        } catch (e) {
          return { describe: label(sink), stats: null };
        }
      });
    }
  };
}

module.exports = { createMultiSink };
