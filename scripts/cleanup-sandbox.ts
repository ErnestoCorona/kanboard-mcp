#!/usr/bin/env tsx
/**
 * Sandbox cleanup script — `scripts/cleanup-sandbox.ts`
 *
 * Drains test pollution (entities prefixed `[TEST-`) from a Kanboard sandbox /
 * test project. v0.3.0 scope: TASKS only (active + closed). Columns, swimlanes
 * and projects are intentionally NOT touched here:
 *   - columns: no `removeColumn` handler in v0.3.0 (separate epic, see ADR-6).
 *   - the sandbox PROJECT itself MUST never be deleted by this script.
 *
 * ── Dual safety gate (both MUST pass before any delete) ───────────────────
 *   1. The target project's `name` (or `identifier`) MUST match
 *      /sandbox|test/i. Bail with explicit error otherwise.
 *   2. Each candidate task `title` MUST start with the literal `[TEST-`
 *      prefix. Non-matching entities are SKIPPED (logged, never deleted).
 *
 * ── Idempotency ───────────────────────────────────────────────────────────
 * Re-running on a clean sandbox = no candidates = zero deletes = exit 0.
 *
 * ── Inputs ────────────────────────────────────────────────────────────────
 *   `--project-id <id>` CLI arg OR `KANBOARD_TEST_PROJECT_ID` env var.
 *   `KANBOARD_URL`, `KANBOARD_API_TOKEN`, `KANBOARD_USERNAME`,
 *   `KANBOARD_AUTH_MODE` are read from the process env. The script does NOT
 *   load `.env` — invoke it from a shell that already has the env exported,
 *   or wrap the call: `set -a; source .env; set +a; npx tsx scripts/...`.
 *
 * ── Output ────────────────────────────────────────────────────────────────
 * Structured JSON lines via Pino → stderr. Final summary line counts:
 *   { tasksDeleted, tasksSkipped, columnsDeleted: 0, columnsSkipped: <n> }
 *
 * Exit 0 when all candidates were processed (success OR skipped).
 * Exit 1 when the safety gate refused or a fatal error stopped processing.
 *
 * Per-entity delete failures are logged as warnings and counted, but DO NOT
 * abort the run — the goal is best-effort drain.
 *
 * Run: `npx tsx scripts/cleanup-sandbox.ts --project-id 125`
 */

import { bootstrap } from "../src/transports/bootstrap.js";
import { KanboardApiError, ConfigError, AuthError } from "../src/shared/errors.js";

// `KanboardHandler`'s ctor kicks off `getMe()` eagerly (eager-but-non-fatal contract).
// If the server flakes (transient HTML response, PHP warning, etc.), the rejection
// surfaces as an unhandledRejection BEFORE our `main().catch` can run. Trap it here:
// log a warning, return non-zero, but never let the process print a raw stack trace.
process.on("unhandledRejection", (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof AuthError && /getMe.*failed during initialization/.test(msg)) {
    process.stderr.write(
      `[cleanup-sandbox] eager getMe() failed (likely transient server flake) — re-run the script.\n` +
        `  detail: ${msg}\n`,
    );
    process.exit(2);
  }
  process.stderr.write(`[cleanup-sandbox] unhandledRejection: ${msg}\n`);
  process.exit(2);
});

// ── CLI / env arg parsing ─────────────────────────────────────────────────

function parseProjectId(): number {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--project-id");
  let raw: string | undefined;

  if (idx !== -1 && idx + 1 < argv.length) {
    raw = argv[idx + 1];
  } else {
    raw = process.env["KANBOARD_TEST_PROJECT_ID"];
  }

  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "[cleanup-sandbox] project id missing. " +
        "Pass `--project-id <id>` or set KANBOARD_TEST_PROJECT_ID.",
    );
  }

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `[cleanup-sandbox] invalid project id: "${raw}" (must be a positive integer).`,
    );
  }
  return id;
}

const TEST_PREFIX = "[TEST-";
const SAFE_NAME_RE = /sandbox|test/i;

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const projectId = parseProjectId();

  // bootstrap() validates env and constructs handler + logger.
  const { bundle, logger } = bootstrap(process.env);
  const { handler } = bundle;

  // Gate 1 — project name / identifier match.
  const project = await handler.getProjectById(projectId);
  const nameMatches =
    SAFE_NAME_RE.test(project.name) || SAFE_NAME_RE.test(project.identifier);

  if (!nameMatches) {
    logger.error(
      { projectId, projectName: project.name, projectIdentifier: project.identifier },
      "[cleanup-sandbox] REFUSED: project name/identifier does not match /sandbox|test/i",
    );
    return 1;
  }

  logger.info(
    { projectId, projectName: project.name },
    "[cleanup-sandbox] safety gate passed — proceeding",
  );

  // Gate 2 + drain — tasks (active + closed).
  let tasksDeleted = 0;
  let tasksSkipped = 0;
  let tasksFailed = 0;

  for (const statusId of [1, 0] as const) {
    const tasks = await handler.getAllTasks({ project_id: projectId, status_id: statusId });
    for (const task of tasks) {
      if (!task.title.startsWith(TEST_PREFIX)) {
        tasksSkipped += 1;
        logger.debug(
          { taskId: task.id, title: task.title, statusId },
          "[cleanup-sandbox] task skipped (no [TEST- prefix)",
        );
        continue;
      }
      try {
        await handler.removeTask(task.id);
        tasksDeleted += 1;
        logger.info(
          { taskId: task.id, title: task.title, statusId },
          "[cleanup-sandbox] task deleted",
        );
      } catch (err) {
        tasksFailed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { taskId: task.id, title: task.title, statusId, err: msg },
          "[cleanup-sandbox] task delete failed (continuing)",
        );
      }
    }
  }

  // Columns: NOT cleaned by this script in v0.3.0 (no removeColumn handler).
  // Surface the count so the operator knows how many would need a manual pass.
  let columnsSkipped = 0;
  try {
    const columns = await handler.getColumns(projectId);
    for (const col of columns) {
      if (col.title.startsWith(TEST_PREFIX)) columnsSkipped += 1;
    }
    if (columnsSkipped > 0) {
      logger.warn(
        { projectId, columnsSkipped },
        "[cleanup-sandbox] [TEST- columns present — manual cleanup required (no removeColumn handler in v0.3.0)",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[cleanup-sandbox] could not enumerate columns");
  }

  logger.info(
    {
      projectId,
      tasksDeleted,
      tasksSkipped,
      tasksFailed,
      columnsDeleted: 0,
      columnsSkipped,
    },
    "[cleanup-sandbox] summary",
  );

  return tasksFailed === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ConfigError) {
      process.stderr.write(`[cleanup-sandbox] ConfigError: ${msg}\n`);
    } else if (err instanceof KanboardApiError) {
      process.stderr.write(`[cleanup-sandbox] KanboardApiError: ${msg}\n`);
    } else {
      process.stderr.write(`[cleanup-sandbox] fatal: ${msg}\n`);
    }
    process.exit(1);
  },
);
