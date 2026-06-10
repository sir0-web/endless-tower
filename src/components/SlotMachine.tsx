import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

const SYMBOLS    = 7
const CREDIT_MAX = 3
const STOCK_MAX  = 10
function rand() { return Math.floor(Math.random() * SYMBOLS) + 1 }
type Triplet = [number, number, number]

function evaluate(reels: Triplet): string {
  const [a, b, c] = reels
  if (a === 7 && b === 7 && c === 7) return '777'
  if (a === b && b === c)            return a === 3 ? 'skulls' : 'triple'
  if (a === c)                       return 'lr_match'
  if (a === b || b === c)            return 'adjacent'
  if (a === 1 && b === 2 && c === 3) return 'sequential'
  return 'miss'
}

export function SlotMachine({ children }: { children?: ReactNode }) {
  const [display,   setDisplay]   = useState<Triplet>([1, 1, 1])
  const [spinning,  setSpinning]  = useState<[boolean,boolean,boolean]>([false,false,false])
  const [bouncing,  setBouncing]  = useState<[boolean,boolean,boolean]>([false,false,false])
  const [glowing,   setGlowing]   = useState(false)
  const [slotStock, setSlotStock] = useState(0)
  const [credits,   setCredits]   = useState(0)
  const [spinMode,  setSpinMode]  = useState<'auto' | 'manual'>('auto')
  const [canStop,   setCanStop]   = useState<[boolean,boolean,boolean]>([false,false,false])

  const busyRef         = useRef(false)
  const stockRef        = useRef(0)
  const creditsRef      = useRef(0)
  const spinRef         = useRef<() => void>(() => {})
  const ivRef           = useRef<(ReturnType<typeof setInterval> | null)[]>([null, null, null])
  const timerRefs       = useRef<ReturnType<typeof setTimeout>[]>([])
  const safetyTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalsRef       = useRef<Triplet>([1, 1, 1])
  const displayRef      = useRef<Triplet>([1, 1, 1])
  const spinModeRef     = useRef<'auto' | 'manual'>('auto')
  const canStopRef      = useRef<[boolean,boolean,boolean]>([false,false,false])
  const reelStoppedRef  = useRef<[boolean,boolean,boolean]>([false,false,false])
  const stoppedCountRef = useRef(0)

  const clearAllTimers = useCallback(() => {
    ivRef.current.forEach((iv, i) => {
      if (iv !== null) { clearInterval(iv); ivRef.current[i] = null }
    })
    timerRefs.current.forEach(t => clearTimeout(t))
    timerRefs.current = []
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
  }, [])

  const addTimer = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timerRefs.current = timerRefs.current.filter(x => x !== t)
      fn()
    }, ms)
    timerRefs.current.push(t)
    return t
  }, [])

  const forceReset = useCallback(() => {
    clearAllTimers()
    busyRef.current = false
    stoppedCountRef.current = 0
    reelStoppedRef.current = [false, false, false]
    canStopRef.current = [false, false, false]
    setCanStop([false, false, false])
    setSpinning([false, false, false])
    setBouncing([false, false, false])
    setDisplay([...displayRef.current] as Triplet)
  }, [clearAllTimers])

  // リール停止（重複ガード付き、全停止で結果評価）
  const stopReel = useCallback((idx: number) => {
    if (reelStoppedRef.current[idx]) return
    if (ivRef.current[idx] !== null) {
      clearInterval(ivRef.current[idx]!)
      ivRef.current[idx] = null
    }
    const f = finalsRef.current[idx]
    displayRef.current[idx] = f
    setDisplay([...displayRef.current] as Triplet)
    setSpinning(s => { const n = [...s] as typeof s; n[idx] = false; return n })
    setBouncing(s => { const n = [...s] as typeof s; n[idx] = true;  return n })
    addTimer(() => setBouncing(s => { const n = [...s] as typeof s; n[idx] = false; return n }), 400)

    reelStoppedRef.current[idx] = true
    stoppedCountRef.current++
    if (stoppedCountRef.current === 3) {
      addTimer(() => {
        const result = evaluate(finalsRef.current)
        if (['777', 'triple', 'skulls'].includes(result)) setGlowing(true)
        window.playBonusVideo?.(result)
      }, 500)
    }
  }, [addTimer])

  const processAfterEffect = useCallback(() => {
    busyRef.current = false
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
    if (stockRef.current > 0) {
      stockRef.current--
      setSlotStock(stockRef.current)
      addTimer(() => spinRef.current(), 300)
    }
  }, [addTimer])

  useEffect(() => {
    window.onSlotEffectApplied = processAfterEffect
    return () => { window.onSlotEffectApplied = undefined }
  }, [processAfterEffect])

  const executeSpin = useCallback(() => {
    if (busyRef.current) return
    busyRef.current = true
    setGlowing(false)

    if (safetyTimerRef.current !== null) clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(() => {
      if (busyRef.current) { forceReset() }
    }, 30000)

    // 停止状態をリセット
    stoppedCountRef.current = 0
    reelStoppedRef.current = [false, false, false]
    canStopRef.current = [false, false, false]
    setCanStop([false, false, false])

    finalsRef.current = [rand(), rand(), rand()]
    setSpinning([true, true, true])

    ;[0, 1, 2].forEach(i => {
      if (ivRef.current[i] !== null) { clearInterval(ivRef.current[i]!); ivRef.current[i] = null }
      ivRef.current[i] = setInterval(() => {
        displayRef.current[i] = (displayRef.current[i] % SYMBOLS) + 1
        setDisplay([...displayRef.current] as Triplet)
      }, 80)
    })

    // 各リールの最短停止可能時間（マニュアルモード用・オートでも共通）
    addTimer(() => { canStopRef.current[0] = true; setCanStop(s => { const n = [...s] as typeof s; n[0] = true; return n }) }, 400)
    addTimer(() => { canStopRef.current[1] = true; setCanStop(s => { const n = [...s] as typeof s; n[1] = true; return n }) }, 800)
    addTimer(() => { canStopRef.current[2] = true; setCanStop(s => { const n = [...s] as typeof s; n[2] = true; return n }) }, 1200)

    if (spinModeRef.current === 'auto') {
      addTimer(() => stopReel(0), 600)
      addTimer(() => stopReel(1), 1200)
      addTimer(() => stopReel(2), 1800)
    }
  }, [addTimer, stopReel, forceReset])

  useEffect(() => { spinRef.current = executeSpin }, [executeSpin])

  const triggerSpin = useCallback(() => {
    if (busyRef.current) {
      if (stockRef.current < STOCK_MAX) {
        stockRef.current++
        setSlotStock(stockRef.current)
      }
    } else {
      executeSpin()
    }
  }, [executeSpin])

  const gainCoin = useCallback(() => {
    creditsRef.current++
    if (creditsRef.current >= CREDIT_MAX) {
      creditsRef.current = 0
      triggerSpin()
    }
    setCredits(creditsRef.current)
  }, [triggerSpin])

  useEffect(() => {
    window.onEnemyKilled = gainCoin
    return () => { window.onEnemyKilled = undefined }
  }, [gainCoin])

  useEffect(() => {
    const reset = () => {
      clearAllTimers()
      busyRef.current    = false
      stockRef.current   = 0
      creditsRef.current = 0
      stoppedCountRef.current = 0
      reelStoppedRef.current  = [false, false, false]
      canStopRef.current      = [false, false, false]
      setSlotStock(0)
      setCredits(0)
      setCanStop([false, false, false])
      setSpinning([false, false, false])
      setBouncing([false, false, false])
      setGlowing(false)
    }
    window.addEventListener('game-scene-changed', reset)
    return () => window.removeEventListener('game-scene-changed', reset)
  }, [clearAllTimers])

  useEffect(() => {
    return () => {
      clearAllTimers()
      busyRef.current  = false
      stockRef.current = 0
    }
  }, [clearAllTimers])

  const toggleMode = useCallback(() => {
    setSpinMode(prev => {
      const next = prev === 'auto' ? 'manual' : 'auto'
      spinModeRef.current = next
      return next
    })
  }, [])

  const handleManualStop = useCallback((idx: number) => {
    if (spinModeRef.current !== 'manual') return
    if (!canStopRef.current[idx]) return
    stopReel(idx)
  }, [stopReel])

  return (
    <div className={`slot-cabinet${glowing ? ' slot-glowing' : ''}${spinMode === 'manual' ? ' sc-mode-manual' : ''}`}>

      {/* AUTO / MANUAL 切替 */}
      <button className="sc-mode-btn" onClick={toggleMode}>
        {spinMode === 'auto' ? 'AUTO' : 'MANUAL'}
      </button>

      {/* リール3本 */}
      <div className="sc-reels">
        {([0, 1, 2] as const).map(i => (
          <div
            key={i}
            className={[
              'slot-reel',
              spinning[i] ? 'reel-spinning' : '',
              bouncing[i] ? 'reel-bouncing' : '',
              glowing      ? 'reel-glow'     : '',
            ].filter(Boolean).join(' ')}
          >
            <img
              src={`/assets/slot/slot${display[i]}.png`}
              alt={`slot${display[i]}`}
              className="reel-img"
            />
          </div>
        ))}
      </div>

      {/* ストップボタン row（リール直下） */}
      <div className="sc-stop-row">
        {([0, 1, 2] as const).map(i => (
          <button
            key={i}
            className={`sc-stop-btn${canStop[i] && spinning[i] && spinMode === 'manual' ? ' sc-stop-active' : ''}`}
            onClick={() => handleManualStop(i)}
          >
            STOP
          </button>
        ))}
      </div>

      {/* LCD（BonusVideo） */}
      <div className="sc-lcd">
        {children}
      </div>

      {/* ストックバッジ（クレジット表示の上） */}
      {slotStock > 0 && (
        <div className="sc-stock">×{slotStock}</div>
      )}

      {/* クレジットメーター（筐体右下） */}
      <div className="sc-credit">
        <div className="scm-bar">
          {Array.from({ length: CREDIT_MAX }).map((_, i) => (
            <div key={i} className={`scm-seg ${i < credits ? 'scm-filled' : ''}`} />
          ))}
        </div>
        <p className="scm-count">{credits}/{CREDIT_MAX}</p>
      </div>
    </div>
  )
}
