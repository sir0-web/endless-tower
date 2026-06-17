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

  const mudCount = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < mudCount; i++) {
    let mx, my
    do {
      mx = Math.floor(Math.random() * MAP_WIDTH)
      my = Math.floor(Math.random() * MAP_HEIGHT)
    } while (map[my][mx] !== 'floor')
    map[my][mx] = 'mud'
  }

  const springCount = 1 + Math.floor(Math.random() * 2)
  for (let i = 0; i < springCount; i++) {
    let sx, sy
    do {
      sx = Math.floor(Math.random() * MAP_WIDTH)
      sy = Math.floor(Math.random() * MAP_HEIGHT)
    } while (map[sy][sx] !== 'floor')
    map[sy][sx] = 'spring'
  }

  const pitCount = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < pitCount; i++) {
    let px, py
    do {
      px = Math.floor(Math.random() * MAP_WIDTH)
      py = Math.floor(Math.random() * MAP_HEIGHT)
    } while (map[py][px] !== 'floor')
    map[py][px] = 'pitfall'
  }

  return map
}

/**
 * 敵同士・プレイヤーとの位置重複を解消する（フロア開始時に敵が重なって始まらないように）。
 * 重複・非歩行タイルに居る敵だけを、空いている床タイルへ移動する。
 */
export function dedupeEnemyPositions(
  enemies: { position: Position }[],
  map: TileType[][],
  playerPos: Position,
): void {
  const isWalk = (x: number, y: number): boolean => {
    const t = map[y]?.[x]
    return t === 'floor' || t === 'trap' || t === 'mud' || t === 'spring' || t === 'pitfall'
  }
  const occupied = new Set<string>([`${playerPos.x},${playerPos.y}`])

  // 空き床タイル（プレイヤー位置を除く）をシャッフルして用意
  const freeTiles: Position[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor' && !(x === playerPos.x && y === playerPos.y)) freeTiles.push({ x, y })
    }
  }
  for (let i = freeTiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeTiles[i], freeTiles[j]] = [freeTiles[j], freeTiles[i]]
  }

  let fi = 0
  for (const e of enemies) {
    const key = `${e.position.x},${e.position.y}`
    if (!occupied.has(key) && isWalk(e.position.x, e.position.y)) {
      occupied.add(key)
      continue
    }
    // 重複 or 不正位置 → 空きタイルへ退避
    while (fi < freeTiles.length && occupied.has(`${freeTiles[fi].x},${freeTiles[fi].y}`)) fi++
    if (fi < freeTiles.length) {
      const t = freeTiles[fi++]
      e.position = { x: t.x, y: t.y }
      occupied.add(`${t.x},${t.y}`)
    }
    // 空きが尽きた極端なケースはそのまま（実質発生しない）
  }
}

export function getPlayerStartPosition(map: TileType[][]): Position {
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor') return { x, y }
    }
  }
  return { x: 1, y: 1 }
}

// 通常モンスターの基礎ステータス（旧テーブルの2倍値。フロアが上がるほど spawnEnemies 内の scale でさらに底上げされる）
const ENEMY_TABLE = [
  //                                                                          str  vit  agi  luk
  { name: 'ぽり男',              minFloor: 1,  maxFloor: 99, hpBase: 12, atkBase: 4,  defBase: 0,  str:  4, vit:  0, agi: 10, luk:  4 },
  { name: 'ルナティック',        minFloor: 1,  maxFloor: 5,  hpBase: 10, atkBase: 6,  defBase: 0,  str:  2, vit:  0, agi: 20, luk:  6 },
  { name: 'ビタタ',              minFloor: 1,  maxFloor: 6,  hpBase: 14, atkBase: 4,  defBase: 0,  str:  4, vit:  0, agi: 16, luk:  4 },
  { name: 'ウィスパー',          minFloor: 3,  maxFloor: 10, hpBase: 20, atkBase: 8,  defBase: 2,  str: 10, vit:  6, agi: 16, luk:  2 },
  { name: 'スモーキー',          minFloor: 4,  maxFloor: 12, hpBase: 16, atkBase: 10, defBase: 2,  str:  8, vit:  2, agi: 16, luk:  6 },
  { name: '白蓮玉',              minFloor: 5,  maxFloor: 15, hpBase: 18, atkBase: 12, defBase: 2,  str:  6, vit:  2, agi: 24, luk:  8 },
  { name: 'ソルジャースケルトン', minFloor: 6,  maxFloor: 15, hpBase: 28, atkBase: 10, defBase: 4,  str: 12, vit:  8, agi:  6, luk:  2 },
  { name: 'ムナック',            minFloor: 7,  maxFloor: 16, hpBase: 24, atkBase: 12, defBase: 4,  str: 10, vit: 10, agi:  8, luk:  4 },
  { name: 'デビルチ',            minFloor: 8,  maxFloor: 18, hpBase: 32, atkBase: 12, defBase: 6,  str: 14, vit:  8, agi: 10, luk:  4 },
  { name: 'ゴーレム',            minFloor: 10, maxFloor: 22, hpBase: 36, atkBase: 16, defBase: 6,  str: 16, vit:  6, agi: 20, luk: 10 },
  { name: 'マミー',              minFloor: 12, maxFloor: 25, hpBase: 32, atkBase: 20, defBase: 4,  str: 20, vit:  4, agi: 30, luk: 12 },
  { name: 'アラーム',            minFloor: 15, maxFloor: 30, hpBase: 48, atkBase: 18, defBase: 10, str: 24, vit: 20, agi: 10, luk:  4 },
  { name: 'フェンダーク',        minFloor: 15, maxFloor: 35, hpBase: 40, atkBase: 20, defBase: 8,  str: 20, vit: 12, agi: 10, luk:  6 },
  { name: 'ミノタウロス',        minFloor: 18, maxFloor: 40, hpBase: 36, atkBase: 26, defBase: 6,  str: 28, vit:  6, agi: 20, luk:  8 },
  { name: 'オットー',            minFloor: 22, maxFloor: 99, hpBase: 56, atkBase: 28, defBase: 10, str: 32, vit: 12, agi: 12, luk: 10 },
  { name: 'チンピラ',            minFloor: 25, maxFloor: 99, hpBase: 60, atkBase: 32, defBase: 12, str: 36, vit: 10, agi: 28, luk: 14 },
  { name: '半魚人',              minFloor: 30, maxFloor: 99, hpBase: 70, atkBase: 36, defBase: 14, str: 44, vit: 16, agi: 20, luk: 16 },
  { name: 'ナイトメア',          minFloor: 35, maxFloor: 99, hpBase: 80, atkBase: 40, defBase: 16, str: 50, vit: 30, agi: 24, luk: 12 },
  { name: '深淵の騎士',          minFloor: 45, maxFloor: 99, hpBase: 100, atkBase: 50, defBase: 20, str: 60, vit: 40, agi: 30, luk: 16 },
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
  const scale = (1 + floor * 0.15) / (1 + floor * 0.015)
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

/** 混沌フロア（モンスターハウス）用：現在フロアまでに登場しうるボスの中からランダムに1体生成する */
export function makeChaosBoss(floor: number) {
  const validMini = Object.entries(MINI_BOSS_TABLE)
    .filter(([k]) => Number(k) <= Math.max(floor, 5))
    .map(([, b]) => ({ ...b, prefix: '【MINI】' }))

  const validMvp = Object.entries(MVP_BOSS_TABLE)
    .filter(([k]) => Number(k) <= Math.max(floor, 10))
    .map(([, b]) => ({ ...b, prefix: '【MVP】' }))

  const validArea = AREA_BOSS_TABLE
    .filter(a => a.minFloor <= floor)
    .map(a => ({ name: a.name, hpMult: 3.6, atkMult: 2.1, defMult: 1.5, prefix: '【エリア】' }))

  const pool = [...validMini, ...validMvp, ...validArea]
  const pick = pool[Math.floor(Math.random() * pool.length)]
  return makeBoss(pick.name, floor, pick.hpMult, pick.atkMult, pick.defMult, pick.prefix)
}

// ── ADMIN：登録済みモンスター一覧（イベントタブのプルダウン用）──
// behavior: 通常モンスター='normal' / MINI・MVP・エリアボス='boss' / すかるぽりん='skulporin'
export type MonsterBehavior = 'normal' | 'boss' | 'skulporin'
export interface MonsterRegistryEntry { name: string; category: string; behavior: MonsterBehavior }

export const MONSTER_REGISTRY: MonsterRegistryEntry[] = [
  ...ENEMY_TABLE.map(e => ({ name: e.name, category: '通常', behavior: 'normal' as MonsterBehavior })),
  ...Object.values(MINI_BOSS_TABLE).map(b => ({ name: b.name, category: 'MINI', behavior: 'boss' as MonsterBehavior })),
  ...Object.values(MVP_BOSS_TABLE).map(b => ({ name: b.name, category: 'MVP', behavior: 'boss' as MonsterBehavior })),
  ...AREA_BOSS_TABLE.map(a => ({ name: a.name, category: 'エリア', behavior: 'boss' as MonsterBehavior })),
  { name: 'すかるぽりん', category: '特殊', behavior: 'skulporin' },
]

// 名前→ボス倍率・接頭辞の逆引き（MINI/MVP/エリア）
function lookupBossMult(name: string): { hpMult: number; atkMult: number; defMult: number; prefix: string } {
  const mini = Object.values(MINI_BOSS_TABLE).find(b => b.name === name)
  if (mini) return { ...mini, prefix: '【MINI】' }
  const mvp = Object.values(MVP_BOSS_TABLE).find(b => b.name === name)
  if (mvp) return { ...mvp, prefix: '【MVP】' }
  const area = AREA_BOSS_TABLE.find(a => a.name === name)
  if (area) return { hpMult: 3.6, atkMult: 2.1, defMult: 1.5, prefix: '【エリア】' }
  return { hpMult: 3.0, atkMult: 1.8, defMult: 1.5, prefix: '【BOSS】' }
}

/** ADMIN：指定名の通常モンスターを1体生成（指定フロアのスケールを適用） */
export function makeNamedNormalEnemy(name: string, floor: number) {
  const base = ENEMY_TABLE.find(e => e.name === name)
    ?? { name, hpBase: 20, atkBase: 8, defBase: 2, str: 10, vit: 6, agi: 10, luk: 4 }
  const f1Mult = floor <= 3 ? 0.6 : 1.0
  const scale = ((1 + floor * 0.1) / (1 + floor * 0.02)) * f1Mult
  return {
    id: `admin_enemy_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    position: { x: 0, y: 0 },
    hp:      Math.floor((base.hpBase  + floor) * scale),
    maxHp:   Math.floor((base.hpBase  + floor) * scale),
    attack:  Math.floor((base.atkBase + Math.floor(floor * 0.5)) * scale),
    defense: Math.floor((base.defBase + Math.floor(floor / 4))   * scale),
    str: Math.floor(base.str * scale),
    vit: Math.floor(base.vit * scale),
    agi: Math.floor(base.agi * scale),
    luk: Math.floor(base.luk * scale),
    slowedTurns: 0,
    name: base.name,
    isBoss: false,
  }
}

/** ADMIN：指定名のボス（MINI/MVP/エリア）を1体生成（指定フロアのスケールを適用） */
export function makeNamedBossEnemy(name: string, floor: number) {
  const m = lookupBossMult(name)
  return makeBoss(name, floor, m.hpMult, m.atkMult, m.defMult, m.prefix)
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

  // 1〜3Fは全ステータスを60%に抑えて初心者が序盤を乗り越えやすくする
  const f1Mult = floor <= 3 ? 0.6 : 1.0

  for (let i = 0; i < count; i++) {
    const pos = floors[Math.floor(Math.random() * floors.length)]
    const base = available[Math.floor(Math.random() * available.length)]
    const scale = ((1 + floor * 0.1) / (1 + floor * 0.02)) * f1Mult
    enemies.push({
      id: `enemy_${i}_${Date.now()}`,
      position: { ...pos },
      hp:      Math.floor((base.hpBase  + floor) * scale),
      maxHp:   Math.floor((base.hpBase  + floor) * scale),
      attack:  Math.floor((base.atkBase + Math.floor(floor * 0.5)) * scale),
      defense: Math.floor((base.defBase + Math.floor(floor / 4))   * scale),
      str: Math.floor(base.str * scale),
      vit: Math.floor(base.vit * scale),
      agi: Math.floor(base.agi * scale),
      luk: Math.floor(base.luk * scale),
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

  // シャッフルして最大30体（スマホ描画負荷対策）
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }

  const count = Math.min(30, Math.floor(candidates.length * 0.7))
  const f1Mult = floor <= 3 ? 0.6 : 1.0
  const scale = ((1 + floor * 0.1) / (1 + floor * 0.02)) * f1Mult

  return candidates.slice(0, count).map((pos, i) => {
    const base = available[Math.floor(Math.random() * available.length)]
    return {
      id: `enemy_mh_${i}_${Date.now()}`,
      position: { ...pos },
      hp:      Math.floor((base.hpBase  + floor) * scale),
      maxHp:   Math.floor((base.hpBase  + floor) * scale),
      attack:  Math.floor((base.atkBase + Math.floor(floor * 0.5)) * scale),
      defense: Math.floor((base.defBase + Math.floor(floor / 4))   * scale),
      str: Math.floor(base.str * scale),
      vit: Math.floor(base.vit * scale),
      agi: Math.floor(base.agi * scale),
      luk: Math.floor(base.luk * scale),
      slowedTurns: 0,
      name: base.name,
      isBoss: false,
    }
  })
}