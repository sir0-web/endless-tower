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

  const playerKey = `${playerPos.x},${playerPos.y}`
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
    } else if (key === playerKey && freeTiles.length > 0) {
      // 最後の保険：空きが尽きても「プレイヤーと同じマス」にだけは絶対残さない。
      // 敵が他の床へ重なるのは許容（プレイヤー被りより遥かに害が小さい）。
      const t = freeTiles[freeTiles.length - 1]
      e.position = { x: t.x, y: t.y }
    }
    // それ以外で空きが尽きた極端なケースはそのまま（countに上限があるため実質発生しない）
  }
}

/**
 * 「floor」タイル以外（壁化した牢屋マス等）に乗ってしまったアイテムを空いている床タイルへ退避する。
 * スポーン順を守っていれば本来発生しないはずだが、将来の改修で順序が崩れても
 * 「二度と回収できないアイテム」を確実に防ぐための最終防波堤。
 */
export function dedupeItemPositions(
  items: { position: Position }[],
  map: TileType[][],
  playerPos: Position,
): void {
  const occupied = new Set<string>([`${playerPos.x},${playerPos.y}`])
  for (const it of items) {
    if (map[it.position.y]?.[it.position.x] === 'floor') occupied.add(`${it.position.x},${it.position.y}`)
  }

  const freeTiles: Position[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor' && !occupied.has(`${x},${y}`)) freeTiles.push({ x, y })
    }
  }
  for (let i = freeTiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeTiles[i], freeTiles[j]] = [freeTiles[j], freeTiles[i]]
  }

  let fi = 0
  for (const it of items) {
    if (map[it.position.y]?.[it.position.x] === 'floor') continue   // 正常位置はそのまま
    if (fi < freeTiles.length) {
      const t = freeTiles[fi++]
      it.position = { x: t.x, y: t.y }
      occupied.add(`${t.x},${t.y}`)
    }
    // 空きが尽きた極端なケースはそのまま（アイテム数に上限があるため実質発生しない）
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
// 通常モンスター表。出現フロアは帯（band）ごとに重ね、各フロアで複数種が出るようにしてある。
// ステータスは実フロアに応じて scale 倍される（spawnEnemies 参照）。戦闘で効くのは
//   hpBase（耐久）/ defBase（被ダメ軽減）/ atkBase + str*0.5（与ダメ）/ luk（会心率）
// の4系統。agi・vit は現状の戦闘式では未使用＝表示用の飾り。
// バランス目標：強運（高LUK）でやり込んだプレイヤーが「ぎりぎり100階を超える」あたりが壁になるよう、
// 帯が深くなるほど base が滑らかに増える曲線で設計（深部ほど同一フロアでも敵プールが強くなる）。
export const ENEMY_TABLE = [
  //                                                                              str  vit  agi  luk
  // ── 1〜30：序盤（最弱フィラーのぽり男は全域に薄く出続ける）──
  { name: 'ぽり男',              minFloor: 1,   maxFloor: 500, hpBase: 12,  atkBase: 4,  defBase: 0,  str:  4, vit:  0, agi: 10, luk:  4 },
  { name: 'ルナティック',        minFloor: 1,   maxFloor: 30,  hpBase: 10,  atkBase: 6,  defBase: 0,  str:  2, vit:  0, agi: 20, luk:  6 },
  { name: 'ビタタ',              minFloor: 1,   maxFloor: 30,  hpBase: 14,  atkBase: 4,  defBase: 0,  str:  4, vit:  0, agi: 16, luk:  4 },
  { name: 'クリーミー',          minFloor: 1,   maxFloor: 30,  hpBase: 16,  atkBase: 6,  defBase: 0,  str:  5, vit:  2, agi: 12, luk:  5 },
  // ── 10〜40 ──
  { name: 'ウィスパー',          minFloor: 10,  maxFloor: 40,  hpBase: 20,  atkBase: 8,  defBase: 2,  str: 10, vit:  6, agi: 16, luk:  3 },
  { name: 'スモーキー',          minFloor: 10,  maxFloor: 40,  hpBase: 18,  atkBase: 10, defBase: 2,  str:  8, vit:  4, agi: 16, luk:  6 },
  { name: 'スポア',              minFloor: 10,  maxFloor: 40,  hpBase: 24,  atkBase: 8,  defBase: 3,  str:  8, vit:  8, agi:  8, luk:  4 },
  { name: '白蓮玉',              minFloor: 10,  maxFloor: 40,  hpBase: 20,  atkBase: 12, defBase: 2,  str:  8, vit:  4, agi: 24, luk:  8 },
  // ── 20〜50 ──
  { name: 'ソルジャースケルトン', minFloor: 20,  maxFloor: 50,  hpBase: 32,  atkBase: 12, defBase: 5,  str: 16, vit: 10, agi:  6, luk:  3 },
  { name: 'ヨーヨー',            minFloor: 20,  maxFloor: 50,  hpBase: 26,  atkBase: 13, defBase: 3,  str: 12, vit:  6, agi: 20, luk:  7 },
  { name: 'ヒドラ',              minFloor: 20,  maxFloor: 50,  hpBase: 38,  atkBase: 11, defBase: 5,  str: 14, vit: 14, agi:  8, luk:  5 },
  { name: 'ゾンビ',              minFloor: 20,  maxFloor: 50,  hpBase: 36,  atkBase: 10, defBase: 6,  str: 12, vit: 12, agi:  4, luk:  3 },
  // ── 30〜60 ──
  { name: 'ペコペコ',            minFloor: 30,  maxFloor: 60,  hpBase: 42,  atkBase: 16, defBase: 6,  str: 18, vit: 10, agi: 16, luk:  6 },
  { name: 'ムナック',            minFloor: 30,  maxFloor: 60,  hpBase: 40,  atkBase: 17, defBase: 7,  str: 18, vit: 12, agi: 10, luk:  5 },
  { name: 'ボンゴン',            minFloor: 30,  maxFloor: 60,  hpBase: 48,  atkBase: 15, defBase: 8,  str: 18, vit: 14, agi:  8, luk:  4 },
  { name: 'フロッグ',            minFloor: 30,  maxFloor: 60,  hpBase: 36,  atkBase: 19, defBase: 5,  str: 20, vit:  8, agi: 20, luk:  8 },
  // ── 40〜70 ──
  { name: 'ボーカル',            minFloor: 40,  maxFloor: 70,  hpBase: 46,  atkBase: 21, defBase: 7,  str: 22, vit: 12, agi: 16, luk:  8 },
  { name: 'フェン',              minFloor: 40,  maxFloor: 70,  hpBase: 42,  atkBase: 24, defBase: 6,  str: 26, vit: 10, agi: 22, luk:  9 },
  { name: 'マリナ',              minFloor: 40,  maxFloor: 70,  hpBase: 50,  atkBase: 21, defBase: 8,  str: 22, vit: 14, agi: 14, luk:  7 },
  { name: 'デビルチ',            minFloor: 40,  maxFloor: 70,  hpBase: 46,  atkBase: 23, defBase: 8,  str: 26, vit: 10, agi: 12, luk:  6 },
  // ── 50〜80 ──
  { name: 'ゴーレム',            minFloor: 50,  maxFloor: 80,  hpBase: 66,  atkBase: 25, defBase: 13, str: 30, vit: 20, agi: 10, luk:  6 },
  { name: 'パイレーツスケルトン', minFloor: 50,  maxFloor: 80,  hpBase: 56,  atkBase: 27, defBase: 10, str: 30, vit: 12, agi: 14, luk:  8 },
  { name: 'マンティス',          minFloor: 50,  maxFloor: 80,  hpBase: 50,  atkBase: 31, defBase: 8,  str: 34, vit: 10, agi: 24, luk: 10 },
  { name: 'ガイアス',            minFloor: 50,  maxFloor: 80,  hpBase: 64,  atkBase: 26, defBase: 14, str: 30, vit: 20, agi: 10, luk:  7 },
  // ── 60〜90 ──
  { name: 'フローラ',            minFloor: 60,  maxFloor: 90,  hpBase: 68,  atkBase: 31, defBase: 11, str: 34, vit: 16, agi: 16, luk:  9 },
  { name: 'アヌビス',            minFloor: 60,  maxFloor: 90,  hpBase: 66,  atkBase: 34, defBase: 12, str: 38, vit: 16, agi: 18, luk: 10 },
  { name: 'サスカッチ',          minFloor: 60,  maxFloor: 90,  hpBase: 80,  atkBase: 30, defBase: 15, str: 36, vit: 24, agi: 12, luk:  7 },
  { name: 'ハンマーコボルド',    minFloor: 60,  maxFloor: 90,  hpBase: 62,  atkBase: 37, defBase: 11, str: 42, vit: 14, agi: 16, luk:  9 },
  { name: 'マミー',              minFloor: 60,  maxFloor: 90,  hpBase: 62,  atkBase: 35, defBase: 10, str: 38, vit: 10, agi: 30, luk: 14 },
  // ── 70〜100 ──
  { name: 'マリンスフィア',      minFloor: 70,  maxFloor: 100, hpBase: 82,  atkBase: 37, defBase: 13, str: 42, vit: 18, agi: 18, luk: 10 },
  { name: 'ソフィー',            minFloor: 70,  maxFloor: 100, hpBase: 78,  atkBase: 39, defBase: 14, str: 44, vit: 18, agi: 20, luk: 11 },
  { name: 'イシス',              minFloor: 70,  maxFloor: 100, hpBase: 86,  atkBase: 38, defBase: 15, str: 44, vit: 20, agi: 20, luk: 10 },
  { name: 'マルデューク',        minFloor: 70,  maxFloor: 100, hpBase: 78,  atkBase: 43, defBase: 14, str: 50, vit: 18, agi: 20, luk: 11 },
  // ── 80〜130 ──
  { name: 'ジャック',            minFloor: 80,  maxFloor: 130, hpBase: 94,  atkBase: 45, defBase: 16, str: 50, vit: 24, agi: 22, luk: 12 },
  { name: 'アラーム',            minFloor: 80,  maxFloor: 130, hpBase: 114, atkBase: 41, defBase: 21, str: 50, vit: 30, agi: 14, luk:  8 },
  { name: 'フェンダーク',        minFloor: 80,  maxFloor: 130, hpBase: 98,  atkBase: 45, defBase: 17, str: 52, vit: 24, agi: 18, luk: 11 },
  // ── 90〜140 ──
  { name: 'ミノタウロス',        minFloor: 90,  maxFloor: 140, hpBase: 106, atkBase: 57, defBase: 18, str: 68, vit: 20, agi: 24, luk: 12 },
  { name: 'ジルタス',            minFloor: 90,  maxFloor: 140, hpBase: 118, atkBase: 53, defBase: 20, str: 62, vit: 30, agi: 24, luk: 12 },
  { name: 'クランプ',            minFloor: 90,  maxFloor: 140, hpBase: 138, atkBase: 49, defBase: 25, str: 60, vit: 42, agi: 18, luk: 10 },
  // ── 100〜150 ──
  { name: 'ジョーカー',          minFloor: 100, maxFloor: 150, hpBase: 138, atkBase: 63, defBase: 23, str: 72, vit: 30, agi: 28, luk: 14 },
  { name: 'オットー',            minFloor: 100, maxFloor: 150, hpBase: 152, atkBase: 61, defBase: 25, str: 74, vit: 32, agi: 20, luk: 12 },
  { name: 'ジェスター',          minFloor: 100, maxFloor: 150, hpBase: 130, atkBase: 67, defBase: 22, str: 80, vit: 28, agi: 30, luk: 15 },
  // ── 110〜160 ──
  { name: 'チンピラ',            minFloor: 110, maxFloor: 160, hpBase: 162, atkBase: 75, defBase: 28, str: 86, vit: 30, agi: 32, luk: 16 },
  { name: '半魚人',              minFloor: 110, maxFloor: 160, hpBase: 172, atkBase: 73, defBase: 30, str: 88, vit: 40, agi: 24, luk: 16 },
  { name: 'ナイトメア',          minFloor: 110, maxFloor: 160, hpBase: 178, atkBase: 79, defBase: 31, str: 90, vit: 44, agi: 28, luk: 14 },
  { name: '深淵の騎士',          minFloor: 110, maxFloor: 160, hpBase: 204, atkBase: 85, defBase: 37, str: 98, vit: 56, agi: 30, luk: 16 },
]

export const MINI_BOSS_TABLE: Record<number, { name: string; hpMult: number; atkMult: number; defMult: number }> = {
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

export const MVP_BOSS_TABLE: Record<number, { name: string; hpMult: number; atkMult: number; defMult: number }> = {
  10: { name: 'フリオニ',       hpMult: 3.0, atkMult: 1.8, defMult: 1.2 },
  20: { name: 'オークヒーロー', hpMult: 3.6, atkMult: 2.1, defMult: 1.5 },
  30: { name: 'オークロード',   hpMult: 4.2, atkMult: 2.4, defMult: 1.8 },
  40: { name: 'アモンラー',     hpMult: 4.8, atkMult: 2.7, defMult: 1.8 },
  50: { name: 'ダークロード',   hpMult: 5.4, atkMult: 3.0, defMult: 2.1 },
  60: { name: 'ファラオ',       hpMult: 6.0, atkMult: 3.3, defMult: 2.4 },
  70: { name: 'モロク',         hpMult: 7.2, atkMult: 3.6, defMult: 2.7 },
}

// atkMult 省略時は 2.1。黄金蟲のみ低層（初期HP50帯）で即死級にならないよう攻撃を抑える（HPは硬いまま）
export const AREA_BOSS_TABLE: { name: string; minFloor: number; maxFloor: number; atkMult?: number }[] = [
  { name: '黄金蟲',           minFloor: 1,  maxFloor: 10, atkMult: 1.4 },
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

// ── 深層スケール ──
// 100F までは従来の緩いカーブ（中盤バランス維持）。100F 以降は深度で複利的に底上げし、
// 「飽和して稼ぎ型プレイヤーに追い抜かれる」構造を撤廃する。DEEP_GROWTH を上げるほど壁が手前へ。
// 校正: DEEP_GROWTH=1.025（AGI/DEX天井解放ぶんを織り込み）で、稼ぎ型(到達時 Lv1500〜2000級)が
// 概ね 135〜145F で頭打ち。軽いプレイヤーはより手前＝スコア型として妥当。壁を動かすならこの1値を増減。
export const DEEP_FLOOR  = 100
export const DEEP_GROWTH = 1.025
export function deepScale(floor: number): number {
  const base = (1 + floor * 0.1) / (1 + floor * 0.02)
  const deep = Math.pow(DEEP_GROWTH, Math.max(0, floor - DEEP_FLOOR))
  return base * deep
}

function makeBoss(name: string, floor: number, hpMult: number, atkMult: number, defMult: number, prefix: string) {
  // 100Fまでは緩いカーブ、100F超は深層で複利加速（deepScale）。
  const scale = deepScale(floor)
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
  // 出現周期：MINI=10階ごと（15の倍数を除く）／MVP=15階ごと。最小公倍数30の階で両者が重複しないよう排他。
  // MINIは10,20,40,50,70,80…／MVPは15,30,45,60…に出る。テーブルは出現順に弱→強を割り当て、
  // 打ち止め後は最強tierに張り付かせる（深層scaleで更に逓増＝再利用が毎回強くなる）
  const isMini = floor % 10 === 0 && floor % 15 !== 0
  const isMvp  = floor % 15 === 0
  // n体目のMINI（30階周期に2体：+10と+20）→ テーブルキー5,15,25…65へ順番にマップ
  const miniOrdinal = Math.floor(floor / 30) * 2 + (floor % 30 === 20 ? 1 : 0)
  const miniKey     = Math.min(5 + miniOrdinal * 10, 65)
  // n体目のMVP → テーブルキー10,20,…70へ順番にマップ
  const mvpKey      = Math.min(Math.floor(floor / 15) * 10, 70)

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
    const atkMult = AREA_BOSS_TABLE.find(a => a.name === name)?.atkMult ?? 2.1
    bosses.push(makeBoss(name, floor, 3.6, atkMult, 1.5, '【エリア】'))
  }
  // エリアボスは90Fで打ち止めだったため、91F以降は25F刻みで“深淵の主”をエリア級で再登場させる
  if (floor > DEEP_FLOOR && floor % 25 === 0) {
    bosses.push(makeBoss('深淵の主', floor, 3.6, 2.1, 1.5, '【深淵】'))
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
    .map(a => ({ name: a.name, hpMult: 3.6, atkMult: a.atkMult ?? 2.1, defMult: 1.5, prefix: '【エリア】' }))

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
  const scale = deepScale(floor) * f1Mult
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

// ── 敵の「性格」システム ──
// モンスター種と直交するランダム属性。6F以降の通常モンスターの25%に付与される。
//   突進兵の＝自爆型（発見で導火線3ターン→周囲1マス大爆発。敵も巻き込む）
//   支配者の＝召喚型（カウント3→周囲に雑魚1〜3体召喚。最大2回）
//   弱虫の　＝臆病型（逃走しつつ周囲2マスの敵を強化。倒すと経験値2倍+コイン確定）
export const PERSONALITY_RATE = 0.25
export const PERSONALITY_MIN_FLOOR = 6
export const PERSONALITY_PREFIX_RE = /^(突進兵の|支配者の|弱虫の)/
const PERSONALITY_POOL: { key: 'bomber' | 'summoner' | 'coward'; prefix: string; weight: number }[] = [
  { key: 'bomber',   prefix: '突進兵の', weight: 40 },
  { key: 'summoner', prefix: '支配者の', weight: 30 },
  { key: 'coward',   prefix: '弱虫の',   weight: 30 },
]

function maybeApplyPersonality(
  enemy: { name: string; personality?: 'bomber' | 'summoner' | 'coward'; summonsLeft?: number },
  floor: number,
): void {
  if (floor < PERSONALITY_MIN_FLOOR || Math.random() >= PERSONALITY_RATE) return
  const total = PERSONALITY_POOL.reduce((s, p) => s + p.weight, 0)
  let r = Math.random() * total
  let pick = PERSONALITY_POOL[PERSONALITY_POOL.length - 1]
  for (const p of PERSONALITY_POOL) { r -= p.weight; if (r <= 0) { pick = p; break } }
  enemy.personality = pick.key
  enemy.name = pick.prefix + enemy.name
  if (pick.key === 'summoner') enemy.summonsLeft = 2
}

/** 支配者の召喚体を1体生成する（フロア相応の雑魚のステータス70%版・経験値ドロップなし） */
export function makeMinionEnemy(floor: number) {
  const available = ENEMY_TABLE.filter(e =>
    e.minFloor <= floor && (floor > DEEP_FLOOR || e.maxFloor >= floor)
  )
  const base = available[Math.floor(Math.random() * available.length)] ?? ENEMY_TABLE[0]
  const scale = deepScale(floor) * 0.7
  return {
    id: `minion_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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
    isSummoned: true,
  }
}

export function spawnEnemies(map: TileType[][], count: number, floor: number) {
  const floors: Position[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor') floors.push({ x, y })
    }
  }

  // 100F以降は maxFloor 上限を無視して全モンスターを抽選対象に（深層で全種類リユース・deepScaleで強化）
  const available = ENEMY_TABLE.filter(e =>
    e.minFloor <= floor && (floor > DEEP_FLOOR || e.maxFloor >= floor)
  )
  const enemies = []

  // 1〜3Fは全ステータスを60%に抑えて初心者が序盤を乗り越えやすくする
  const f1Mult = floor <= 3 ? 0.6 : 1.0

  for (let i = 0; i < count; i++) {
    const pos = floors[Math.floor(Math.random() * floors.length)]
    const base = available[Math.floor(Math.random() * available.length)]
    const scale = deepScale(floor) * f1Mult
    const enemy = {
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
    }
    maybeApplyPersonality(enemy, floor)
    enemies.push(enemy)
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