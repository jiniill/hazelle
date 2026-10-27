export function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let corner = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, corner + (a[i - 1] === b[j - 1] ? 0 : 1));
      corner = above;
    }
  }
  return row[b.length]!;
}

export function nearest<T>(target: string, items: Iterable<T>, key: (item: T) => string, most: number): T | null {
  let best: T | null = null;
  let score = most + 1;
  for (const item of items) {
    const each = key(item);
    // A length gap alone takes that many edits.
    if (Math.abs(each.length - target.length) >= score) continue;
    const distance = editDistance(target, each);
    if (distance < score) [best, score] = [item, distance];
  }
  return best;
}
