<!--
Thanks for the PR! Please fill in the sections below.
For Conventional Commit examples, see CONTRIBUTING.md.
-->

## Summary

<!-- One sentence: what does this PR change? -->

## Motivation

<!-- Why is this change needed? Link the related issue with `Closes #123` or `Refs #123`. -->

## Type of change

- [ ] Bug fix (non-breaking — fixes an issue)
- [ ] New feature (non-breaking — adds functionality)
- [ ] Breaking change (fix or feature that changes existing input/output contracts)
- [ ] Documentation only
- [ ] Refactor / internal cleanup
- [ ] Test improvement
- [ ] Chore (deps, tooling, CI)

## Changes

<!-- Bullet list of the concrete changes: files touched, behaviors added or removed. -->

-
-
-

## Verification

<!-- How did you verify this works? Mark all that apply: -->

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (unit)
- [ ] `npm run test:int` passes (integration, against my Kanboard sandbox)
- [ ] Manually tested via an MCP client (specify which: Claude Code / Desktop / Cursor / etc.)
- [ ] Added unit test(s) covering the new behavior
- [ ] Added integration test(s) (if it touches the JSON-RPC client)

## Breaking changes

<!-- If this is a breaking change, describe what breaks and the migration path. Otherwise: "None." -->

## Documentation

- [ ] README updated (if user-facing behavior changed)
- [ ] CHANGELOG updated (under `## [Unreleased]`)
- [ ] `.kanboard.yaml` schema docs updated (if applicable)
- [ ] Tool catalog table in README updated (if a tool was added/renamed)

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.)
- [ ] No `any` types added without an explicit justifying comment
- [ ] No secrets in commits (the gitleaks pre-commit hook should have caught this; do not bypass)
- [ ] No new runtime dependencies, OR a discussion in an issue confirmed the addition

## Screenshots / output

<!-- If relevant, paste tool output, log snippets (auto-redacted), or terminal sessions showing the new behavior. -->
