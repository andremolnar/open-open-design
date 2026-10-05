---
description: Validate, document, commit, and open a PR for the current work
---

Ship the requested work to this repository through a reviewable PR. Additional scope or instructions: $ARGUMENTS

Follow `AGENTS.md`, `CONTRIBUTING.md`, and `.github/pull_request_template.md`. This command is authorization to ship the *identified* work, not to include every change in the checkout. Do not treat a pre-existing dirty working tree as yours to stage, revert, or overwrite.

1. Inspect branch, upstream, status, staged and unstaged diffs, untracked files, and recent commits. Identify which files belong to this shipment; if the work spans unrelated changes or ownership is unclear, ask before staging. Never include credentials, local config, generated data, or other personal state.
2. If on `main`, create a descriptive topic branch from the current HEAD without discarding local changes. If on a branch for a different concern, ask before using it. Never force-push or push directly to `main` by default.
3. Load `changelog-entries` and summarize notable user-visible outcomes under the existing `## [Unreleased]` heading in `CHANGELOG.md`. This repository does not create a new version heading or release note for each PR: do not bump the version or manufacture a date. If this is internal-only and needs no changelog entry, say why. Keep unrelated Unreleased entries unchanged.
4. Run `git diff --check`, `pnpm guard`, `pnpm typecheck`, and the package-scoped tests/builds relevant to the changed files. Follow any additional validation in `AGENTS.md`. Fix failures introduced by this work. Report pre-existing or unverified failures; do not silently claim checks passed or ship a failing change without the user's explicit decision.
5. Stage only the identified paths and review `git diff --cached` and `git diff --cached --name-only`. Load `kick-ass-commit` to write an imperative, scope-aware message explaining what changed and why. Do not add `Co-authored-by` or other co-author metadata. Commit only nonempty staged changes, then inspect `git log -1 --format=%B` before pushing.
6. Push the topic branch to `origin` without force. Open or update a PR against `main` using every applicable section of `.github/pull_request_template.md`: Why (use case and pain), What users will see, all touched Surface area boxes, screenshots showing the entry point for UI changes, bug red-spec evidence where applicable, validation, and adjacent issues. Link an existing issue when one is being closed; for non-trivial features follow `CONTRIBUTING.md`'s issue-first rule rather than inventing an issue number. If PR creation or push is blocked, stop and report the blocker instead of claiming shipment.
7. Report the branch, commit SHA, pushed ref, PR URL, changelog entry (or why omitted), and validation results. Mention any known gaps plainly.
