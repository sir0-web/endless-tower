import { useEffect, useRef, useState } from 'react'
import type { BulkRefineResult, BulkShadowResult, EquipSlot, Item, RefineResult, ShadowResult, SpellbookResult } from '../types'
import { WING_ITEMS } from '../game/items'
import { refineSuccessPercent } from '../game/utils'

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: '武器', armor: '鎧', shoulder: '肩装備', boots: '靴',
  accessory1: '指輪①', accessory2: '指輪②', charm: 'お守り',
}

function useFacilityOpen(kind: 'refine' | 'shadow' | 'spellbook' | 'merchant', onForceClose?: () => void) {
  const [open, setOpen] = useState(false)
  const forceCloseRef = useRef(onForceClose)
  useEffect(() => { forceCloseRef.current = onForceClose })
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail === kind) setOpen(true)
    }
    // ゲームオーバー等でシーンが変わったら内部状態ごと強制クローズ
    // （GameScene 停止後は window.runRefineChallenge 等が使えず、開いたままだと詰むため）
    const onSceneChanged = () => {
      forceCloseRef.current?.()
      setOpen(false)
    }
    window.addEventListener('facility-open', onOpen)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('facility-open', onOpen)
      window.removeEventListener('game-scene-changed', onSceneChanged)
    }
  }, [kind])
  return [open, setOpen] as const
}

// ── 精錬チャレンジ ──
const BULK_REFINE_MAX = 10

export function RefineModal() {
  const [step, setStep] = useState<'select' | 'bulk-select' | 'video' | 'result' | 'bulk-result'>('select')
  const [slot, setSlot] = useState<EquipSlot | null>(null)
  const [sacrificeId, setSacrificeId] = useState<string | null>(null)
  const [bulkSacrificeIds, setBulkSacrificeIds] = useState<string[]>([])
  const [result, setResult] = useState<RefineResult | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkRefineResult | null>(null)

  const reset = () => {
    setStep('select'); setSlot(null); setSacrificeId(null)
    setBulkSacrificeIds([]); setResult(null); setBulkResult(null)
  }
  // 強制クローズ（シーン遷移）時も reset を通し、次回開いたとき途中画面から始まらないようにする
  const [open, setOpen] = useFacilityOpen('refine', reset)
  const close = () => { reset(); setOpen(false) }

  if (!open) return null

  const equipment = window.gameState?.equipment ?? {}
  const bag = window.gameState?.bag ?? []
  const equippedSlots = (Object.keys(equipment) as EquipSlot[]).filter(s => equipment[s])
  const sacrificeCandidates = bag.filter(i => i.type === 'equip')

  const start = () => {
    if (!slot || !sacrificeId) return
    const r = window.runRefineChallenge?.(slot, sacrificeId) ?? null
    setResult(r)
    setStep('video')
  }

  const toggleBulkSacrifice = (id: string) => {
    setBulkSacrificeIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= BULK_REFINE_MAX) return prev
      return [...prev, id]
    })
  }

  const startBulk = () => {
    if (!slot || bulkSacrificeIds.length === 0) return
    const r = window.runBulkRefineChallenge?.(slot, bulkSacrificeIds) ?? null
    setBulkResult(r)
    setStep('video')
  }

  const onVideoEnd = () => setStep(bulkResult ? 'bulk-result' : 'result')

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {(step === 'select' || step === 'bulk-select') && (
          <>
            <p className="facility-title">
              {step === 'bulk-select' ? '✨いっきにカンカン✨' : '✨精錬チャレンジ✨'}
            </p>
            <p className="facility-desc">
              {step === 'bulk-select'
                ? '精錬する装備と、生贄に捧げる未装備の武具を施工したい回数分（最大10個）選んでください。'
                : '精錬する装備と、生贄に捧げる未装備の武具を選んでください。'}
            </p>

            <p className="facility-sub">精錬する装備</p>
            <div className="facility-list">
              {equippedSlots.length === 0 && <p className="facility-empty">装備中のアイテムがありません</p>}
              {equippedSlots.map(s => {
                const item = equipment[s] as Item
                const level = item.refineLevel ?? 0
                return (
                  <button
                    key={s}
                    className={`facility-item${slot === s ? ' selected' : ''}`}
                    onClick={() => setSlot(s)}
                  >
                    <span className="fi-slot">{SLOT_LABELS[s]}</span>
                    <span className="fi-name">{item.name}</span>
                    {!!item.refineLevel && <span className="fi-refine">+{item.refineLevel}</span>}
                    <span className="fi-chance">成功率 {refineSuccessPercent(level)}%</span>
                  </button>
                )
              })}
            </div>
            {slot && equipment[slot] && (
              <p className="facility-chance">
                次の精錬レベル（＋{(equipment[slot]!.refineLevel ?? 0) + 1}）の成功確率：
                <b>{refineSuccessPercent(equipment[slot]!.refineLevel ?? 0)}%</b>
              </p>
            )}

            {step === 'bulk-select' ? (
              <>
                <p className="facility-sub">生贄にする未装備の武具（{bulkSacrificeIds.length}/{BULK_REFINE_MAX}）</p>
                <div className="facility-list">
                  {sacrificeCandidates.length === 0 && <p className="facility-empty">生贄にできる装備品がバッグにありません</p>}
                  {sacrificeCandidates.map(item => {
                    const selected = bulkSacrificeIds.includes(item.id)
                    const disabled = !selected && bulkSacrificeIds.length >= BULK_REFINE_MAX
                    return (
                      <button
                        key={item.id}
                        className={`facility-item${selected ? ' selected' : ''}`}
                        disabled={disabled}
                        onClick={() => toggleBulkSacrifice(item.id)}
                      >
                        <span className="fi-name">{item.name}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="facility-btns">
                  <button
                    className="facility-go-btn"
                    disabled={!slot || bulkSacrificeIds.length === 0}
                    onClick={startBulk}
                  >
                    {bulkSacrificeIds.length}回いっきにカンカン開始
                  </button>
                  <button className="facility-close-btn" onClick={() => { setBulkSacrificeIds([]); setStep('select') }}>もどる</button>
                </div>
              </>
            ) : (
              <>
                <p className="facility-sub">生贄にする未装備の武具</p>
                <div className="facility-list">
                  {sacrificeCandidates.length === 0 && <p className="facility-empty">生贄にできる装備品がバッグにありません</p>}
                  {sacrificeCandidates.map(item => (
                    <button
                      key={item.id}
                      className={`facility-item${sacrificeId === item.id ? ' selected' : ''}`}
                      onClick={() => setSacrificeId(item.id)}
                    >
                      <span className="fi-name">{item.name}</span>
                    </button>
                  ))}
                </div>

                <div className="facility-btns">
                  <button className="facility-go-btn" disabled={!slot || !sacrificeId} onClick={start}>精錬する</button>
                  <button
                    className="facility-go-btn facility-bulk-btn"
                    disabled={sacrificeCandidates.length < 1}
                    onClick={() => setStep('bulk-select')}
                  >
                    いっきにカンカン
                  </button>
                  <button className="facility-close-btn" onClick={close}>やめる</button>
                </div>
              </>
            )}
          </>
        )}

        {step === 'video' && (
          <div className="facility-video-wrap">
            <video
              src="/assets/event/seiren.mp4"
              autoPlay muted playsInline
              onEnded={onVideoEnd}
              onError={onVideoEnd}
              className="facility-video"
            />
          </div>
        )}

        {step === 'result' && result && (
          <div className="facility-result">
            <p className={`facility-result-text ${result.success ? 'fr-success' : 'fr-failure'}`}>
              {result.success ? 'success!!' : 'failure...'}
            </p>
            <p className="facility-result-sub">
              {result.success
                ? `${result.itemName} は ＋${result.refineLevel} になった！`
                : `${result.itemName} の精錬は失敗に終わった（現在 ＋${result.refineLevel}）`}
            </p>
            <button className="facility-close-btn" onClick={close}>閉じる</button>
          </div>
        )}

        {step === 'bulk-result' && bulkResult && (
          <div className="facility-result facility-bulk-result">
            <p className="facility-result-text">いっきにカンカン けっか</p>
            <p className="facility-bulk-target">対象装備：{bulkResult.itemName}</p>
            <ul className="facility-bulk-list">
              {bulkResult.attempts.map((a, i) => (
                <li key={i} className={a.success ? 'fr-success' : 'fr-failure'}>
                  {i + 1}回目：+{a.before}→+{a.after}
                </li>
              ))}
            </ul>
            <button className="facility-close-btn" onClick={close}>閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 影装チャレンジ ──
const BULK_SHADOW_MAX = 10

export function ShadowEquipModal() {
  const [step, setStep] = useState<'main' | 'bulk-select' | 'result' | 'bulk-result'>('main')
  const [result, setResult] = useState<ShadowResult | null>(null)
  const [bulkResult, setBulkResult] = useState<BulkShadowResult | null>(null)
  const [bulkCount, setBulkCount] = useState(1)
  const COST = 5

  const reset = () => { setStep('main'); setResult(null); setBulkResult(null); setBulkCount(1) }
  // 強制クローズ（シーン遷移）時も結果画面が残らないようリセットを渡す
  const [open, setOpen] = useFacilityOpen('shadow', reset)
  const close = () => { reset(); setOpen(false) }

  if (!open) return null

  const statPoints = window.gameState?.statPoints ?? 0
  const maxAffordable = Math.min(BULK_SHADOW_MAX, Math.floor(statPoints / COST))

  const start = () => {
    const r = window.runShadowChallenge?.() ?? null
    setResult(r)
    setStep('result')
  }

  const startBulk = () => {
    const r = window.runBulkShadowChallenge?.(bulkCount) ?? null
    setBulkResult(r)
    setStep('bulk-result')
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {step === 'main' && (
          <>
            <p className="facility-title">🌑影装チャレンジ🌑</p>
            <p className="facility-desc">
              ボーナスステータスポイントを {COST} 消費して挑戦します。<br />
              成功（一定の低確率）すると全ステータス＋3。失敗してもデバフはありません。
            </p>
            <p className="facility-sub">所持ボーナスポイント：{statPoints}</p>
            <div className="facility-btns">
              <button className="facility-go-btn" disabled={statPoints < COST} onClick={start}>挑戦する</button>
              <button
                className="facility-go-btn facility-bulk-btn"
                disabled={maxAffordable < 1}
                onClick={() => { setBulkCount(maxAffordable); setStep('bulk-select') }}
              >
                いっきにエイ！エイ！ソー！
              </button>
              <button className="facility-close-btn" onClick={close}>やめる</button>
            </div>
            {statPoints < COST && <p className="facility-empty">ボーナスポイントが足りません</p>}
          </>
        )}

        {step === 'bulk-select' && (
          <>
            <p className="facility-title">✨いっきにエイ！エイ！ソー！✨</p>
            <p className="facility-desc">
              1回 {COST} ポイント消費して、指定回数ぶん連続で影装チャレンジに挑戦します（最大{BULK_SHADOW_MAX}回）。
            </p>
            <p className="facility-sub">所持ボーナスポイント：{statPoints}</p>
            <p className="facility-sub">挑戦回数：{bulkCount}回（消費 {bulkCount * COST} ポイント）</p>
            <div className="facility-list">
              {Array.from({ length: maxAffordable }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  className={`facility-item${bulkCount === n ? ' selected' : ''}`}
                  onClick={() => setBulkCount(n)}
                >
                  <span className="fi-name">{n}回</span>
                </button>
              ))}
            </div>
            <div className="facility-btns">
              <button className="facility-go-btn" disabled={bulkCount < 1} onClick={startBulk}>
                {bulkCount}回いっきにエイ！エイ！ソー！開始
              </button>
              <button className="facility-close-btn" onClick={() => setStep('main')}>もどる</button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <div className="facility-result">
            <p className={`facility-result-text ${result.success ? 'fr-success' : 'fr-failure'}`}>
              {result.success ? 'success!!' : 'failure...'}
            </p>
            <p className="facility-result-sub">
              {result.success ? '全ステータスが＋3された！' : 'ボーナスポイントを失った...'}
            </p>
            <button className="facility-close-btn" onClick={close}>閉じる</button>
          </div>
        )}

        {step === 'bulk-result' && bulkResult && (
          <div className="facility-result facility-bulk-result">
            <p className="facility-result-text">いっきにエイ！エイ！ソー！ けっか</p>
            <p className="facility-bulk-target">
              {bulkResult.attempts.filter(a => a.success).length}/{bulkResult.attempts.length}回 成功
            </p>
            <ul className="facility-bulk-list">
              {bulkResult.attempts.map((a, i) => (
                <li key={i} className={a.success ? 'fr-success' : 'fr-failure'}>
                  {i + 1}回目：{a.success ? '成功！全ステータス+3' : '失敗...'}
                </li>
              ))}
            </ul>
            <button className="facility-close-btn" onClick={close}>閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 行商人（羽の購入）。価格(cost)は WING_ITEMS を単一ソースとして参照 ──
const MERCHANT_ITEMS = [
  { key: 'fly'       as const, icon: WING_ITEMS.fly.icon,       name: WING_ITEMS.fly.name,       cost: WING_ITEMS.fly.cost,       desc: WING_ITEMS.fly.desc,       holdMax: WING_ITEMS.fly.holdMax },
  { key: 'butterfly' as const, icon: WING_ITEMS.butterfly.icon, name: WING_ITEMS.butterfly.name, cost: WING_ITEMS.butterfly.cost, desc: WING_ITEMS.butterfly.desc, holdMax: WING_ITEMS.butterfly.holdMax },
]

export function MerchantModal() {
  const [, setTick] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)

  // 強制クローズ（シーン遷移）時もメッセージが残らないようリセットを渡す
  const [open, setOpen] = useFacilityOpen('merchant', () => setMsg(null))
  const close = () => { setMsg(null); setOpen(false) }

  if (!open) return null

  const heals = window.gameState?.heals ?? []
  const coins = heals.filter(h => h.coin).length
  const heldCount = (name: string) => heals.filter(h => h.name === name).length

  const buy = (key: 'fly' | 'butterfly') => {
    const r = window.buyMerchantItem?.(key)
    if (!r) return
    if (r.ok) {
      const name = MERCHANT_ITEMS.find(i => i.key === key)!.name
      setMsg(`${name} を購入した！`)
    } else if (r.reason === 'coin') {
      setMsg('女神のコインが足りません…')
    } else if (r.reason === 'limit') {
      const max = MERCHANT_ITEMS.find(i => i.key === key)!.holdMax
      setMsg(`これ以上は持てません（上限${max}個）`)
    }
    setTick(t => t + 1)
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        <p className="facility-title">🛒行商人とるいぬ🛒</p>
        <p className="facility-desc">
          女神のコインと「羽」を交換するよ。羽は持てる数に上限があるよ。
        </p>
        <p className="facility-sub">所持コイン：🪙 {coins}</p>
        <div className="facility-list">
          {MERCHANT_ITEMS.map(it => {
            const held = heldCount(it.name)
            const full = held >= it.holdMax
            const disabled = full || coins < it.cost
            return (
              <div key={it.key} className="facility-item" style={{ alignItems: 'center', gap: 8 }}>
                <span className="fi-name" style={{ flex: 1 }}>
                  {it.icon} {it.name} <span style={{ opacity: 0.7 }}>（{held}/{it.holdMax}・🪙{it.cost}）</span>
                  <br /><span className="facility-empty" style={{ fontSize: '0.8em' }}>{it.desc}</span>
                </span>
                <button className="facility-go-btn" disabled={disabled} onClick={() => buy(it.key)}>
                  🪙{it.cost}で購入
                </button>
              </div>
            )
          })}
        </div>
        {msg && <p className="facility-sub">{msg}</p>}
        <div className="facility-btns">
          <button className="facility-close-btn" onClick={close}>とじる</button>
        </div>
      </div>
    </div>
  )
}

// ── 魔法の書チャレンジ ──
export function SpellbookModal() {
  const [spellId, setSpellId] = useState<string | null>(null)
  const [result, setResult] = useState<SpellbookResult | null>(null)

  // 強制クローズ（シーン遷移）時も途中状態が残らないようリセットを渡す
  const [open, setOpen] = useFacilityOpen('spellbook', () => { setSpellId(null); setResult(null) })
  const close = () => { setSpellId(null); setResult(null); setOpen(false) }

  if (!open) return null

  const spells = window.gameState?.spells ?? []

  const start = () => {
    if (!spellId) return
    const r = window.runSpellbookChallenge?.(spellId) ?? null
    setResult(r)
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {!result && (
          <>
            <p className="facility-title">📖魔法の書チャレンジ📖</p>
            <p className="facility-desc">
              いらない魔法の書を渡すと、ランダムで別の魔法の書と交換できます。<br />
              30%の確率で書物は燃え尽きてしまいます。
            </p>
            <div className="facility-list">
              {spells.length === 0 && <p className="facility-empty">魔法の書を持っていません</p>}
              {spells.map(item => (
                <button
                  key={item.id}
                  className={`facility-item${spellId === item.id ? ' selected' : ''}`}
                  onClick={() => setSpellId(item.id)}
                >
                  <span className="fi-name">{item.name}</span>
                </button>
              ))}
            </div>
            <div className="facility-btns">
              <button className="facility-go-btn" disabled={!spellId} onClick={start}>渡す</button>
              <button className="facility-close-btn" onClick={close}>やめる</button>
            </div>
          </>
        )}

        {result && (
          <div className="facility-result">
            <p className={`facility-result-text ${result.success ? 'fr-success' : 'fr-failure'}`}>
              {result.success ? 'success!!' : 'failure...'}
            </p>
            <p className="facility-result-sub">
              {result.success
                ? `${result.lostName} → ${result.gainedName} を手に入れた！`
                : `${result.lostName} は燃え尽きてしまった...`}
            </p>
            <button className="facility-close-btn" onClick={close}>閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}
