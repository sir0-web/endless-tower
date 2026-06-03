function ordinalSuffix(n: number): string {
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
