/**
 * BullMQ worker process entry point — runs on Fly.io.
 *
 * Phase H2 hardening:
 *  - All workers share one ioredis connection (lib/queues.ts → getBullMqConnection)
 *  - DEFAULT_JOB_OPTS apply 5 attempts + exponential backoff + 7-day failed-job
 *    retention (DLQ behaviour) at enqueue time (lib/queues.ts).
 *  - SIGTERM/SIGINT → graceful drain: stop accepting new jobs, finish in-flight
 *    jobs up to 30s, then disconnect Redis cleanly. Critical for Fly.io rolling
 *    deploys (otherwise an in-flight WhatsApp send might be killed mid-fetch
 *    and the customer gets two receipts).
 */
import { Sentry } from "./sentry";
import { logger } from "@/lib/logger";
import { retentionWorker } from "./retention.worker";
import { receiptWorker } from "./receipt.worker";
import { voiceLogWorker } from "./voiceLog.worker";

const ALL_WORKERS = [voiceLogWorker, receiptWorker, retentionWorker];

logger.info(
  {
    event: "workers_started",
    workers: ALL_WORKERS.map((w) => w.name),
    pid: process.pid,
  },
  "BullMQ workers ready",
);

const GRACE_MS = 30_000;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: "shutdown_begin", signal, graceMs: GRACE_MS }, "draining workers");

  const deadline = Date.now() + GRACE_MS;
  try {
    await Promise.all(
      ALL_WORKERS.map(async (w) => {
        try {
          // Worker.close(force=false) waits for active jobs to finish.
          await w.close();
          logger.info({ event: "worker_closed", worker: w.name }, "worker drained");
        } catch (err) {
          logger.error(
            { event: "worker_close_failed", worker: w.name, error: err instanceof Error ? err.message : "unknown" },
            "failed to drain worker",
          );
        }
      }),
    );
    const drainTookMs = GRACE_MS - Math.max(0, deadline - Date.now());
    logger.info({ event: "shutdown_complete", drainTookMs }, "graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error(
      { event: "shutdown_error", error: err instanceof Error ? err.message : "unknown" },
      "shutdown error",
    );
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ event: "uncaught_exception", error: err.message, stack: err.stack }, "uncaughtException");
  Sentry.captureException(err);
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.fatal(
    {
      event: "unhandled_rejection",
      reason: reason instanceof Error ? reason.message : String(reason),
    },
    "unhandledRejection",
  );
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  // Do NOT crash on unhandledRejection; the worker should keep running and
  // surface the error via the "failed" handler when BullMQ retries the job.
});

// Capture every BullMQ "failed" event into Sentry too — already logged via pino,
// but Sentry gives us the dashboard + alerting + replay-by-attempt view.
[receiptWorker, voiceLogWorker].forEach((w) => {
  w.on("failed", (job, err) => {
    Sentry.captureException(err, {
      tags: {
        worker: w.name,
        jobName: job?.name,
        finalAttempt: String(job?.attemptsMade === job?.opts?.attempts),
      },
      extra: {
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        attemptsTotal: job?.opts?.attempts,
      },
    });
  });
});
