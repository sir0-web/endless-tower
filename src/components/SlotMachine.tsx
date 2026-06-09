import { useCallback, useEffect, useRef, useState } from 'react'

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

export function SlotMachine() {
  const [display,   setDisplay]   = useState<Triplet>([1, 1, 1])
  const [spinning,  setSpinning]  = useState<[boolean,boolean,boolean]>([false,false,false])
  const [bouncing,  setBouncing]  = useState<[boolean,boolean,boolean]>([false,false,false])
  const [glowing,   setGlowing]   = useState(false)
  const [slotStock, setSlotStock] = useState(0)
  const [credits,   setCredits]   = useState(0)   // モンスターコイン → クレジットメーター（10で1回転）

  const busyRef         = useRef(false)
  const stockRef        = useRef(0)
  const creditsRef      = useRef(0)
  const spinRef         = useRef<() => void>(() => {})
  const ivRef           = useRef<(ReturnType<typeof setInterval> | null)[]>([null, null, null])
  const timerRefs       = useRef<ReturnType<typeof setTimeout>[]>([])
  const safetyTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalsRef       = useRef<Triplet>([1, 1, 1])
  const displayRef      = useRef<Triplet>([1, 1, 1])

  // ── 全タイマーを安全にクリア ──
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

  // タイマーを登録してリストで管理
  const addTimer = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timerRefs.current = timerRefs.current.filter(x => x !== t)
      fn()
    }, ms)
    timerRefs.current.push(t)
    return t
  }, [])

  // 異常検知：強制リセット
  const forceReset = useCallback(() => {
    clearAllTimers()
    busyRef.current = false
    setSpinning([false, false, false])
    setBouncing([false, false, false])
    setDisplay([...displayRef.current] as Triplet)
  }, [clearAllTimers])

  const stopReel = useCallback((idx: number) => {
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
  }, [addTimer])

  // 動画＋効果適用が完全に終わった後に BonusVideo から呼ばれる
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
    // 2重起動ガード
    if (busyRef.current) return
    busyRef.current = true
    setGlowing(false)

    // 安全タイマー：動画再生時間を考慮して長めに設定
    if (safetyTimerRef.current !== null) clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(() => {
      if (busyRef.current) { forceReset() }
    }, 30000)

    finalsRef.current = [rand(), rand(), rand()]
    setSpinning([true, true, true])

    // リール回転開始（既存インターバルをクリアしてから）
    ;[0, 1, 2].forEach(i => {
      if (ivRef.current[i] !== null) { clearInterval(ivRef.current[i]!); ivRef.current[i] = null }
      ivRef.current[i] = setInterval(() => {
        displayRef.current[i] = (displayRef.current[i] % SYMBOLS) + 1
        setDisplay([...displayRef.current] as Triplet)
      }, 80)
    })

    // リールを順番に停止
    addTimer(() => stopReel(0), 600)
    addTimer(() => stopReel(1), 1200)
    addTimer(() => {
      stopReel(2)
      addTimer(() => {
        const result = evaluate(finalsRef.current)
        if (['777', 'triple', 'skulls'].includes(result)) setGlowing(true)
        // busyRef は動画終了→効果適用後に BonusVideo → onSlotEffectApplied でリセットされる
        window.playBonusVideo?.(result)
      }, 500)
    }, 1800)
  }, [addTimer, stopReel, forceReset])

  // spinRef を常に最新の executeSpin に同期（自己参照のため）
  useEffect(() => { spinRef.current = executeSpin }, [executeSpin])

  // スロットを1回回す（回転中ならストックに積む、上限STOCK_MAX）
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

  // 外部トリガー：敵撃破時に呼ばれる（モンスターコイン1個獲得→クレジットメーター+1）
  // メーターが3たまったらリセットしてスロットを1回回す（ストック上限10）
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

  // ゲームシーン切り替え時に回転状態・ストックをリセット
  useEffect(() => {
    const reset = () => {
      clearAllTimers()
      busyRef.current  = false
      stockRef.current = 0
      creditsRef.current = 0
      setSlotStock(0)
      setCredits(0)
      setSpinning([false, false, false])
      setBouncing([false, false, false])
      setGlowing(false)
    }
    window.addEventListener('game-scene-changed', reset)
    return () => window.removeEventListener('game-scene-changed', reset)
  }, [clearAllTimers])

  // アンマウント時に全タイマーをクリア
  useEffect(() => {
    return () => {
      clearAllTimers()
      busyRef.current = false
      stockRef.current = 0
    }
  }, [clearAllTimers])

  return (
    <div className={`slot-machine ${glowing ? 'slot-glowing' : ''}`}>
      <p className="slot-label">女神の加護</p>
      <div className="slot-row">
        <div className="slot-reels">
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
        <div className="slot-credit-meter">
          <p className="scm-label">CREDIT</p>
          <div className="scm-bar">
            {Array.from({ length: CREDIT_MAX }).map((_, i) => (
              <div key={i} className={`scm-seg ${i < credits ? 'scm-filled' : ''}`} />
            ))}
          </div>
          <p className="scm-count">{credits}/{CREDIT_MAX}</p>
        </div>
      </div>
      {slotStock > 0 && (
        <div className="slot-stock-badge">×{slotStock}</div>
      )}
    </div>
  )
}
