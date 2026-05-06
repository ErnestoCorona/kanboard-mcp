#!/usr/bin/env tsx
/**
 * Board hygiene — `scripts/board-hygiene.ts`
 *
 * For a curated list of stale-but-done Kanboard cards in project 126:
 *   1. Adds a one-line audit comment.
 *   2. Moves the card to the "Erledigt" column (id 599) so visual board
 *      state matches logical state — Kanboard `closeTask` only flips
 *      `is_active`, it does NOT move the card; without this step a closed
 *      card stays in Backlog/Bereit and only appears under "show closed".
 *   3. Closes the card via `closeTask`.
 *
 * Closure path:
 *   1. Probe `closeTask` once via `handler.closeTask(probeId)`.
 *   2. On `closeTask` success → use it for every remaining card.
 *   3. On `closeTask` failure → fall back to a raw JSON-RPC
 *      `update_task({id, is_active: 0})` call.
 *
 * Move failures are logged warn-only and do NOT abort the close — the
 * card will still close, it just stays in its original column.
 *
 * This script is idempotent: re-running on already-closed cards produces
 * KanboardApiError on closeTask (Kanboard rejects closing a closed task);
 * the move step is also tolerant of cards that already live in Erledigt.
 *
 * TODO(v0.3.2): parametrize STALE_CARDS via CLI args, derive Erledigt
 * column id dynamically per project (currently hardcoded to 599 for
 * project 126).
 */

import { bootstrap } from "../src/transports/bootstrap.js";
import { AuthError, KanboardApiError } from "../src/shared/errors.js";

process.on("unhandledRejection", (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof AuthError && /getMe.*failed during initialization/.test(msg)) {
    process.stderr.write(
      `[board-hygiene] eager getMe() failed (transient server flake) — re-run.\n  detail: ${msg}\n`,
    );
    process.exit(2);
  }
  process.stderr.write(`[board-hygiene] unhandledRejection: ${msg}\n`);
  process.exit(2);
});

const STALE_CARDS: ReadonlyArray<{ id: number; reason: string }> = [
  { id: 6209, reason: "Epic v0.2.0 W-Cleanup — completed in v0.2.6" },
  { id: 6197, reason: "Integration-Tests gegen 125 — covered by v0.3.0 cleanup tracker" },
  { id: 6198, reason: "Epic v0.2.5 — released" },
  { id: 6203, reason: "Decision npm Package-Name — locked to @ernestocorona/kanboard-mcp in v0.3.0" },
  { id: 6205, reason: "Decision Identity — locked in v0.3.0 release" },
  { id: 6261, reason: "Acceptance update_project rename — done in v0.2.5/0.2.6" },
  { id: 6262, reason: "Epic v0.2.6 — released" },
];

const COMMENT_TEMPLATE = "Closed by v0.3.0 board hygiene — work completed.";
const PROJECT_ID = 126; // hardcoded for now (TODO v0.3.2: parametrize via CLI args)
const DONE_COLUMN_ID = 599; // "Erledigt" in project 126
const DEFAULT_SWIMLANE_ID = 170; // default swimlane in project 126

async function main(): Promise<number> {
  const { bundle, logger } = bootstrap(process.env);
  const { handler, apiClient } = bundle;

  let closeTaskAvailable: boolean | undefined;
  let closed = 0;
  let alreadyClosed = 0;
  let failed = 0;
  let moved = 0;
  let moveSkipped = 0;

  for (const card of STALE_CARDS) {
    // Add comment first (audit trail), best-effort.
    try {
      await handler.createComment({
        task_id: card.id,
        content: `${COMMENT_TEMPLATE} (${card.reason})`,
      });
      logger.info({ cardId: card.id }, "[board-hygiene] comment added");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ cardId: card.id, err: msg }, "[board-hygiene] comment failed (continuing)");
    }

    // Move card to Erledigt BEFORE closing so visual state matches logical state.
    // closeTask alone leaves the card in its original column and only "show closed"
    // filter reveals it — that's the bug this fix addresses.
    try {
      await handler.moveTaskPosition({
        project_id: PROJECT_ID,
        task_id: card.id,
        column_id: DONE_COLUMN_ID,
        position: 1,
        swimlane_id: DEFAULT_SWIMLANE_ID,
      });
      moved += 1;
      logger.info({ cardId: card.id, columnId: DONE_COLUMN_ID }, "[board-hygiene] moved to Erledigt");
    } catch (err) {
      // Already in Erledigt or other transient — log warn, continue to close anyway.
      moveSkipped += 1;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ cardId: card.id, err: msg }, "[board-hygiene] move skipped (continuing to close)");
    }

    // Probe closeTask once on the first card.
    if (closeTaskAvailable === undefined) {
      try {
        await handler.closeTask(card.id);
        closeTaskAvailable = true;
        closed += 1;
        logger.info({ cardId: card.id, path: "closeTask" }, "[board-hygiene] closed via closeTask (probe success)");
        continue;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("returned false") || msg.includes("not found")) {
          // Already closed or not present — count and continue trying closeTask.
          alreadyClosed += 1;
          closeTaskAvailable = true;
          logger.info({ cardId: card.id }, "[board-hygiene] closeTask returned false (already closed?) — keeping closeTask path");
          continue;
        }
        closeTaskAvailable = false;
        logger.warn(
          { cardId: card.id, err: msg },
          "[board-hygiene] closeTask probe failed — falling back to is_active:0 wire call",
        );
        // fall through to fallback path below
      }
    }

    // Fallback path — direct JSON-RPC `updateTask` with `is_active:0`.
    if (closeTaskAvailable === false) {
      try {
        const raw = await apiClient.call("updateTask", { id: card.id, is_active: 0 });
        if (raw === true) {
          closed += 1;
          logger.info({ cardId: card.id, path: "updateTask:is_active=0" }, "[board-hygiene] closed via fallback");
        } else {
          alreadyClosed += 1;
          logger.info({ cardId: card.id, raw }, "[board-hygiene] fallback returned non-true (already closed?)");
        }
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ cardId: card.id, err: msg }, "[board-hygiene] fallback close failed");
      }
      continue;
    }

    // Default path — closeTask known to work.
    try {
      await handler.closeTask(card.id);
      closed += 1;
      logger.info({ cardId: card.id, path: "closeTask" }, "[board-hygiene] closed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("returned false")) {
        alreadyClosed += 1;
        logger.info({ cardId: card.id }, "[board-hygiene] closeTask returned false (already closed)");
      } else {
        failed += 1;
        logger.warn({ cardId: card.id, err: msg }, "[board-hygiene] closeTask failed");
      }
    }
  }

  logger.info(
    { totalCards: STALE_CARDS.length, closed, alreadyClosed, failed, moved, moveSkipped, closeTaskAvailable },
    "[board-hygiene] summary",
  );

  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof KanboardApiError) {
      process.stderr.write(`[board-hygiene] KanboardApiError: ${msg}\n`);
    } else {
      process.stderr.write(`[board-hygiene] fatal: ${msg}\n`);
    }
    process.exit(1);
  },
);
