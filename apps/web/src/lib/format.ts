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

export function formatNumber(value: number, lng: string): string {
  return new Intl.NumberFormat(lng).format(value);
}
