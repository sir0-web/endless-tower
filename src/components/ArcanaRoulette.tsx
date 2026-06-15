import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// アルカナチャンス専用ルーレット。
// 左2つ=足し算、右1つ=掛け算。(左+中央)*右 = 獲得ポイント。
// 出目は1〜6。4が最も出やすく、3〜4を基準に1・6へ向かって出にくくなる。
// （3〜4 ＋ 3〜4）＊ 3〜4 ＝ 18〜32 が最頻となる重み付け。
const REEL_WEIGHTS: Record<number, number> = {
  1: 4,
  2: 9,
  3: 24,
  4: 28,
  5: 13,
  6: 5,
}
const WEIGHT_TOTAL = Object.values(REEL_WEIGHTS).reduce((a, b) => a + b, 0)

function rollWeighted(): number {
  let r = Math.random() * WEIGHT_TOTAL
  for (let n = 1; n <= 6; n++) {
    r -= REEL_WEIGHTS[n]
    if (r < 0) return n
  }
  return 4
}

type Triple = [number, number, number]
type Phase = 'hidden' | 'intro' | 'spinning' | 'result'

interface Sparkle { id: number; tx: number; ty: number; size: number; delay: number; dur: number }

function genSparkles(count: number): Sparkle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * Math.PI * 2
    const dist = 120 + Math.random() * 260
    return {
      id: i,
      tx: Math.cos(angle) * dist,
      ty: Math.sin(angle) * dist,
      size: 6 + Math.random() * 10,
      delay: Math.random() * 0.3,
      dur: 0.5 + Math.random() * 0.6,
    }
  })
}

const SPIN_TICK_MS = 70
// 各リールが「停止可能」になるまでの最短回転時間（早すぎる連打を防ぐ）
const MIN_SPIN_MS = 500

export function ArcanaRoulette() {
  const [phase, setPhase]       = useState<Phase>('hidden')
  const [display, setDisplay]   = useState<Triple>([1, 1, 1])
  const [stopped, setStopped]   = useState<[boolean, boolean, boolean]>([false, false, false])
  const [armed, setArmed]       = useState(false) // 現在アクティブなリールが停止受付可能か
  const [points, setPoints]     = useState(0)

  const finalsRef    = useRef<Triple>([4, 4, 4])
  const displayRef   = useRef<Triple>([1, 1, 1])
  const ivRef        = useRef<(ReturnType<typeof setInterval> | null)[]>([null, null, null])
  const timersRef    = useRef<ReturnType<typeof setTimeout>[]>([])
  const stoppedRef   = useRef<[boolean, boolean, boolean]>([false, false, false])
  const stopCountRef = useRef(0)
  const onCompleteRef = useRef<(() => void) | null>(null)

  // 停止済みリール数から、現在操作可能なリール index を導出する（左→中央→右）
  const activeIdx = stopped[0] ? (stopped[1] ? (stopped[2] ? -1 : 2) : 1) : 0

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timersRef.current = timersRef.current.filter(x => x !== t)
      fn()
    }, ms)
    timersRef.current.push(t)
    return t
  }, [])

  const clearAll = useCallback(() => {
    ivRef.current.forEach((iv, i) => { if (iv !== null) { clearInterval(iv); ivRef.current[i] = null } })
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  const startReelSpin = useCallback((idx: number) => {
    if (ivRef.current[idx] !== null) { clearInterval(ivRef.current[idx]!); ivRef.current[idx] = null }
    ivRef.current[idx] = setInterval(() => {
      displayRef.current[idx] = (displayRef.current[idx] % 6) + 1
      setDisplay([...displayRef.current] as Triple)
    }, SPIN_TICK_MS)
  }, [])

  // 操作受付の解禁：アクティブになったリールが最短回転時間を経て止められるようになる
  const armActive = useCallback(() => {
    setArmed(false)
    addTimer(() => setArmed(true), MIN_SPIN_MS)
  }, [addTimer])

  const handleStart = useCallback(() => {
    finalsRef.current = [rollWeighted(), rollWeighted(), rollWeighted()]
    setPhase('spinning')
    ;[0, 1, 2].forEach(startReelSpin)
    armActive()
  }, [startReelSpin, armActive])

  const finishAndClose = useCallback((earned: number) => {
    // ポイント付与（GameScene側）→ ワールド通知もGameScene側で発火
    window.applyArcanaResult?.(earned)
    addTimer(() => {
      setPhase('hidden')
      setStopped([false, false, false])
      stoppedRef.current = [false, false, false]
      stopCountRef.current = 0
      const cb = onCompleteRef.current
      onCompleteRef.current = null
      cb?.()
      // 通常画面に戻った後、中央表示と同じ内容をイベントメッセージウィンドウへ
      window.showEventMessage?.(`🌌 アルカナチャンス！ ${earned} ポイント獲得！`, '#ff66ff')
    }, 4200)
  }, [addTimer])

  const stopReel = useCallback((idx: number) => {
    if (stoppedRef.current[idx]) return
    if (ivRef.current[idx] !== null) { clearInterval(ivRef.current[idx]!); ivRef.current[idx] = null }
    const f = finalsRef.current[idx]
    displayRef.current[idx] = f
    setDisplay([...displayRef.current] as Triple)
    stoppedRef.current[idx] = true
    setStopped([...stoppedRef.current] as [boolean, boolean, boolean])
    stopCountRef.current++

    if (stopCountRef.current === 3) {
      const [a, b, c] = finalsRef.current
      const earned = (a + b) * c
      addTimer(() => {
        setPoints(earned)
        setPhase('result')
        finishAndClose(earned)
      }, 650)
    } else {
      // 次のリールが操作可能になる
      armActive()
    }
  }, [addTimer, armActive, finishAndClose])

  const handleReelStop = useCallback((idx: number) => {
    if (phase !== 'spinning') return
    if (idx !== activeIdx) return
    if (!armed) return
    stopReel(idx)
  }, [phase, activeIdx, armed, stopReel])

  // 外部公開：アルカナ動画終了後に呼ばれる
  useEffect(() => {
    window.showArcanaRoulette = (onComplete: () => void) => {
      clearAll()
      onCompleteRef.current = onComplete
      displayRef.current = [1, 1, 1]
      setDisplay([1, 1, 1])
      stoppedRef.current = [false, false, false]
      setStopped([false, false, false])
      stopCountRef.current = 0
      setArmed(false)
      setPoints(0)
      setPhase('intro')
    }
    return () => { window.showArcanaRoulette = undefined }
  }, [clearAll])

  // シーン切替時は強制クローズ（タイマー/インターバル掃除）
  useEffect(() => {
    const reset = () => {
      clearAll()
      onCompleteRef.current = null
      setPhase('hidden')
      stoppedRef.current = [false, false, false]
      stopCountRef.current = 0
    }
    window.addEventListener('game-scene-changed', reset)
    return () => window.removeEventListener('game-scene-changed', reset)
  }, [clearAll])

  useEffect(() => () => clearAll(), [clearAll])

  const sparkles = useMemo(
    () => phase === 'result' ? genSparkles(28) : [],
    [phase],
  )

  if (phase === 'hidden') return null

  const reelClass = (i: number) => {
    if (stopped[i]) return 'ar-reel ar-locked'
    if (phase === 'spinning' && i === activeIdx) return 'ar-reel ar-active'
    if (phase === 'spinning') return 'ar-reel ar-fog'
    return 'ar-reel'
  }

  return (
    <div className="ar-root">
      <div className="ar-backdrop" />

      <div className="ar-stage">
        <p className="ar-title">🌌 ARCANA CHANCE 🌌</p>

        <div className="ar-reels">
          <button type="button" className={reelClass(0)} onClick={() => handleReelStop(0)}>
            {phase === 'spinning' && activeIdx === 0 && armed && <span className="ar-arrow">▼</span>}
            <span className="ar-num">{display[0]}</span>
          </button>

          <button type="button" className={reelClass(1)} onClick={() => handleReelStop(1)}>
            {phase === 'spinning' && activeIdx === 1 && armed && <span className="ar-arrow">▼</span>}
            <span className="ar-num">{display[1]}</span>
          </button>

          <button type="button" className={reelClass(2)} onClick={() => handleReelStop(2)}>
            {phase === 'spinning' && activeIdx === 2 && armed && <span className="ar-arrow">▼</span>}
            <span className="ar-num">{display[2]}</span>
          </button>
        </div>

        {phase === 'spinning' && activeIdx >= 0 && (
          <p className="ar-guide">
            {activeIdx === 2 ? '最後のリールを止めろ！（×）' : `${activeIdx === 0 ? '左' : '中央'}のリールを止めろ！`}
          </p>
        )}

        {phase === 'result' && (
          <div className="ar-result">
            <p className="ar-earned" key={points}>
              <b>{points}</b> ポイント獲得！
            </p>
          </div>
        )}
      </div>

      {phase === 'result' && sparkles.length > 0 && (
        <div className="ar-sparkle-origin">
          {sparkles.map(s => (
            <div
              key={s.id}
              className="ar-sparkle"
              style={{
                width: s.size,
                height: s.size,
                '--ar-tx': `${s.tx}px`,
                '--ar-ty': `${s.ty}px`,
                '--ar-dur': `${s.dur}s`,
                '--ar-delay': `${s.delay}s`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      {phase === 'intro' && (
        <div className="ar-modal">
          <div className="ar-modal-card">
            <p className="ar-modal-title">大量ポイントゲットチャンス！</p>
            <button type="button" className="ar-start-btn" onClick={handleStart}>
              開始する
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
