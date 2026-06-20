// ── ゲーム内データのカタログ（ADMINのデータベース表示用）──
// 実データ（dungeon.ts / items.ts）をそのまま参照するので、
// モンスター・装備・アイテム・魔法の書を追加/更新すれば自動でここにも反映される。
import { ENEMY_TABLE, MINI_BOSS_TABLE, MVP_BOSS_TABLE, AREA_BOSS_TABLE } from './dungeon'
import { EQUIP_ITEMS, SPELL_ITEMS, HEAL_ITEMS, WING_ITEMS } from './items'

// ── モンスター（レアリティ別）──
export const NORMAL_MONSTERS = ENEMY_TABLE

export const MINI_BOSSES = Object.entries(MINI_BOSS_TABLE)
  .map(([floor, b]) => ({ floor: Number(floor), ...b }))
  .sort((a, b) => a.floor - b.floor)

export const MVP_BOSSES = Object.entries(MVP_BOSS_TABLE)
  .map(([floor, b]) => ({ floor: Number(floor), ...b }))
  .sort((a, b) => a.floor - b.floor)

export const AREA_BOSSES = AREA_BOSS_TABLE

// ── 装備 ──
export const EQUIPMENT = EQUIP_ITEMS

// ── 魔法の書 ──
export const SPELLS = SPELL_ITEMS

// ── アイテム（消費系：回復ポーション・羽・女神のコイン）──
export interface ConsumableEntry { name: string; category: string; effect: string }

export const CONSUMABLES: ConsumableEntry[] = [
  ...HEAL_ITEMS.map(h => ({
    name: h.name,
    category: (h.staminaPercent ?? 0) > 0 ? 'スタミナ回復' : 'HP回復',
    effect: (h.staminaPercent ?? 0) > 0 ? `スタミナ +${h.staminaPercent}%` : `HP +${h.healAmount}`,
  })),
  ...Object.values(WING_ITEMS).map(w => ({
    name: w.name,
    category: '羽（移動）',
    effect: `${w.desc}（行商人で女神のコイン${w.cost}枚）`,
  })),
  { name: '女神のコイン', category: '特殊', effect: '使うとスロットを1回まわせる（敵撃破時約20%でドロップ）' },
]

// 装備ボーナスのキー → 表示ラベル（装備テーブルの数値カラム描画用）
export const EQUIP_BONUS_LABELS: { key: 'hpBonus' | 'strBonus' | 'agiBonus' | 'dexBonus' | 'intBonus' | 'vitBonus' | 'lukBonus'; label: string }[] = [
  { key: 'hpBonus', label: 'HP' }, { key: 'strBonus', label: 'STR' }, { key: 'agiBonus', label: 'AGI' },
  { key: 'dexBonus', label: 'DEX' }, { key: 'intBonus', label: 'INT' }, { key: 'vitBonus', label: 'VIT' },
  { key: 'lukBonus', label: 'LUK' },
]

export const EQUIP_SLOT_LABELS: Record<string, string> = {
  weapon: '武器', armor: '鎧', shoulder: '肩装備', boots: '靴',
  accessory1: '指輪①', accessory2: '指輪②', charm: 'お守り',
}
