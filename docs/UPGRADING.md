# Upgrading

General steps are in the root `README.md` ("Upgrading"). This file lists what
is specific to each release. Newest first; apply every entry between your old
version and the new one, oldest first. If a release has no entry, no action is
needed beyond installing it.

When shipping a release that needs user action, add an entry here.

## 0.3.0 (from 0.2.x)

Per-agent folders now use `config/`, `review/` and `results/` subfolders
instead of a flat layout, and Markdown review files were added.

1. Migrate existing agent folders (one-time; a backup snapshot is made first):
   ```
   npx @karthicknethaji-hcl/agent-test-kit migrate-layout --dry-run
   npx @karthicknethaji-hcl/agent-test-kit migrate-layout
   ```
2. Generate the Markdown review files for Gate 1 review:
   ```
   npx @karthicknethaji-hcl/agent-test-kit render <agent-name>
   ```
   Edit the `.review.md` files in `review/`, then run
   `agent-test-kit sync <agent-name>` to write changes back to JSON/JS.

New agents created with `add-agent` already use the new layout.
