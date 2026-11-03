const RETENTION_PERIOD_MONTHS = 12;

export function paymentEvidenceRetentionDeadline(closedAt: Date): Date {
  if (!Number.isFinite(closedAt.getTime())) {
    throw new RangeError("Order closure time must be a valid date");
  }

  const deadline = new Date(closedAt);
  const targetYear = deadline.getUTCFullYear() + Math.floor(RETENTION_PERIOD_MONTHS / 12);
  const targetMonth =
    (deadline.getUTCMonth() + (RETENTION_PERIOD_MONTHS % 12)) % 12;
  const targetDay = Math.min(
    deadline.getUTCDate(),
    new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate(),
  );
  deadline.setUTCFullYear(targetYear, targetMonth, targetDay);
  return deadline;
}
