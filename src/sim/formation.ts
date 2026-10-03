/** Even grid around a point so a group does not stand on one tile. */
export function formationPoints(count: number, x: number, y: number, spacing = 0.9): { x: number; y: number }[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
  const rows = Math.ceil(count / cols);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    points.push({
      x: x + (col - (cols - 1) / 2) * spacing,
      y: y + (row - (rows - 1) / 2) * spacing,
    });
  }
  return points;
}
