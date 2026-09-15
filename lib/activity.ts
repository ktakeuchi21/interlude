export function activityMasks(start: number, end: number) {
  const slots = new Map<number, { minute: number; low: number; high: number }>();
  // Complete seconds only. Two 30-bit masks avoid JavaScript signed-bit overflow.
  for (let second = Math.ceil(start / 1000); second < Math.floor(end / 1000); second++) {
    const minute = Math.floor(second / 60) * 60;
    const entry = slots.get(minute) ?? { minute, low: 0, high: 0 };
    const bit = second - minute;
    if (bit < 30) entry.low |= 1 << bit; else entry.high |= 1 << (bit - 30);
    slots.set(minute, entry);
  }
  return [...slots.values()];
}
export function bitCount(n: number) { let count = 0; while (n) { n &= n - 1; count++; } return count; }
