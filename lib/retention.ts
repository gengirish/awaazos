/**
 * How long AwaazOS keeps data it deletes on its own (the Privacy page promises
 * these numbers): voice parse logs 90 days, receipts 7 years (GST/accounting
 * horizon). Pure, so the cut-offs are testable without a database; the
 * deletes live in lib/retention-server.ts.
 */

export const VOICE_LOG_RETENTION_DAYS = 90;
export const RECEIPT_RETENTION_YEARS = 7;

export type RetentionCutoffs = { voiceLogsBefore: Date; receiptsBefore: Date };

/** Rows created strictly before these instants are deleted. */
export function retentionCutoffs(now: Date = new Date()): RetentionCutoffs {
  const receiptsBefore = new Date(now);
  receiptsBefore.setUTCFullYear(receiptsBefore.getUTCFullYear() - RECEIPT_RETENTION_YEARS);
  return {
    voiceLogsBefore: new Date(now.getTime() - VOICE_LOG_RETENTION_DAYS * 24 * 3600 * 1000),
    receiptsBefore,
  };
}
