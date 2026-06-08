import type { Item, TileType, EquipSlot, SpellType } from '../types'

const SPELL_ITEMS: { name: string; spellType: SpellType }[] = [
  { name: '炎の書',   spellType: 'firebolt'      },
  { name: '祝福の書', spellType: 'blessing'      },
  { name: '光の書',   spellType: 'lightblessing' },
  { name: '沼の書',   spellType: 'quagmire'      },
  { name: '隕石の書', spellType: 'meteostorm'    },
]

const HEAL_ITEMS = [
  { name: '黄ポーション', healAmount: 15 },
  { name: '白ポーション', healAmount: 30 },
  { name: '赤ポーション', healAmount: 8 },
  { name: 'スタミナポーション', healAmount: 0, staminaPercent: 30 },
]

// atkBonus/defBonus を廃止し strBonus/vitBonus に統一
const EQUIP_ITEMS: {
  name: string
  equipSlot: EquipSlot
  hpBonus?: number
  strBonus?: number
  agiBonus?: number
  dexBonus?: number
  intBonus?: number
  vitBonus?: number
  lukBonus?: number
}[] = [
  // 武器系 → STR重視
  { name: 'さびた剣',     equipSlot: 'weapon',     strBonus: 3 },
  { name: '鉄の剣',       equipSlot: 'weapon',     strBonus: 6 },
  { name: '勇者の剣',     equipSlot: 'weapon',     strBonus: 10, dexBonus: 3 },
  // 鎧系 → VIT重視
  { name: '革の鎧',       equipSlot: 'armor',      vitBonus: 3 },
  { name: '鉄の鎧',       equipSlot: 'armor',      vitBonus: 6 },
  // 肩装備 → VIT・AGI
  { name: '肩当て',       equipSlot: 'shoulder',   vitBonus: 2 },
  { name: '疾風のマント', equipSlot: 'shoulder',   strBonus: 1, vitBonus: 2, agiBonus: 5 },
  // ブーツ → AGI重視
  { name: '革のブーツ',   equipSlot: 'boots',      agiBonus: 3, vitBonus: 1 },
  { name: '俊足のブーツ', equipSlot: 'boots',      strBonus: 1, vitBonus: 2, agiBonus: 8 },
  // アクセサリ → LUK・DEX
  { name: '力の指輪',     equipSlot: 'accessory1', strBonus: 5 },
  { name: '守りの指輪',   equipSlot: 'accessory1', vitBonus: 5 },
  { name: '命の指輪',     equipSlot: 'accessory2', hpBonus: 10, lukBonus: 5 },
  { name: '幸運の指輪',   equipSlot: 'accessory2', lukBonus: 10, dexBonus: 5 },
  // お守り → 複合
  { name: '戦士のお守り', equipSlot: 'charm',      strBonus: 4, vitBonus: 4 },
  { name: '冒険者の護符', equipSlot: 'charm',      dexBonus: 5, lukBonus: 5, agiBonus: 5 },
]

export function spawnItems(
  map: TileType[][],
  options: { countMult?: number; equipRate?: number } = {}
): Item[] {
  const { countMult = 1, equipRate = 0.2 } = options
  const floors: { x: number; y: number }[] = []
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      if (map[y][x] === 'floor') floors.push({ x, y })
    }
  }

  const items: Item[] = []
  const count = countMult

  for (let i = 0; i < count; i++) {
    const pos = floors[Math.floor(Math.random() * floors.length)]
    const r = Math.random()

    if (r < equipRate) {
      const base = EQUIP_ITEMS[Math.floor(Math.random() * EQUIP_ITEMS.length)]
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
