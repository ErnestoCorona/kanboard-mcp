# Contributing to Kanboard MCP

Thanks for considering a contribution! This document covers local setup, the development workflow, and how to submit changes.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.

## Getting started

### Prerequisites

- Node.js >= 22
- A Kanboard instance you control (only required for integration tests; unit tests run offline)

### Setup

```bash
git clone https://github.com/ErnestoCorona/kanboard-mcp.git
cd kanboard-mcp
npm install
```

The post-install hook configures `husky` + `gitleaks` pre-commit checks. Commits containing secrets will be blocked automatically.

### Verify

```bash
npm run typecheck   # TypeScript strict, no emit
npm run lint        # ESLint flat config
npm test            # 837 unit tests, no network
```

All three must pass before opening a PR.

## Development workflow

### Running tests

```bash
npm test                    # unit tests (default)
npm run test:unit           # explicit unit-only
npm run test:int            # integration tests (requires .env + RUN_INTEGRATION=1)
```

Unit tests run on every PR via GitHub Actions. Integration tests are run locally — they hit a real Kanboard instance and are gated by a sandbox-only safety check (the project name must contain `sandbox` or `test`).

### Code style

- **TypeScript strict mode**, no `any`. Use `unknown` and narrow it deliberately.
- **ESLint flat config** — run `npm run lint:fix` to auto-fix.
- **Prettier** — configured via `.prettierrc`; please enable format-on-save in your editor.
- **File naming**: kebab-case for filenames, camelCase for variables, PascalCase for types and classes.
- **Tests** mirror the source tree under `tests/unit/<mirror-of-src-tree>/`.
- **Imports** — relative within the package, no deep cross-module reaches.

### Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add list_project_users tool
fix: resolve column ambiguity in move_task_position
docs: clarify .kanboard.yaml walk-up behavior
chore: bump dependencies
test: add coverage for retry logic on 429
refactor: extract isoToEpoch helper
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.

Commits should be small, single-purpose, and pass tests at every step. Squash-merge is the default for PRs with multiple WIP commits.

## Submitting a Pull Request

1. **Fork** the repo and create a feature branch from `main`.
2. **Make your changes**, including tests.
3. **Verify locally**: `npm run typecheck && npm run lint && npm test` all green.
4. **Commit** with a Conventional Commit message.
5. **Push** and open a PR using the template at `.github/PULL_REQUEST_TEMPLATE.md`.
6. **Fill in** the PR description: motivation, summary of the change, how to verify, and any breaking-change notes.

### What we look for

- Strict types — no `any`, all Zod schemas declared.
- Tests covering the new behavior (unit minimum; integration if it touches the JSON-RPC client).
- Single-purpose commits with clear messages.
- Updated documentation if user-facing behavior changed.
- No new runtime dependencies without a discussion in an issue first.

### What gets PRs rejected

- Adding `any` types without an explicit, justified reason in a comment.
- New features without tests.
- Breaking changes without a migration note in the PR description.
- Commits containing secrets — the pre-commit hook blocks these. Do **not** bypass with `--no-verify`; rebase and remove the secret instead.
- Merge conflicts left unresolved.

## Reporting bugs

Open a GitHub issue using the **Bug Report** template. Include:

- `kanboard-mcp` version (from `package.json` or `npm list -g @ernestocorona/kanboard-mcp`).
- Node.js version (`node --version`).
- Kanboard server version (visible at `<your-kanboard-url>/?controller=ConfigController&action=index` if you're an admin).
- Auth mode (`personal` or `app`).
- A minimal reproduction: the tool name + arguments, the expected outcome, the actual outcome.
- Relevant logs from stderr (they are auto-redacted; safe to paste).

## Asking questions

For usage questions or design discussions, use the **Question** issue template, or open a [GitHub Discussion](https://github.com/ErnestoCorona/kanboard-mcp/discussions) once enabled on the repo.

## Security

If you discover a security vulnerability, please **do not** open a public issue. Follow the private disclosure process in [SECURITY.md](./SECURITY.md).
