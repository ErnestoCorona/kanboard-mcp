#!/usr/bin/env tsx
/**
 * Board hygiene — `scripts/board-hygiene.ts`
 *
 * For a list of stale-but-done Kanboard cards (provided via JSON file):
 *   1. Adds a one-line audit comment on each.
 *   2. Moves the card to the configured "done" column so visual board state
 *      matches logical state — Kanboard `closeTask` only flips `is_active`,
 *      it does NOT move the card; without this step a closed card stays in
 *      its original column and only appears under "show closed".
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
 * the move step is also tolerant of cards already in the done column.
 *
 * Usage:
 *   npx tsx scripts/board-hygiene.ts \
 *     --project-id <id> \
 *     --done-column-id <id> \
 *     --default-swimlane-id <id> \
 *     --cards path/to/cards.json
 *
 * cards.json shape: [{ "id": <number>, "reason": "<string>" }, ...]
 */

import { promises as fs } from "node:fs";
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

interface StaleCard {
  id: number;
  reason: string;
}

function parseRequiredIntArg(name: string): number {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) {
    throw new Error(`[board-hygiene] missing required arg: ${name} <id>`);
  }
  const raw = argv[idx + 1] as string;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `[board-hygiene] invalid value for ${name}: "${raw}" (must be a positive integer)`,
    );
  }
  return id;
}

function parseRequiredStringArg(name: string): string {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(name);
  if (idx === -1 || idx + 1 >= argv.length) {
    throw new Error(`[board-hygiene] missing required arg: ${name} <value>`);
  }
  return argv[idx + 1] as string;
}

async function loadCards(path: string): Promise<StaleCard[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[board-hygiene] cannot read --cards file "${path}": ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[board-hygiene] --cards file is not valid JSON: ${msg}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[board-hygiene] --cards file must contain a JSON array`);
  }

  for (const c of parsed) {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof (c as Record<string, unknown>)["id"] !== "number" ||
      typeof (c as Record<string, unknown>)["reason"] !== "string"
    ) {
      throw new Error(`[board-hygiene] each card must be { id: number, reason: string }`);
    }
  }

  return parsed as StaleCard[];
}

const COMMENT_TEMPLATE = "Closed by board hygiene — work completed.";

async function main(): Promise<number> {
  const projectId = parseRequiredIntArg("--project-id");
  const doneColumnId = parseRequiredIntArg("--done-column-id");
  const defaultSwimlaneId = parseRequiredIntArg("--default-swimlane-id");
  const cardsPath = parseRequiredStringArg("--cards");
  const staleCards = await loadCards(cardsPath);

  const { bundle, logger } = bootstrap(process.env);
  const { handler, apiClient } = bundle;

  let closeTaskAvailable: boolean | undefined;
  let closed = 0;
  let alreadyClosed = 0;
  let failed = 0;
  let moved = 0;
  let moveSkipped = 0;

  for (const card of staleCards) {
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

    // Move card to done column BEFORE closing so visual state matches logical state.
    // closeTask alone leaves the card in its original column and only "show closed"
    // filter reveals it — that's the bug this fix addresses.
    try {
      await handler.moveTaskPosition({
        project_id: projectId,
        task_id: card.id,
        column_id: doneColumnId,
        position: 1,
        swimlane_id: defaultSwimlaneId,
      });
      moved += 1;
      logger.info({ cardId: card.id, columnId: doneColumnId }, "[board-hygiene] moved to done column");
    } catch (err) {
      // Already in done column or other transient — log warn, continue to close anyway.
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
    { totalCards: staleCards.length, closed, alreadyClosed, failed, moved, moveSkipped, closeTaskAvailable },
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
