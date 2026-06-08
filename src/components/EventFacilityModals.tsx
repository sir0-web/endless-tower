import { useEffect, useState } from 'react'
import type { EquipSlot, Item, RefineResult, ShadowResult, SpellbookResult } from '../types'

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: '武器', armor: '鎧', shoulder: '肩装備', boots: '靴',
  accessory1: '指輪①', accessory2: '指輪②', charm: 'お守り',
}

function useFacilityOpen(kind: 'refine' | 'shadow' | 'spellbook') {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail === kind) setOpen(true)
    }
    window.addEventListener('facility-open', onOpen)
    return () => window.removeEventListener('facility-open', onOpen)
  }, [kind])
  return [open, setOpen] as const
}

// ── 精錬チャレンジ ──
export function RefineModal() {
  const [open, setOpen] = useFacilityOpen('refine')
  const [step, setStep] = useState<'select' | 'video' | 'result'>('select')
  const [slot, setSlot] = useState<EquipSlot | null>(null)
  const [sacrificeId, setSacrificeId] = useState<string | null>(null)
  const [result, setResult] = useState<RefineResult | null>(null)

  const reset = () => { setStep('select'); setSlot(null); setSacrificeId(null); setResult(null) }
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

  const onVideoEnd = () => setStep('result')

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {step === 'select' && (
          <>
            <p className="facility-title">✨精錬チャレンジ✨</p>
            <p className="facility-desc">精錬する装備と、生贄に捧げる未装備の武具を選んでください。</p>

            <p className="facility-sub">精錬する装備</p>
            <div className="facility-list">
              {equippedSlots.length === 0 && <p className="facility-empty">装備中のアイテムがありません</p>}
              {equippedSlots.map(s => {
                const item = equipment[s] as Item
                return (
                  <button
                    key={s}
                    className={`facility-item${slot === s ? ' selected' : ''}`}
                    onClick={() => setSlot(s)}
                  >
                    <span className="fi-slot">{SLOT_LABELS[s]}</span>
                    <span className="fi-name">{item.name}</span>
                    {!!item.refineLevel && <span className="fi-refine">+{item.refineLevel}</span>}
                  </button>
                )
              })}
            </div>

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
              <button className="facility-close-btn" onClick={close}>やめる</button>
            </div>
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
      </div>
    </div>
  )
}

// ── 影装チャレンジ ──
export function ShadowEquipModal() {
  const [open, setOpen] = useFacilityOpen('shadow')
  const [result, setResult] = useState<ShadowResult | null>(null)
  const COST = 5

  const close = () => { setResult(null); setOpen(false) }

  if (!open) return null

  const statPoints = window.gameState?.statPoints ?? 0

  const start = () => {
    const r = window.runShadowChallenge?.() ?? null
    setResult(r)
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {!result && (
          <>
            <p className="facility-title">🌑影装チャレンジ🌑</p>
            <p className="facility-desc">
              ボーナスステータスポイントを {COST} 消費して挑戦します。<br />
              成功（30%）すると全ステータス＋3。失敗してもデバフはありません。
            </p>
            <p className="facility-sub">所持ボーナスポイント：{statPoints}</p>
            <div className="facility-btns">
              <button className="facility-go-btn" disabled={statPoints < COST} onClick={start}>挑戦する</button>
              <button className="facility-close-btn" onClick={close}>やめる</button>
            </div>
            {statPoints < COST && <p className="facility-empty">ボーナスポイントが足りません</p>}
          </>
        )}

        {result && (
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
      </div>
    </div>
  )
}

// ── 魔法の書チャレンジ ──
export function SpellbookModal() {
  const [open, setOpen] = useFacilityOpen('spellbook')
  const [spellId, setSpellId] = useState<string | null>(null)
  const [result, setResult] = useState<SpellbookResult | null>(null)

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
