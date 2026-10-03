const MONTH_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function monthFormatter(lng: string): Intl.DateTimeFormat {
  const cached = MONTH_FORMAT_CACHE.get(lng);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(lng, { month: 'long' });
  MONTH_FORMAT_CACHE.set(lng, formatter);
  return formatter;
}

export function formatMonthLabel(period: string, lng: string): string {
  const monthNum = Math.trunc(Number(period.slice(5, 7)));
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return period.slice(5);
  const probe = new Date(Date.UTC(2024, monthNum - 1, 1));
  return monthFormatter(lng).format(probe);
}

export function formatUnixTimestamp(timestampSeconds: number, lng: string): string {
  return new Date(timestampSeconds * 1000).toLocaleString(lng);
}

export function formatUnixDate(timestampSeconds: number, lng: string): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString(lng);
}

export function formatCurrency(amount: number, currency: string, lng: string): string {
  try {
    return new Intl.NumberFormat(lng, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Formats an amount whose currency may be unknown.
 *
 * `null` means the total spans more than one currency, so no symbol can honestly
 * be attached. Rendering a `$` anyway is worse than rendering nothing: it is a
 * confident wrong answer, where a bare number is visibly incomplete and a reader
 * knows to ask. Compact formatting is for chart labels, where the exact cent is
 * noise and horizontal space is scarce.
 */
export function formatAmount(amount: number, currency: string | null, lng: string, compact = false): string {
  if (currency === null) {
    const magnitudeLabel = new Intl.NumberFormat(lng, compact ? { notation: 'compact' } : {}).format(compact ? Math.round(amount) : amount);
    return compact ? `~${magnitudeLabel}` : `${magnitudeLabel} (mixed currency)`;
  }
  try {
    const options: Intl.NumberFormatOptions = { style: 'currency', currency };
    if (compact) {
      options.notation = 'compact';
    }
    return new Intl.NumberFormat(lng, options).format(amount);
  } catch {
    return `${currency} ${compact ? Math.round(amount) : amount.toFixed(2)}`;
  }
}

