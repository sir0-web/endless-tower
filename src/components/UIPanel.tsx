import { useEffect, useRef, useState } from 'react'
import type { Equipment, Item, MinimapData, AllocStat } from '../types'
import { SlotMachine } from './SlotMachine'
import { BonusVideo } from './BonusVideo'
import { HoldRepeatButton } from './HoldRepeatButton'
import { MailButton } from './MailButton'
import { getDisplayName } from '../game/playerName'
import { SoundMenu } from './SoundMenu'
import { ScreenSizeMenu } from './ScreenSizeMenu'

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

function getHealInfo(item: Item): { icon: string; desc: string; effect: string } {
  if (item.coin) return { icon: '🪙', desc: 'スロットを1回スピンさせる特殊コイン', effect: '女神の加護（敵撃破時20%でドロップ）' }
  if (item.wing === 'fly') return { icon: '🪰', desc: '同じ階の階段のそばへワープする', effect: '階段へ直行（行商人で購入）' }
  if (item.wing === 'butterfly') return { icon: '🦋', desc: '今いる階を再生成して仕切り直す', effect: 'フロア再構築（行商人で購入）' }
  if ((item.staminaPercent ?? 0) > 0) return { icon: '💊', desc: 'スタミナを回復するポーション', effect: `スタミナ +${item.staminaPercent}%` }
  if (item.healPercent) return { icon: '🧪', desc: '最大HPの割合で回復する上位ポーション', effect: `HP +最大の${Math.round(item.healPercent * 100)}%（最低${item.healAmount ?? 0}）` }
  return { icon: '💊', desc: 'HPを回復するポーション', effect: `HP +${item.healAmount ?? 0}` }
}

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
  const [healDetail, setHealDetail] = useState<string | null>(null)
  const [statsOpen, setStatsOpen] = useState(true)
  const [logEquipOpen, setLogEquipOpen] = useState(true)
  // 常時ステータスパネル用の一括入力（[指定]ボタンで開くステータスのみ）。StatModalと同じ方式。
  const [spBulkInputs, setSpBulkInputs] = useState<Partial<Record<AllocStat, string>>>({})
  const [spActiveKey, setSpActiveKey] = useState<AllocStat | null>(null)
  // スロット筐体の折りたたみ（PC。畳むとログ/インベントリが広がる。スマホはCSSで常時表示＝影響なし）
  const [slotOpen, setSlotOpen] = useState(() => localStorage.getItem('ebt_slot_open') !== '0')
  const toggleSlot = () => setSlotOpen(o => { const n = !o; localStorage.setItem('ebt_slot_open', n ? '1' : '0'); return n })
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
  const selectItem = (id: string) => { setSpellDetail(null); setHealDetail(null); setSelId(s => s === id ? null : id) }

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

  // ── 各パネルをJSX変数化し、PC/スマホで「配置だけ」を変える（内容は共通＝重複なし）──
  const statPanel = (
    <div className="stat-panel">
      <p className="stat-panel-label">ステータス</p>
      {ALLOC_STATS.map(({ key, label }) => {
        const d = statDiff(key)
        const isActive = spActiveKey === key
        const applySpBulk = () => {
          const raw = parseInt(spBulkInputs[key] ?? '', 10)
          if (!Number.isFinite(raw) || raw <= 0) return
          const n = Math.min(raw, gs.statPoints)   // 残りポイントを超えた入力は残りポイント数に丸める
          window.allocateStatBulk?.(key, n)
          setSpBulkInputs(prev => ({ ...prev, [key]: '' }))
          setSpActiveKey(null)
        }
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
              isActive ? (
                <div className="sp-bulk">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={gs.statPoints}
                    placeholder="個数"
                    className="sp-bulk-input"
                    autoFocus
                    value={spBulkInputs[key] ?? ''}
                    onChange={e => setSpBulkInputs(prev => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') applySpBulk(); if (e.key === 'Escape') setSpActiveKey(null) }}
                  />
                  <button type="button" className="sp-bulk-btn" disabled={!spBulkInputs[key]} onClick={applySpBulk}>追加</button>
                  <button type="button" className="sp-bulk-cancel" onClick={() => setSpActiveKey(null)}>✕</button>
                </div>
              ) : (
                <div className="sp-action-row">
                  <HoldRepeatButton className="stat-plus-btn" onPress={() => window.allocateStat?.(key)}>＋</HoldRepeatButton>
                  <button type="button" className="sp-designate-btn" onClick={() => setSpActiveKey(key)}>指定</button>
                </div>
              )
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
  )

  const equipPanel = (
    <div className="equip-panel-compact">
      <p className="equip-panel-label">装備</p>
      {SLOTS.map(slot => {
        const item = gs.equipment[slot.key]
        return (
          <div key={slot.key} className={`epc-row ${item ? 'epc-has' : 'epc-empty'}`}>
            <span className="epc-icon">{slot.icon}</span>
            <span className="epc-name">
              {item ? item.name : '─'}
              {!!item?.refineLevel && <span className="icr-refine"> +{item.refineLevel}</span>}
              {item?.locked && ' 🔒'}
            </span>
          </div>
        )
      })}
    </div>
  )

  const logPanel = (
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
  )

  const inventoryPanel = (
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
            {Object.entries(healGroups).map(([name, items]) => {
              const isSelected = selId === items[0].id
              const showDetail = isSelected && healDetail === name
              const info = getHealInfo(items[0])
              return (
                <div key={name}>
                  <div className={`icr icr-heal ${isSelected ? 'icr-sel' : ''}`}
                    onClick={() => selectItem(items[0].id)}>
                    <span>{info.icon}</span>
                    <span className="icr-name">{name}{items.length > 1 ? `×${items.length}` : ''}</span>
                  </div>
                  {isSelected && (
                    <>
                      <div className="icr-act-row">
                        <button className="icr-act"
                          onClick={() => { window.useHeal?.(items[0].id); setSelId(null); setHealDetail(null) }}>
                          使う
                        </button>
                        <button className="icr-act icr-act-detail"
                          onClick={() => setHealDetail(s => s === name ? null : name)}>
                          詳細
                        </button>
                        <button className="icr-act icr-act-cancel"
                          onClick={() => { setSelId(null); setHealDetail(null) }}>
                          キャンセル
                        </button>
                      </div>
                      {showDetail && (
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
                  <span className="icr-name">
                    {item.name}
                    {!!item.refineLevel && <span className="icr-refine"> +{item.refineLevel}</span>}
                  </span>
                  {item.locked && <span className="icr-lock">🔒</span>}
                </div>
                {selId === item.id && (
                  <div className="icr-act-row">
                    <button className="icr-act" onClick={() => { window.equipFromBag?.(item.id); setSelId(null) }}>装備</button>
                    {item.type === 'equip' && (
                      <button
                        className="icr-act icr-act-lock"
                        title={item.locked ? 'ロックを解除' : 'ロックする（精錬の生贄・破棄から保護）'}
                        onClick={() => { window.toggleLockItem?.(item.id) }}
                      >
                        {item.locked ? '🔓' : '🔒'}
                      </button>
                    )}
                    <button
                      className="icr-act icr-act-discard"
                      disabled={!!item.locked}
                      title={item.locked ? 'ロック中は捨てられません' : undefined}
                      onClick={() => { window.discardFromBag?.(item.id); setSelId(null) }}
                    >すてる</button>
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
  )

  return (
    <div className="ui-panel">

      {/* ── 最上段：フロア・Lv・HP/STA/EXP バー ── */}
      <div className="pc-status-top">
        <div className="pc-status-badges">
          <span className="badge floor-badge">B{gs.floor}F</span>
          <span className="badge level-badge">Lv {gs.level}</span>
          <span className="badge name-badge">{name}</span>
          {gs.poisoned && <span className="badge poison-badge">🟣 毒</span>}
          <MailButton className="pc-mute-btn" />
          <SoundMenu btnClassName="pc-mute-btn" />
          <ScreenSizeMenu btnClassName="pc-mute-btn" />
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

      {/* ── スロット筐体（背景画像 + リール + 液晶）──
          PCでは折りたたみトグルで縦スペースをログ/インベントリへ譲れる。
          SlotMachineは常時マウントのまま（撃破連動のスピン処理を止めないため）、
          折りたたみ時はCSSで非表示にする。スマホはCSSでトグル非表示＋常時表示。 */}
      <button
        type="button"
        className={`slot-toggle-btn ${slotOpen ? 'slot-open' : ''}`}
        onClick={toggleSlot}
      >
        <span>{slotOpen ? '女神の加護（スロット）を隠す' : '女神の加護（スロット）を表示'}</span>
        <span className="slot-toggle-arrow">{slotOpen ? '▲' : '▼'}</span>
      </button>
      <div className={`slot-wrap ${slotOpen ? '' : 'slot-collapsed'}`}>
        <SlotMachine>
          <BonusVideo />
        </SlotMachine>
      </div>

      {/* ── 中段・下段：PC/スマホ共通配列 ──
          上段=ステータス＋インベントリ（折りたたみ可）／下段=ログ＋装備（折りたたみ可）。 */}
      <div className={`stats-equip-row ${statsOpen ? '' : 'se-collapsed'}`}>
        <button
          type="button"
          className={`stats-equip-toggle ${statsOpen ? 'se-open' : ''}`}
          onClick={() => setStatsOpen(o => !o)}
        >
          <span className="se-title">ステータス / インベントリ</span>
          {!statsOpen && gs.statPoints > 0 && (
            <span className="se-pt-alert">⚡ 未付与ポイントあり</span>
          )}
          {!statsOpen && gs.bag.length > 0 && (
            <span className="se-badge se-badge-bag">📦 {gs.bag.length}</span>
          )}
          <span className="se-arrow">{statsOpen ? '▲' : '▼'}</span>
        </button>
        <div className="stats-equip-inner">
          {statPanel}
          {inventoryPanel}
        </div>
      </div>
      <div className={`log-equip-row ${logEquipOpen ? '' : 'le-collapsed'}`}>
        <button
          type="button"
          className={`stats-equip-toggle ${logEquipOpen ? 'se-open' : ''}`}
          onClick={() => setLogEquipOpen(o => !o)}
        >
          <span className="se-title">ログ / 装備</span>
          <span className="se-arrow">{logEquipOpen ? '▲' : '▼'}</span>
        </button>
        <div className="log-items-row">
          {logPanel}
          {equipPanel}
        </div>
      </div>

    </div>
  )
}
