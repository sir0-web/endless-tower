import type { Item, TileType, EquipSlot, SpellType } from '../types'

export const SPELL_ITEMS: { name: string; spellType: SpellType }[] = [
  { name: 'ファイアボルトの書',     spellType: 'firebolt'      },
  { name: 'ブレッシングの書',       spellType: 'blessing'      },
  { name: 'ライトブレッシングの書', spellType: 'lightblessing' },
  { name: 'クァグマイアの書',       spellType: 'quagmire'      },
  { name: 'メテオストームの書',     spellType: 'meteostorm'    },
]

const HEAL_ITEMS = [
  { name: '黄ポーション', healAmount: 15 },
  { name: '白ポーション', healAmount: 30 },
  { name: '赤ポーション', healAmount: 8 },
  { name: 'スタミナポーション', healAmount: 0, staminaPercent: 30 },
]

// atkBonus/defBonus を廃止し strBonus/vitBonus に統一
// minFloor: その階以降でのみ出現する（深層ほど強力な装備が出る）
export const EQUIP_ITEMS: {
  name: string
  equipSlot: EquipSlot
  minFloor?: number
  hpBonus?: number
  strBonus?: number
  agiBonus?: number
  dexBonus?: number
  intBonus?: number
  vitBonus?: number
  lukBonus?: number
}[] = [
  // 武器系 → STR重視
  { name: 'さびた剣',       equipSlot: 'weapon',                  strBonus: 3 },
  { name: '鉄の剣',         equipSlot: 'weapon',                  strBonus: 6 },
  { name: '勇者の剣',       equipSlot: 'weapon',                  strBonus: 10, dexBonus: 3 },
  { name: 'ミスリルブレイド', equipSlot: 'weapon',  minFloor: 15, strBonus: 16, dexBonus: 4 },
  { name: '竜牙の大剣',     equipSlot: 'weapon',    minFloor: 25, strBonus: 24, agiBonus: 4 },
  { name: '覇王の剣',       equipSlot: 'weapon',    minFloor: 40, strBonus: 34, dexBonus: 8, lukBonus: 4 },
  // 鎧系 → VIT重視
  { name: '革の鎧',         equipSlot: 'armor',                   vitBonus: 3 },
  { name: '鉄の鎧',         equipSlot: 'armor',                   vitBonus: 6 },
  { name: 'ミスリルプレート', equipSlot: 'armor',   minFloor: 15, vitBonus: 14, hpBonus: 15 },
  { name: '竜鱗の鎧',       equipSlot: 'armor',     minFloor: 28, vitBonus: 22, hpBonus: 30 },
  { name: '聖騎士の鎧',     equipSlot: 'armor',     minFloor: 42, vitBonus: 30, hpBonus: 50, strBonus: 5 },
  // 肩装備 → VIT・AGI
  { name: '肩当て',         equipSlot: 'shoulder',                vitBonus: 2 },
  { name: '疾風のマント',   equipSlot: 'shoulder',                strBonus: 1, vitBonus: 2, agiBonus: 5 },
  { name: '大地のマント',   equipSlot: 'shoulder',  minFloor: 18, vitBonus: 8, hpBonus: 20 },
  { name: '不死鳥の羽衣',   equipSlot: 'shoulder',  minFloor: 32, agiBonus: 12, intBonus: 8, hpBonus: 25 },
  // ブーツ → AGI重視
  { name: '革のブーツ',     equipSlot: 'boots',                   agiBonus: 3, vitBonus: 1 },
  { name: '俊足のブーツ',   equipSlot: 'boots',                   strBonus: 1, vitBonus: 2, agiBonus: 8 },
  { name: '隼のブーツ',     equipSlot: 'boots',     minFloor: 20, agiBonus: 14, dexBonus: 5 },
  { name: '神速のグリーブ', equipSlot: 'boots',     minFloor: 35, agiBonus: 20, strBonus: 5 },
  // アクセサリ → LUK・DEX
  { name: '力の指輪',       equipSlot: 'accessory1',              strBonus: 5 },
  { name: '守りの指輪',     equipSlot: 'accessory1',              vitBonus: 5 },
  { name: '闘神の指輪',     equipSlot: 'accessory1', minFloor: 22, strBonus: 12, dexBonus: 6 },
  { name: '賢者の指輪',     equipSlot: 'accessory1', minFloor: 22, intBonus: 15, dexBonus: 8 },
  { name: '命の指輪',       equipSlot: 'accessory2',              hpBonus: 10, lukBonus: 5 },
  { name: '幸運の指輪',     equipSlot: 'accessory2',              lukBonus: 10, dexBonus: 5 },
  { name: '王家の指輪',     equipSlot: 'accessory2', minFloor: 25, hpBonus: 30, lukBonus: 12, dexBonus: 6 },
  // お守り → 複合
  { name: '戦士のお守り',   equipSlot: 'charm',                   strBonus: 4, vitBonus: 4 },
  { name: '冒険者の護符',   equipSlot: 'charm',                   dexBonus: 5, lukBonus: 5, agiBonus: 5 },
  { name: '竜神の護符',     equipSlot: 'charm',     minFloor: 30, strBonus: 8, vitBonus: 8, agiBonus: 8 },
  { name: '創世のタリスマン', equipSlot: 'charm',   minFloor: 45, strBonus: 10, vitBonus: 10, agiBonus: 10, dexBonus: 10, intBonus: 10, lukBonus: 10 },
]

export function spawnItems(
  map: TileType[][],
  options: { countMult?: number; equipRate?: number; floor?: number } = {}
): Item[] {
  const { countMult = 1, equipRate = 0.2, floor = 99 } = options
  const floors: { x: number; y: number }[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor') floors.push({ x, y })
    }
  }

  // 現在フロアで出現可能な装備プール（深層ほど上位装備が混ざる）
  const equipPool = EQUIP_ITEMS.filter(e => (e.minFloor ?? 1) <= floor)

  const items: Item[] = []
  const count = countMult

  for (let i = 0; i < count; i++) {
    const pos = floors[Math.floor(Math.random() * floors.length)]
    const r = Math.random()

    if (r < equipRate && equipPool.length > 0) {
      const base = equipPool[Math.floor(Math.random() * equipPool.length)]
      items.push({
        id: `item_${i}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: base.name,
        type: 'equip',
        position: { ...pos },
        equipSlot: base.equipSlot,
        hpBonus: base.hpBonus,
        strBonus: base.strBonus,
        agiBonus: base.agiBonus,
        dexBonus: base.dexBonus,
        intBonus: base.intBonus,
        vitBonus: base.vitBonus,
        lukBonus: base.lukBonus,
      })
    } else if (r < equipRate + 0.10) {
      // 魔法の書：装備率より低い確率
      const base = SPELL_ITEMS[Math.floor(Math.random() * SPELL_ITEMS.length)]
      items.push({
        id: `item_${i}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: base.name,
        type: 'spell',
        position: { ...pos },
        spellType: base.spellType,
      })
    } else {
      const base = HEAL_ITEMS[Math.floor(Math.random() * HEAL_ITEMS.length)]
      items.push({
        id: `item_${i}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: base.name,
        type: 'heal',
        position: { ...pos },
        healAmount: base.healAmount,
        staminaPercent: base.staminaPercent,
      })
    }
  }

  return items
}
