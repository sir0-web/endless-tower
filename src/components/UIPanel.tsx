import { useEffect, useRef, useState } from 'react'
import type { Equipment, Item, MinimapData, AllocStat } from '../types'
import { SlotMachine } from './SlotMachine'
import { BonusVideo } from './BonusVideo'
import { getDisplayName } from '../game/playerName'

interface GameStateSnapshot {
  hp: number; maxHp: number
  level: number; exp: number; floor: number
  stamina: number; maxStamina: number
  poisoned: boolean
  messages: string[]
  equipment: Equipment
  str: number; agi: number; dex: number
  int: number; vit: number; luk: number
  statPoints: number
  spells: Item[]; heals: Item[]; bag: Item[]
  minimapData: MinimapData | null
}

const DEFAULT: GameStateSnapshot = {
  hp: 0, maxHp: 0, level: 1, exp: 0, floor: 1,
  stamina: 0, maxStamina: 0, poisoned: false,
  messages: [], equipment: {},
  str: 1, agi: 1, dex: 1, int: 1, vit: 1, luk: 1, statPoints: 0,
  spells: [], heals: [], bag: [], minimapData: null,
}

const SLOTS = [
  { key: 'weapon'      as const, icon: '⚔️', label: '武器'   },
  { key: 'armor'       as const, icon: '🛡️', label: '鎧'     },
  { key: 'shoulder'    as const, icon: '🧣', label: '肩装備' },
  { key: 'boots'       as const, icon: '👟', label: '靴'     },
  { key: 'accessory1'  as const, icon: '💍', label: '指輪①' },
  { key: 'accessory2'  as const, icon: '💍', label: '指輪②' },
  { key: 'charm'       as const, icon: '🍀', label: 'お守り' },
]

const ALLOC_STATS: { key: AllocStat; label: string }[] = [
  { key: 'str', label: 'STR' }, { key: 'agi', label: 'AGI' },
  { key: 'dex', label: 'DEX' }, { key: 'vit', label: 'VIT' },
  { key: 'int', label: 'INT' }, { key: 'luk', label: 'LUK' },
]

function getLogColor(msg: string): string {
  if (msg.startsWith('🌐')) return '#ffce5a'   // ワールド通知（他プレイヤー含む）
  if (msg.includes('レベルアップ')) return '#5599ff'
  if (msg.includes('から') && msg.includes('ダメージ')) return '#ff5555'
  if (msg.includes('に') && msg.includes('ダメージ')) return '#44dd88'
  if (msg.includes('毒') || msg.includes('ベノムダスト') || msg.includes('スタミナ')) return '#cc66ff'
  if (msg.includes('装備した')) return '#ffdd33'
  return '#e8e8ff'
}

function group<T extends { name: string; id: string }>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, x) => {
    (acc[x.name] ??= []).push(x); return acc
  }, {})
}

type AccordionTab = 'item' | 'equip' | 'spell'

const ACCORDION_TABS: { key: AccordionTab; label: string }[] = [
  { key: 'item',  label: 'アイテム'   },
  { key: 'equip', label: '装備'       },
  { key: 'spell', label: '魔法の書'   },
]

const SPELL_INFO: Record<string, { icon: string; desc: string; effect: string }> = {
  'ファイアボルトの書':     { icon: '🔥', desc: '最も近い敵に炎のダメージを与える',           effect: 'ダメージ: INT × 3 + 10' },
  'ブレッシングの書':       { icon: '✨', desc: 'STR・INT・DEX・AGI を一時的に強化（10ターン）', effect: '各ステータス +5' },
  'ライトブレッシングの書': { icon: '💫', desc: '10ターン間、毎ターン HP を回復する',          effect: 'HP回復: 10ターン持続' },
  'クァグマイアの書':       { icon: '🌊', desc: 'フロア上の全ての敵を減速させる',              effect: '全敵スロー: 3ターン' },
  'メテオストームの書':     { icon: '☄️', desc: 'フロア上の全ての敵に隕石を降らせる',          effect: 'ダメージ: INT × 2 + 5（全敵）' },
}

export function UIPanel() {
  const [gs, setGs] = useState<GameStateSnapshot>(DEFAULT)
  const [selId, setSelId] = useState<string | null>(null)
  const [openTab, setOpenTab] = useState<AccordionTab | null>(null)
  const [spellDetail, setSpellDetail] = useState<string | null>(null)
  const [name, setName] = useState(getDisplayName)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => { if (window.gameState) setGs({ ...window.gameState }) }
    const onName = () => setName(getDisplayName())
    window.addEventListener('gamestate-update', update)
    window.addEventListener('displayname-changed', onName)
    return () => {
      window.removeEventListener('gamestate-update', update)
      window.removeEventListener('displayname-changed', onName)
    }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [gs.messages])

  // 選択アイテムが消えたらリセット
  useEffect(() => {
    if (!selId) return
    const all = [...gs.heals, ...gs.spells, ...gs.bag].map(x => x.id)
    if (!all.includes(selId)) { setSelId(null); setSpellDetail(null) }
  }, [gs.heals, gs.spells, gs.bag, selId])

  const healGroups  = group(gs.heals)
  const spellGroups = group(gs.spells)

  // アイテム行クリック
  const selectItem = (id: string) => { setSpellDetail(null); setSelId(s => s === id ? null : id) }

  // 選択中の装備アイテムとステータス差分
  const selEquip = selId ? gs.bag.find(x => x.id === selId && x.type === 'equip') : null
  const statDiff = (key: AllocStat): number => {
    if (!selEquip?.equipSlot) return 0
    const old = gs.equipment[selEquip.equipSlot]
    const newVal = (selEquip  as unknown as Record<string, number | undefined>)[`${key}Bonus`] ?? 0
    const oldVal = old ? ((old as unknown as Record<string, number | undefined>)[`${key}Bonus`] ?? 0) : 0
    return newVal - oldVal
  }
  const hpDiff = selEquip
    ? (selEquip.hpBonus ?? 0) - (selEquip.equipSlot ? (gs.equipment[selEquip.equipSlot]?.hpBonus ?? 0) : 0)
    : 0

  const hpPct    = gs.maxHp      > 0 ? Math.max(0, Math.round((gs.hp      / gs.maxHp)      * 100)) : 0
  const staPct   = gs.maxStamina > 0 ? Math.round((gs.stamina / gs.maxStamina) * 100) : 0
  const expNeeded = gs.level * 30 + 10
  const expPct   = Math.min(100, Math.round((gs.exp / expNeeded) * 100))

  return (
    <div className="ui-panel">

      {/* ── 最上段：フロア・Lv・HP/STA/EXP バー ── */}
      <div className="pc-status-top">
        <div className="pc-status-badges">
          <span className="badge floor-badge">B{gs.floor}F</span>
          <span className="badge level-badge">Lv {gs.level}</span>
          <span className="badge name-badge">{name}</span>
          {gs.poisoned && <span className="badge poison-badge">🟣 毒</span>}
          <button className="pc-save-btn" onClick={() => window.saveGame?.()}>セーブ</button>
        </div>
        <div className="bar-il-row">
          <span className="bar-il-lbl">HP</span>
          <div className="bar-il-track"><div className="bar-fill" style={{ width: `${hpPct}%`, backgroundColor: '#22c55e' }} /></div>
          <span className="bar-il-num">{Math.max(0, gs.hp)}/{gs.maxHp}</span>
        </div>
        <div className="bar-il-row">
          <span className="bar-il-lbl">STA</span>
          <div className="bar-il-track"><div className="bar-fill" style={{ width: `${staPct}%`, backgroundColor: '#3b82f6' }} /></div>
          <span className="bar-il-num">{gs.stamina}/{gs.maxStamina}</span>
        </div>
        <div className="bar-il-row">
          <span className="bar-il-lbl">EXP</span>
          <div className="bar-il-track"><div className="bar-fill" style={{ width: `${expPct}%`, backgroundColor: '#e0e0e0' }} /></div>
          <span className="bar-il-num">{gs.exp}/{expNeeded}</span>
        </div>
      </div>

      {/* ── スロット筐体（背景画像 + リール + 液晶） ── */}
      <SlotMachine>
        <BonusVideo />
      </SlotMachine>

      {/* ── 中段：ステータス（左50%）＋装備（右50%） ── */}
      <div className="stats-equip-row">

        {/* 左：STR/AGI/DEX/VIT/INT/LUK + EXP */}
        <div className="stat-panel">
          <p className="stat-panel-label">ステータス</p>
          {ALLOC_STATS.map(({ key, label }) => {
            const d = statDiff(key)
            return (
              <div key={key} className={`sp-row ${gs.statPoints > 0 ? 'sp-has-pts' : ''}`}>
                <span className="sp-label">{label}</span>
                <span className="sp-val">{gs[key]}</span>
                {d !== 0 && (
                  <span className="sp-diff" style={{ color: d > 0 ? '#44ff88' : '#ff5555' }}>
                    {d > 0 ? `+${d}` : d}
                  </span>
                )}
                {gs.statPoints > 0 && (
                  <button className="stat-plus-btn" onClick={() => window.allocateStat?.(key)}>＋</button>
                )}
              </div>
            )
          })}
          <div className="sp-row">
            <span className="sp-label">残pt</span>
            <span className="sp-val" style={{ color: gs.statPoints > 0 ? '#ffdd00' : '#8888aa' }}>{gs.statPoints}</span>
          </div>
          {hpDiff !== 0 && (
            <div className="sp-row">
              <span className="sp-label" style={{ color: '#8888a8' }}>HP上限</span>
              <span className="sp-diff" style={{ color: hpDiff > 0 ? '#44ff88' : '#ff5555' }}>
                {hpDiff > 0 ? `+${hpDiff}` : hpDiff}
              </span>
            </div>
          )}
        </div>

        {/* 右：装備欄（アイコン＋装備名） */}
        <div className="equip-panel-compact">
          <p className="equip-panel-label">装備</p>
          {SLOTS.map(slot => {
            const item = gs.equipment[slot.key]
            return (
              <div key={slot.key} className={`epc-row ${item ? 'epc-has' : 'epc-empty'}`}>
                <span className="epc-icon">{slot.icon}</span>
                <span className="epc-name">{item ? item.name : '─'}</span>
              </div>
            )
          })}
        </div>

      </div>

      {/* ── 下段：バトルログ（左2/3）＋アイテム（右1/3） ── */}
      <div className="log-items-row">

        {/* バトルログ */}
        <div className="log-panel">
          <p className="section-title-sm">ログ</p>
          <div className="log-list" ref={logRef}>
            {gs.messages.length === 0
              ? <div className="log-entry" style={{ color: '#666688' }}>─ ログなし ─</div>
              : [...gs.messages].reverse().map((msg, i) => (
                  <div key={i} className="log-entry" style={{ color: getLogColor(msg) }}>{msg}</div>
                ))
            }
          </div>
        </div>

        {/* アイテム欄：アコーディオン（アイテム／装備／魔法の書） */}
        <div className="items-panel">

          <p className="section-title-sm ip-inventory-title">インベントリ</p>

          <div className="ip-tabs ip-tabs-indent">
            {ACCORDION_TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`ip-tab ${openTab === key ? 'ip-tab-open' : ''}`}
                onClick={() => setOpenTab(t => t === key ? null : key)}
              >
                <span className="ip-tab-label">{label}</span>
                <span className="ip-tab-toggle">{openTab === key ? '－' : '＋'}</span>
              </button>
            ))}
          </div>

          <div className="ip-accordion-body">
            {openTab === 'item' && (
              <div className="ip-scroll">
                {Object.entries(healGroups).map(([name, items]) => (
                  <div key={name}>
                    <div className={`icr icr-heal ${selId === items[0].id ? 'icr-sel' : ''}`}
                      onClick={() => selectItem(items[0].id)}>
                      <span>{items[0].coin ? '🪙' : '💊'}</span>
                      <span className="icr-name">{name}{items.length > 1 ? `×${items.length}` : ''}</span>
                    </div>
                    {selId === items[0].id && (
                      <button className="icr-act" onClick={() => { window.useHeal?.(items[0].id); setSelId(null) }}>使う</button>
                    )}
                  </div>
                ))}
                {gs.heals.length === 0 && <p className="icr-empty">なし</p>}
              </div>
            )}

            {openTab === 'equip' && (
              <div className="ip-scroll">
                {gs.bag.map(item => (
                  <div key={item.id}>
                    <div className={`icr icr-bag ${selId === item.id ? 'icr-sel' : ''}`}
                      onClick={() => selectItem(item.id)}>
                      <span>📦</span>
                      <span className="icr-name">{item.name}</span>
                    </div>
                    {selId === item.id && (
                      <div className="icr-act-row">
                        <button className="icr-act" onClick={() => { window.equipFromBag?.(item.id); setSelId(null) }}>装備</button>
                        <button className="icr-act icr-act-discard" onClick={() => { window.discardFromBag?.(item.id); setSelId(null) }}>すてる</button>
                        <button className="icr-act icr-act-cancel" onClick={() => setSelId(null)}>キャンセル</button>
                      </div>
                    )}
                  </div>
                ))}
                {gs.bag.length === 0 && <p className="icr-empty">なし</p>}
              </div>
            )}

            {openTab === 'spell' && (
              <div className="ip-scroll">
                {Object.entries(spellGroups).map(([name, items]) => {
                  const info = SPELL_INFO[name]
                  const isSelected = selId === items[0].id
                  const showDetail = isSelected && spellDetail === name
                  return (
                    <div key={name}>
                      <div className={`icr icr-spell-book ${isSelected ? 'icr-sel' : ''}`}
                        onClick={() => selectItem(items[0].id)}>
                        <span>📖</span>
                        <span className="icr-name">{name}{items.length > 1 ? `×${items.length}` : ''}</span>
                      </div>
                      {isSelected && (
                        <>
                          <div className="icr-act-row">
                            <button className="icr-act icr-act-spell"
                              onClick={() => { window.useSpell?.(items[0].id); setSelId(null); setSpellDetail(null) }}>
                              使う
                            </button>
                            <button className="icr-act icr-act-detail"
                              onClick={() => setSpellDetail(s => s === name ? null : name)}>
                              詳細
                            </button>
                          </div>
                          {showDetail && info && (
                            <div className="spell-detail-panel">
                              <div className="spell-detail-title">{info.icon} {name}</div>
                              <div className="spell-detail-desc">{info.desc}</div>
                              <div className="spell-detail-effect">{info.effect}</div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
                {gs.spells.length === 0 && <p className="icr-empty">なし</p>}
              </div>
            )}

            {!openTab && <p className="icr-empty">タップして表示</p>}
          </div>

        </div>

      </div>

    </div>
  )
}
