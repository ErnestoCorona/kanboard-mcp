# How to set up integration tests

**You have:** a fork of kanboard-mcp, or you want to validate your local changes against a real Kanboard instance.

**You want:** the integration suite running end-to-end, hitting real HTTP endpoints, without any risk of writing into a production project.

**You'll use:** `.env`, the `RUN_INTEGRATION` flag, and a sandbox project with a name that contains `sandbox` or `test`.

---

## Why this is gated

The integration suite creates, mutates, and deletes real Kanboard entities. To make sure nobody accidentally runs it against a production project, the suite refuses to do anything unless **all three** of these are true:

1. `RUN_INTEGRATION=1` is set in the environment.
2. `KANBOARD_TEST_PROJECT_ID` points at a project that exists.
3. That project's name contains the substring `sandbox` or `test` (case-insensitive).

If any of these fail, the suite aborts before sending a single write request. This is enforced in code, not by convention — see `tests/integration/setup.ts`.

## The recipe

### 1. Create a sandbox project in Kanboard

Log into your Kanboard. Create a new project named exactly one of:

- `kanboard-mcp-sandbox`
- `kanboard-mcp-test`
- `<anything>-sandbox-<anything>`
- `<anything>-test-<anything>`

The string match is on the **project name**, not the identifier. Make it obvious so future you doesn't accidentally promote it to production.

Note the project's numeric id from the URL (`/board/42` → id is `42`).

### 2. Copy `.env.example` to `.env`

```bash
cp .env.example .env
```

### 3. Fill in `.env`

```env
RUN_INTEGRATION=1
KANBOARD_URL=https://your-kanboard.example.com
KANBOARD_USERNAME=your-login
KANBOARD_API_TOKEN=your-personal-token
KANBOARD_TEST_PROJECT_ID=42
```

> **Don't commit `.env`.** It's in `.gitignore` for a reason — it has your token. The pre-commit hook (gitleaks) will block any accidental attempt anyway.

### 4. Run the suite

```bash
npm run test:int
```

The suite:

- Creates entities prefixed `[TEST-{ISO-timestamp}]` so they're trivially identifiable.
- Cleans up after itself in `afterAll` hooks using v0.3 destructive tools (`delete_task`, `delete_column`, etc.).
- Aborts loudly if your project doesn't match the sandbox-name guard.

A passing run looks like:

```
✓ tests/integration/handler.live.spec.ts (15 tests) 8.4s
✓ tests/integration/tools.live.spec.ts (24 tests) 12.1s
✓ tests/integration/batch.live.spec.ts (7 tests) 3.9s

Test Files  3 passed (3)
     Tests  46 passed (46)
```

## Cleanup if a run is interrupted

If you `Ctrl-C` mid-suite, the `afterAll` hook may not run. You'll see leftover `[TEST-...]` entities on your sandbox board.

Options:

- **Easiest**: re-run the suite. Tests are isolated, so a clean run will leave the board tidy on completion.
- **Manual**: filter the board by `[TEST-` and bulk-delete from the Kanboard UI.
- **Scripted**: use `scripts/board-hygiene.ts` (in this repo) — it scans the configured project and closes any entity matching the test prefix.

## Running against a remote CI Kanboard

The same setup works in CI. In your pipeline secrets, store:

- `KANBOARD_URL`
- `KANBOARD_USERNAME`
- `KANBOARD_API_TOKEN`
- `KANBOARD_TEST_PROJECT_ID`

Then in your CI job:

```yaml
- name: Integration tests
  env:
    RUN_INTEGRATION: "1"
    KANBOARD_URL: ${{ secrets.KANBOARD_URL }}
    KANBOARD_USERNAME: ${{ secrets.KANBOARD_USERNAME }}
    KANBOARD_API_TOKEN: ${{ secrets.KANBOARD_API_TOKEN }}
    KANBOARD_TEST_PROJECT_ID: ${{ secrets.KANBOARD_TEST_PROJECT_ID }}
  run: npm run test:int
```

For CI, consider using **app mode** so the test project's audit log doesn't fill up under a human's name — see [Use application mode for bots and CI](./use-app-mode-for-bots-and-ci.md).

## Common issues

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| `Refusing to run: project name does not contain sandbox/test` | The Kanboard project's name doesn't match the guard | Rename the project, or create a new one with `sandbox` in the name |
| `RUN_INTEGRATION must be 1` | The env var isn't loaded | Check `.env` is at the repo root and not gitignored to a different path |
| Tests pass locally, fail in CI | CI's secrets aren't set | Verify the secrets exist and are referenced exactly |
| Leftover `[TEST-...]` entities | Previous run was interrupted | Run `scripts/board-hygiene.ts` or rerun the suite |

## See also

- [Configuration reference](../reference/configuration.md) for every env var the suite respects.
- [Use application mode for bots and CI](./use-app-mode-for-bots-and-ci.md) for the recommended CI auth setup.
