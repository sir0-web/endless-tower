// ── ゲームデータの上書き（ADMINデータベースの編集を本番へ反映する仕組み）──
// 公開(is_published)された上書き行を起動時に取得し、ハードコード表へその場でマージする。
// 取得失敗時は何もしない＝デフォルト値で動作（安全側フォールバック）。
import { supabase } from './supabase'
import { ENEMY_TABLE, MINI_BOSS_TABLE, MVP_BOSS_TABLE, AREA_BOSS_TABLE } from './dungeon'
import { EQUIP_ITEMS, SPELL_ITEMS, HEAL_ITEMS, WING_ITEMS } from './items'

export type OverrideCategory =
  | 'monster_normal' | 'monster_mini' | 'monster_mvp' | 'monster_area'
  | 'equip' | 'item' | 'spell'

export interface OverrideRow {
  category: OverrideCategory
  ref: string                          // 元の名前（不変キー）
  patch: Record<string, unknown>       // 公開中の変更フィールド（pub_patch）
  image_url: string | null             // 公開中の画像（pub_image）
}

// カテゴリごとに上書きを許可するフィールド（不正キー混入を防ぐホワイトリスト）
export const OVERRIDE_FIELDS: Record<OverrideCategory, string[]> = {
  monster_normal: ['name', 'minFloor', 'maxFloor', 'hpBase', 'atkBase', 'defBase', 'str', 'vit', 'agi', 'luk'],
  monster_mini:   ['name', 'hpMult', 'atkMult', 'defMult'],
  monster_mvp:    ['name', 'hpMult', 'atkMult', 'defMult'],
  monster_area:   ['name', 'minFloor', 'maxFloor'],
  equip:          ['name', 'minFloor', 'hpBonus', 'strBonus', 'agiBonus', 'dexBonus', 'intBonus', 'vitBonus', 'lukBonus'],
  item:           ['name', 'healAmount', 'staminaPercent', 'cost', 'desc'],
  spell:          ['name', 'effect'],
}

// モンスター画像/改名の上書き（GameSceneがテクスチャ解決に使う）
export interface MonsterTextureOverride { ref: string; newName: string | null; url: string | null }
let monsterTextureOverrides: MonsterTextureOverride[] = []
export function getMonsterTextureOverrides(): MonsterTextureOverride[] { return monsterTextureOverrides }

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>, allowed: string[]) {
  for (const k of allowed) {
    const v = patch[k]
    if (v === undefined || v === null || v === '') continue
    target[k] = v
  }
}

function applyRow(row: OverrideRow) {
  const { category, ref, patch } = row
  const allowed = OVERRIDE_FIELDS[category]
  if (!allowed) return

  if (category === 'monster_normal') {
    const e = ENEMY_TABLE.find(m => m.name === ref)
    if (e) applyPatch(e as unknown as Record<string, unknown>, patch, allowed)
  } else if (category === 'monster_mini' || category === 'monster_mvp') {
    const table = category === 'monster_mini' ? MINI_BOSS_TABLE : MVP_BOSS_TABLE
    const b = Object.values(table).find(x => x.name === ref)
    if (b) applyPatch(b as unknown as Record<string, unknown>, patch, allowed)
  } else if (category === 'monster_area') {
    const a = AREA_BOSS_TABLE.find(x => x.name === ref)
    if (a) applyPatch(a as unknown as Record<string, unknown>, patch, allowed)
  } else if (category === 'equip') {
    const e = EQUIP_ITEMS.find(x => x.name === ref)
    if (e) applyPatch(e as unknown as Record<string, unknown>, patch, allowed)
  } else if (category === 'item') {
    const h = HEAL_ITEMS.find(x => x.name === ref)
    if (h) { applyPatch(h as unknown as Record<string, unknown>, patch, allowed); return }
    const w = Object.values(WING_ITEMS).find(x => x.name === ref)
    if (w) applyPatch(w as unknown as Record<string, unknown>, patch, allowed)
  } else if (category === 'spell') {
    const s = SPELL_ITEMS.find(x => x.name === ref)
    if (s) applyPatch(s as unknown as Record<string, unknown>, patch, allowed)
  }
}

/** 公開中の上書きを取得してハードコード表へマージする（ゲーム起動時に1回）。失敗時はデフォルトのまま。 */
export async function applyOverrides(): Promise<void> {
  monsterTextureOverrides = []
  try {
    // 起動を止めないよう4秒でタイムアウト（タイムアウト時はデフォルトで続行）
    const query = supabase
      .from('ebt_data_overrides')
      .select('category, ref, patch:pub_patch, image_url:pub_image')
      .eq('is_published', true)
    const timeout = new Promise<{ data: null; error: unknown }>(resolve =>
      setTimeout(() => resolve({ data: null, error: 'timeout' }), 4000))
    const { data, error } = await Promise.race([query, timeout]) as { data: OverrideRow[] | null; error: unknown }
    if (error || !data) return
    for (const row of data as OverrideRow[]) {
      if (!row.patch) row.patch = {}
      try { applyRow(row) } catch (e) { console.warn('上書き適用スキップ:', row.ref, e) }
      // モンスターの画像/改名はテクスチャ解決のため別途保持
      if (row.category.startsWith('monster_')) {
        const newName = typeof row.patch?.name === 'string' ? (row.patch.name as string) : null
        if (row.image_url || newName) {
          monsterTextureOverrides.push({ ref: row.ref, newName, url: row.image_url })
        }
      }
    }
  } catch (e) {
    console.warn('オーバーライド取得失敗（デフォルトで続行）:', e)
  }
}
