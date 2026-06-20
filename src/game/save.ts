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
  miasmaFloor?: boolean   // 旧セーブ互換のため任意
  savedAt: number
}

// 保存が実際に永続化できたかを返す。
// iOS Safari のプライベートモードや容量超過、ストレージ無効環境では
// setItem が例外を投げる/書けても読み戻せないことがあるため、書き込み後に検証する。
// （以前は失敗を握りつぶし、呼び出し側が常に「セーブしました」と誤表示していた）
export function saveGame(data: Omit<SaveData, 'savedAt'>): boolean {
  try {
    const payload: SaveData = { ...data, savedAt: Date.now() }
    const json = JSON.stringify(payload)
    localStorage.setItem(SAVE_KEY, json)
    // 読み戻して実際に保存されたか確認（プライベートモード等の握りつぶし対策）
    return localStorage.getItem(SAVE_KEY) === json
  } catch {
    return false
  }
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
