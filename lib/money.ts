/** Decimal dollars to integer millionths, without floating-point rounding. */
export function dollarAmount(value: string): number | null {
  const match = /^(0|[1-9]\d{0,2})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
  return amount <= 100_000_000 ? amount : null;
}
