import { useEffect, useRef, useState } from 'react'
import type { Equipment, Item, MinimapData } from '../types'
import { floorLabel } from '../game/utils'
import { isMuted, toggleMute as soundToggleMute } from '../game/sound'
import { MinimapCanvas } from './MinimapCanvas'

interface GameStateSnapshot {
  hp: number; maxHp: number
  attack: number; defense: number
  level: number; exp: number; floor: number
  stamina: number; maxStamina: number
  poisoned: boolean
  messages: string[]
  equipment: Equipment
  str: number; agi: number; dex: number
  int: number; vit: number; luk: number
  statPoints: number
  spells: Item[]
  heals: Item[]
  bag: Item[]
  minimapData: MinimapData | null
}

const DEFAULT: GameStateSnapshot = {
  hp: 0, maxHp: 0, attack: 0, defense: 0,
  level: 1, exp: 0, floor: 1,
  stamina: 0, maxStamina: 0, poisoned: false,
  messages: [], equipment: {},
  str: 1, agi: 1, dex: 1, int: 1, vit: 1, luk: 1, statPoints: 0,
  spells: [], heals: [], bag: [], minimapData: null,
}

const SLOTS = [
  { key: 'weapon'      as const, label: '武器',   icon: '⚔️' },
  { key: 'armor'       as const, label: '鎧',     icon: '🛡️' },
  { key: 'shoulder'    as const, label: '肩装備', icon: '🧣' },
  { key: 'boots'       as const, label: '靴',     icon: '👟' },
  { key: 'accessory1'  as const, label: '指輪①', icon: '💍' },
  { key: 'accessory2'  as const, label: '指輪②', icon: '💍' },
  { key: 'charm'       as const, label: 'お守り', icon: '🍀' },
]

function getLogColor(msg: string): string {
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

export function UIPanel() {
  const [gs, setGs] = useState<GameStateSnapshot>(DEFAULT)
  const [mute, setMute] = useState(isMuted())
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => {
      if (window.gameState) setGs({ ...window.gameState })
    }
    window.addEventListener('gamestate-update', update)
    return () => window.removeEventListener('gamestate-update', update)
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [gs.messages])

  const toggleMute = () => { soundToggleMute(); setMute(p => !p) }

  const hpPct    = gs.maxHp > 0 ? Math.max(0, Math.round((gs.hp / gs.maxHp) * 100)) : 0
  const staPct   = gs.maxStamina > 0 ? Math.round((gs.stamina / gs.maxStamina) * 100) : 0
  const staColor = staPct > 40 ? '#22c55e' : staPct > 15 ? '#f59e0b' : '#ef4444'
  const expNeeded = gs.level * 30 + 10

  const healGroups  = group(gs.heals)
  const spellGroups = group(gs.spells)
  const hasItems    = gs.heals.length + gs.spells.length + gs.bag.length > 0

  return (
    <div className="ui-panel">

      {/* ── 上段：ミニマップ ── */}
      <div className="minimap-section">
        <MinimapCanvas data={gs.minimapData} />
      </div>

      {/* ── 中段：装備（左）＋アイテム（右） ── */}
      <div className="mid-row">

        {/* 装備欄（左50%）：アイコン＋名前のみ */}
        <div className="compact-equip">
          <p className="section-title-sm">装備</p>
          {SLOTS.map(slot => {
            const item = gs.equipment[slot.key]
            return (
              <div key={slot.key} className={`cq-row ${item ? 'cq-has' : 'cq-empty'}`}>
                <span className="cq-icon">{slot.icon}</span>
                <span className="cq-name">{item ? item.name : '─'}</span>
              </div>
            )
          })}
        </div>

        {/* アイテム欄（右50%）：名前（個数）のみ */}
        <div className="compact-items">
          <p className="section-title-sm">アイテム</p>
          <div className="compact-item-scroll">
            {Object.entries(healGroups).map(([name, items]) => (
              <div key={name} className="ci-row ci-heal">
                <span className="ci-icon">💊</span>
                <span className="ci-name">{name}{items.length > 1 ? `（${items.length}）` : ''}</span>
                <button className="ci-btn ci-use-btn" onClick={() => window.useHeal?.(items[0].id)}>使う</button>
              </div>
            ))}
            {Object.entries(spellGroups).map(([name, items]) => (
              <div key={name} className="ci-row ci-spell">
                <span className="ci-icon">📖</span>
                <span className="ci-name">{name}{items.length > 1 ? `（${items.length}）` : ''}</span>
                <button className="ci-btn ci-use-btn" onClick={() => window.useSpell?.(items[0].id)}>使う</button>
              </div>
            ))}
            {gs.bag.map(item => (
              <div key={item.id} className="ci-row ci-bag">
                <span className="ci-icon">📦</span>
                <span className="ci-name">{item.name}</span>
                <button className="ci-btn ci-equip-btn" onClick={() => window.equipFromBag?.(item.id)}>装備</button>
              </div>
            ))}
            {!hasItems && <p className="ci-empty">なし</p>}
          </div>
        </div>

      </div>

      {/* ── 下段：ステータス ── */}
      <section className="panel-section status-section">
        <div className="section-header">
          <p className="section-title">ステータス</p>
          <button className="mute-btn" onClick={toggleMute} title={mute ? 'ミュート解除' : 'ミュート'}>
            {mute ? '🔇' : '🔊'}
          </button>
        </div>

        <div className="floor-level">
          <span className="badge floor-badge">{floorLabel(gs.floor)}</span>
          <span className="badge level-badge">Lv {gs.level}</span>
          {gs.poisoned && <span className="badge poison-badge">🟣 毒</span>}
        </div>

        <div className="stat-label">
          HP <span className="val">{Math.max(0, gs.hp)}</span> / <span className="val">{gs.maxHp}</span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${hpPct}%`, backgroundColor: '#22c55e' }} />
        </div>

        <div className="stat-label">
          スタミナ <span className="val">{gs.stamina}</span> / <span className="val">{gs.maxStamina}</span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${staPct}%`, backgroundColor: staColor }} />
        </div>

        <div className="stat-grid">
          {[
            ['ATK', gs.attack], ['DEF', gs.defense], ['EXP', `${gs.exp}/${expNeeded}`],
            ['STR', gs.str],   ['AGI', gs.agi],     ['DEX', gs.dex],
            ['VIT', gs.vit],   ['INT', gs.int],     ['LUK', gs.luk],
          ].map(([k, v]) => (
            <div key={k} className="stat-item">
              <span className="stat-key">{k}</span>
              <span className="stat-val">{v}</span>
            </div>
          ))}
        </div>
        {gs.statPoints > 0 && (
          <p className="stat-points-notice">未割り振り {gs.statPoints}pt ▶ Lvアップ画面で振り分け</p>
        )}
      </section>

      {/* ── 最下段：バトルログ ── */}
      <section className="panel-section log-section">
        <p className="section-title">バトルログ</p>
        <div className="log-list" ref={logRef}>
          {gs.messages.length === 0
            ? <div className="log-entry" style={{ color: '#666688' }}>─ ログなし ─</div>
            : [...gs.messages].reverse().map((msg, i) => (
                <div key={i} className="log-entry" style={{ color: getLogColor(msg) }}>
                  {msg}
                </div>
              ))
          }
        </div>
      </section>

    </div>
  )
}
