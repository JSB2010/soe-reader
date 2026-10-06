import { DateTime } from "luxon";
import { AppError } from "./model";
export function parseWallTime(value: string, zone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new AppError(400, "Use a date and time with minute precision.");
  const dt = DateTime.fromISO(value, { zone });
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value)
    throw new AppError(
      400,
      "This time does not exist in the selected timezone.",
    );
  if (dt.getPossibleOffsets().length > 1)
    throw new AppError(
      400,
      "This time is ambiguous because clocks move back. Choose a time outside the repeated hour.",
    );
  return dt.toMillis();
}
export function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new AppError(400, "The start time must be before the end time.");
  if (end - start > 31 * 86400000)
    throw new AppError(400, "An access window may last at most 31 days.");
}
