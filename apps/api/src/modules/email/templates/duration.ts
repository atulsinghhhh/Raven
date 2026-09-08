/**
 * "60 minutes" reads as a machine talking; "1 hour" reads as a sentence.
 * Used only for the expiry line in credential emails, where the number is
 * the difference between a user retrying and a user emailing support.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
