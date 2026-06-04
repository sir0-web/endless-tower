import type { TileType, Position } from '../types'

export const TILE_SIZE = 48
export const MAP_WIDTH = 30
export const MAP_HEIGHT = 30

export function generateDungeon(): TileType[][] {
  const map: TileType[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array(MAP_WIDTH).fill('wall')
  )

  const rooms: { x: number; y: number; w: number; h: number }[] = []

  for (let i = 0; i < 8; i++) {
    const w = Math.floor(Math.random() * 6) + 4
    const h = Math.floor(Math.random() * 6) + 4
    const x = Math.floor(Math.random() * (MAP_WIDTH - w - 2)) + 1
    const y = Math.floor(Math.random() * (MAP_HEIGHT - h - 2)) + 1
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) {
        map[ry][rx] = 'floor'
      }
    }
    rooms.push({ x, y, w, h })
  }

  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i]
    const b = rooms[i + 1]
    const ax = Math.floor(a.x + a.w / 2)
    const ay = Math.floor(a.y + a.h / 2)
    const bx = Math.floor(b.x + b.w / 2)
    const by = Math.floor(b.y + b.h / 2)
    let cx = ax
    while (cx !== bx) {
      map[ay][cx] = 'floor'
      cx += cx < bx ? 1 : -1
    }
    let cy = ay
    while (cy !== by) {
      map[cy][bx] = 'floor'
      cy += cy < by ? 1 : -1
    }
  }

  const lastRoom = rooms[rooms.length - 1]
  const sx = Math.floor(lastRoom.x + lastRoom.w / 2)
  const sy = Math.floor(lastRoom.y + lastRoom.h / 2)
  map[sy][sx] = 'stairs'

  const trapCount = 3 + Math.floor(Math.random() * 4)
  for (let t = 0; t < trapCount; t++) {
    let tx, ty
    do {
      tx = Math.floor(Math.random() * MAP_WIDTH)
      ty = Math.floor(Math.random() * MAP_HEIGHT)
    } while (map[ty][tx] !== 'floor')
    map[ty][tx] = 'trap'
  }

  return map
}

export function getPlayerStartPosition(map: TileType[][]): Position {
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor') return { x, y }
    }
  }
  return { x: 1, y: 1 }
}

const ENEMY_TABLE = [
  //                                                                          str  vit  agi  luk
  { name: 'ぽり男',              minFloor: 1,  maxFloor: 99, hpBase: 6,  atkBase: 2,  defBase: 0,  str:  2, vit:  0, agi:  5, luk:  2 },
  { name: 'ルナティック',        minFloor: 1,  maxFloor: 5,  hpBase: 5,  atkBase: 3,  defBase: 0,  str:  1, vit:  0, agi: 10, luk:  3 },
  { name: 'ビタタ',              minFloor: 1,  maxFloor: 6,  hpBase: 7,  atkBase: 2,  defBase: 0,  str:  2, vit:  0, agi:  8, luk:  2 },
  { name: 'ウィスパー',          minFloor: 3,  maxFloor: 10, hpBase: 10, atkBase: 4,  defBase: 1,  str:  5, vit:  3, agi:  8, luk:  1 },
  { name: 'スモーキー',          minFloor: 4,  maxFloor: 12, hpBase: 8,  atkBase: 5,  defBase: 1,  str:  4, vit:  1, agi:  8, luk:  3 },
  { name: '白蓮玉',              minFloor: 5,  maxFloor: 15, hpBase: 9,  atkBase: 6,  defBase: 1,  str:  3, vit:  1, agi: 12, luk:  4 },
  { name: 'ソルジャースケルトン', minFloor: 6,  maxFloor: 15, hpBase: 14, atkBase: 5,  defBase: 2,  str:  6, vit:  4, agi:  3, luk:  1 },
  { name: 'ムナック',            minFloor: 7,  maxFloor: 16, hpBase: 12, atkBase: 6,  defBase: 2,  str:  5, vit:  5, agi:  4, luk:  2 },
  { name: 'デビルチ',            minFloor: 8,  maxFloor: 18, hpBase: 16, atkBase: 6,  defBase: 3,  str:  7, vit:  4, agi:  5, luk:  2 },
  { name: 'ゴーレム',            minFloor: 10, maxFloor: 22, hpBase: 18, atkBase: 8,  defBase: 3,  str:  8, vit:  3, agi: 10, luk:  5 },
  { name: 'マミー',              minFloor: 12, maxFloor: 25, hpBase: 16, atkBase: 10, defBase: 2,  str: 10, vit:  2, agi: 15, luk:  6 },
  { name: 'アラーム',            minFloor: 15, maxFloor: 30, hpBase: 24, atkBase: 9,  defBase: 5,  str: 12, vit: 10, agi:  5, luk:  2 },
  { name: 'フェンダーク',        minFloor: 15, maxFloor: 35, hpBase: 20, atkBase: 10, defBase: 4,  str: 10, vit:  6, agi:  5, luk:  3 },
  { name: 'ミノタウロス',        minFloor: 18, maxFloor: 40, hpBase: 18, atkBase: 13, defBase: 3,  str: 14, vit:  3, agi: 10, luk:  4 },
  { name: 'オットー',            minFloor: 22, maxFloor: 99, hpBase: 28, atkBase: 14, defBase: 5,  str: 16, vit:  6, agi:  6, luk:  5 },
  { name: 'チンピラ',            minFloor: 25, maxFloor: 99, hpBase: 30, atkBase: 16, defBase: 6,  str: 18, vit:  5, agi: 14, luk:  7 },
  { name: '半魚人',              minFloor: 30, maxFloor: 99, hpBase: 35, atkBase: 18, defBase: 7,  str: 22, vit:  8, agi: 10, luk:  8 },
  { name: 'ナイトメア',          minFloor: 35, maxFloor: 99, hpBase: 40, atkBase: 20, defBase: 8,  str: 25, vit: 15, agi: 12, luk:  6 },
  { name: '深淵の騎士',          minFloor: 45, maxFloor: 99, hpBase: 50, atkBase: 25, defBase: 10, str: 30, vit: 20, agi: 15, luk:  8 },
]

const MINI_BOSS_TABLE: Record<number, { name: string; hpMult: number; atkMult: number; defMult: number }> = {
  5:  { name: 'エクリプス',       hpMult: 1.8, atkMult: 1.2, defMult: 0.9 },
  10: { name: 'エンジェリング',   hpMult: 1.8, atkMult: 1.2, defMult: 0.9 },
  15: { name: 'デビルリング',     hpMult: 2.4, atkMult: 1.5, defMult: 1.2 },
  20: { name: 'マスターリング',   hpMult: 2.4, atkMult: 1.5, defMult: 1.2 },
  25: { name: 'ゴーストリング',   hpMult: 3.0, atkMult: 1.8, defMult: 1.2 },
  30: { name: 'トード',           hpMult: 3.0, atkMult: 1.8, defMult: 1.5 },
  35: { name: 'キングドラモ',     hpMult: 3.6, atkMult: 2.1, defMult: 1.5 },
  40: { name: 'さすらい狼',       hpMult: 3.6, atkMult: 2.1, defMult: 1.5 },
  45: { name: 'ダークプリースト', hpMult: 4.2, atkMult: 2.4, defMult: 1.8 },
  50: { name: 'キメラ',           hpMult: 4.2, atkMult: 2.4, defMult: 1.8 },
  55: { name: 'ミステルテイン',   hpMult: 4.8, atkMult: 2.7, defMult: 1.8 },
  60: { name: 'ネクロマンサー',   hpMult: 4.8, atkMult: 2.7, defMult: 2.1 },
  65: { name: 'ドラゴンフライ',   hpMult: 5.4, atkMult: 3.0, defMult: 2.1 },
}

const MVP_BOSS_TABLE: Record<number, { name: string; hpMult: number; atkMult: number; defMult: number }> = {
  10: { name: 'フリオニ',       hpMult: 3.0, atkMult: 1.8, defMult: 1.2 },
  20: { name: 'オークヒーロー', hpMult: 3.6, atkMult: 2.1, defMult: 1.5 },
  30: { name: 'オークロード',   hpMult: 4.2, atkMult: 2.4, defMult: 1.8 },
  40: { name: 'アモンラー',     hpMult: 4.8, atkMult: 2.7, defMult: 1.8 },
  50: { name: 'ダークロード',   hpMult: 5.4, atkMult: 3.0, defMult: 2.1 },
  60: { name: 'ファラオ',       hpMult: 6.0, atkMult: 3.3, defMult: 2.4 },
  70: { name: 'モロク',         hpMult: 7.2, atkMult: 3.6, defMult: 2.7 },
}

const AREA_BOSS_TABLE = [
  { name: '黄金蟲',           minFloor: 1,  maxFloor: 10  },
  { name: 'ドレイク',         minFloor: 11, maxFloor: 20  },
  { name: 'オシリス',         minFloor: 21, maxFloor: 30  },
  { name: 'ストラウフ',       minFloor: 31, maxFloor: 40  },
  { name: '月夜花（ヤファ）', minFloor: 41, maxFloor: 50  },
  { name: 'ドラキュラ',       minFloor: 51, maxFloor: 60  },
  { name: 'ダークロード',     minFloor: 61, maxFloor: 70  },
  { name: 'オウルデューク',   minFloor: 71, maxFloor: 80  },
  { name: 'ミュータントドラゴン', minFloor: 81, maxFloor: 90 },
]

// ゲーム開始時にエリアボスの出現階を決定する
export function generateAreaBossFloors(): Record<number, string> {
  const result: Record<number, string> = {}
  for (const area of AREA_BOSS_TABLE) {
    const floor = area.minFloor + Math.floor(Math.random() * (area.maxFloor - area.minFloor + 1))
    result[floor] = area.name
  }
  return result
}

function makeBoss(name: string, floor: number, hpMult: number, atkMult: number, defMult: number, prefix: string) {
  const scale = 1 + floor * 0.1
  const baseHp  = 30 + floor * 5
  const baseAtk = 10 + floor * 2
  const baseDef = 5  + floor
  // ボスの新ステータス：通常モンスターの1.5〜2倍
  const bossStr = Math.floor((4  + floor * 0.5) * atkMult)
  const bossVit = Math.floor((2  + floor * 0.3) * defMult)
  const bossAgi = Math.floor((5  + floor * 0.2) * 1.5)
  const bossLuk = Math.floor((2  + floor * 0.1) * 1.8)
  return {
    id: `boss_${prefix}_${floor}_${Date.now()}`,
    position: { x: 0, y: 0 },
    hp:      Math.floor(baseHp  * hpMult  * scale),
    maxHp:   Math.floor(baseHp  * hpMult  * scale),
    attack:  Math.floor(baseAtk * atkMult * scale),
    defense: Math.floor(baseDef * defMult * scale),
    str: bossStr,
    vit: bossVit,
    agi: bossAgi,
    luk: bossLuk,
    slowedTurns: 0,
    name: `${prefix}${name}`,
    isBoss: true,
  }
}

export function spawnBosses(floor: number, areaBossFloors: Record<number, string>) {
  const bosses = []
  const isMini = floor % 5 === 0 && floor % 10 !== 0 && MINI_BOSS_TABLE[floor % 65 || 65]
  const isMvp = floor % 10 === 0

  const miniKey = floor % 65 || 65
  const mvpKey = ((Math.floor((floor - 1) / 10) % 7) + 1) * 10

  if (isMini) {
    const b = MINI_BOSS_TABLE[miniKey] ?? MINI_BOSS_TABLE[65]
    bosses.push(makeBoss(b.name, floor, b.hpMult, b.atkMult, b.defMult, '【MINI】'))
  }
  if (isMvp) {
    const b = MVP_BOSS_TABLE[mvpKey] ?? MVP_BOSS_TABLE[70]
    bosses.push(makeBoss(b.name, floor, b.hpMult, b.atkMult, b.defMult, '【MVP】'))
  }
  if (areaBossFloors[floor]) {
    const name = areaBossFloors[floor]
    bosses.push(makeBoss(name, floor, 3.6, 2.1, 1.5, '【エリア】'))
  }

  return bosses
}

export function getFloorTelopMessage(floor: number, areaBossFloors: Record<number, string>): string | null {
  const isMini = floor % 5 === 0 && floor % 10 !== 0
  const isMvp = floor % 10 === 0
  const isArea = !!areaBossFloors[floor]

  if (isMini && isMvp && isArea) return 'このフロアはカオスな気配に包まれている！！'
  if (isMvp && isArea)           return 'このフロアは複数の破壊的な気配を感じる・・・'
  if (isMini && isArea)          return 'このフロアは複数の絶望的な気配を感じる・・・'
  if (isMini && isMvp)           return 'このフロアは複数の壊滅的な気配を感じる・・・'
  if (isArea)                    return 'このフロアはとてつもない魔力が漂っている・・・'
  if (isMvp)                     return 'このフロアは邪悪な魔力が漂っている・・・'
  if (isMini)                    return 'このフロアは強力な魔力が漂っている・・・'
  return null
}

export function spawnEnemies(map: TileType[][], count: number, floor: number) {
  const floors: Position[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor') floors.push({ x, y })
    }
  }

  const available = ENEMY_TABLE.filter(e => e.minFloor <= floor && e.maxFloor >= floor)
  const enemies = []

  for (let i = 0; i < count; i++) {
    const pos = floors[Math.floor(Math.random() * floors.length)]
    const base = available[Math.floor(Math.random() * available.length)]
    const scale = 1 + floor * 0.08
    enemies.push({
      id: `enemy_${i}_${Date.now()}`,
      position: { ...pos },
      hp:      Math.floor((base.hpBase  + floor) * scale),
      maxHp:   Math.floor((base.hpBase  + floor) * scale),
      attack:  Math.floor((base.atkBase + Math.floor(floor * 0.5)) * scale),
      defense: Math.floor((base.defBase + Math.floor(floor / 4))   * scale),
      str: base.str,
      vit: base.vit,
      agi: base.agi,
      luk: base.luk,
      slowedTurns: 0,
      name: base.name,
      isBoss: false,
    })
  }
  return enemies
}

/** 枝テロ: フロアの約70%をモンスターで埋める。プレイヤー周囲2マスは安全地帯 */
export function spawnMonsterHouseEnemies(map: TileType[][], floor: number, playerPos: Position) {
  const SAFE_RADIUS = 2
  const candidates: Position[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] !== 'floor') continue
      const dx = x - playerPos.x
      const dy = y - playerPos.y
      if (Math.abs(dx) <= SAFE_RADIUS && Math.abs(dy) <= SAFE_RADIUS) continue
      candidates.push({ x, y })
    }
  }

  const available = ENEMY_TABLE.filter(e => e.minFloor <= floor && e.maxFloor >= floor)
  if (available.length === 0 || candidates.length === 0) return []

  // シャッフルして70%を使用
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }

  const count = Math.floor(candidates.length * 0.7)
  const scale = 1 + floor * 0.08

  return candidates.slice(0, count).map((pos, i) => {
    const base = available[Math.floor(Math.random() * available.length)]
    return {
      id: `enemy_mh_${i}_${Date.now()}`,
      position: { ...pos },
      hp:      Math.floor((base.hpBase  + floor) * scale),
      maxHp:   Math.floor((base.hpBase  + floor) * scale),
      attack:  Math.floor((base.atkBase + Math.floor(floor * 0.5)) * scale),
      defense: Math.floor((base.defBase + Math.floor(floor / 4))   * scale),
      str: base.str,
      vit: base.vit,
      agi: base.agi,
      luk: base.luk,
      slowedTurns: 0,
      name: base.name,
      isBoss: false,
    }
  })
}