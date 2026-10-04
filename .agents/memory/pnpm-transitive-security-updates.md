---
name: pnpm transitive security updates
description: Updating nested vulnerable packages and keeping the installed graph aligned with the lockfile across the workspace.
---

For semver-compatible transitive fixes, use `pnpm --filter <workspace> update --latest --depth Infinity <package...>`, then run `pnpm install --frozen-lockfile` at the repository root so filtered and unfiltered workspace installs match the lockfile. Confirm the affected project's installed graph with `pnpm --filter <workspace> why <package>` after the root install.

**Why:** A filtered update changed the lockfile while another workspace's installed graph still reported its old version; the default update depth also missed nested dependencies.

**How to apply:** Use this only when the parent dependency accepts the updated version. If its range blocks a safe patch, use a narrow override and test the consumer for API compatibility.