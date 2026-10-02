---
name: GitHub workflow pushes
description: Permission requirements when publishing history that changes GitHub Actions workflow files.
---

When publishing commits that add or change `.github/workflows`, ordinary repository write access may not be enough. GitHub can require the separate `workflow` scope for OAuth or classic tokens, or `Workflows: write` alongside `Contents: write` for fine-grained tokens. The connected GitHub API can create Git objects without having permission to move a branch ref.

**Why:** The GitHub connection could upload blobs, trees, and commits, but its ref updates were denied while the history contained a workflow-file change. A standard Git push with workflow-write permission succeeded.

**How to apply:** Before importing history, check for `.github/workflows` changes and confirm the write authorization covers them. Use a token limited to the target repository, guard replacement of a temporary ref with `--force-with-lease`, and verify the remote head and history afterward.