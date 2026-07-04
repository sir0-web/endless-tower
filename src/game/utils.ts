export function ordinalSuffix(n: number): string {
  const mod100 = n % 100
  const mod10  = n % 10
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  if (mod10 === 1) return 'st'
  if (mod10 === 2) return 'nd'
  if (mod10 === 3) return 'rd'
  return 'th'
}

export function floorLabel(n: number): string {
  return `Basement ${n}${ordinalSuffix(n)} Floor`
}

// 精錬の成功確率（%）。currentLevel は現在の精錬値（＋N）で、＋N+1 への挑戦時の確率を返す。
// +0→+1 は30%で、1レベルごとに3%ずつ低下。精錬値9以降は0.1%ずつ低下（下限0.1%）。
export function refineSuccessPercent(currentLevel: number): number {
  const pct = currentLevel <= 9
    ? 30 - 3 * currentLevel
    : 3 - 0.1 * (currentLevel - 9)
  return Math.max(0.1, Math.round(pct * 10) / 10)
}
