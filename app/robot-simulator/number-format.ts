export function formatDisplayNumber(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return String(value);
  const formatted = value.toFixed(fractionDigits);
  return Number(formatted) === 0 ? (0).toFixed(fractionDigits) : formatted;
}
