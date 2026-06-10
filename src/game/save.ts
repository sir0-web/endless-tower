import type { Player, Item, Enemy, TileType } from '../types'

const SAVE_KEY = 'endless-tower-save'

// マップ・敵・アイテム配置をそのまま保存し、ロード時に再生成しないことで
// 「リロードを繰り返して良いダンジョンを引き直す」抜け道を防ぐ
export interface SaveData {
  player: Player
  enemies: Enemy[]
  items: Item[]
  map: TileType[][]
  spells: Item[]
  heals: Item[]
  bag: Item[]
  turn: number
  areaBossFloors: Record<number, string>
  floorType: 'normal' | 'lucky' | 'chaos'
  driedSprings: string[]
  savedAt: number
}

export function saveGame(data: Omit<SaveData, 'savedAt'>): void {
  try {
    const payload: SaveData = { ...data, savedAt: Date.now() }
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload))
  } catch { /* 容量超過等は無視 */ }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SaveData
  } catch {
    return null
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null
  } catch {
    return false
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch { /* ignore */ }
}
