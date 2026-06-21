import { useCallback, useEffect, useRef, useState } from 'react'

const RESULT_SRCS: Record<string, string> = {
  'jackpot':    '/assets/slot/jack.mp4',
  '777':        '/assets/slot/777.mp4',
  'triple':     '/assets/slot/triple.mp4',
  'skulls':     '/assets/slot/skulls.mp4',
  'lr_match':   '/assets/slot/lr.mp4',
  'adjacent':   '/assets/slot/adjacent.mp4',
  'sequential': '/assets/slot/sequential.mp4',
  'miss':       '/assets/slot/miss.mp4',
  'kakuhen':      '/assets/slot/swordlady.mp4',
  'kakuhen_miss': '/assets/slot/magicianlady.mp4',
}

// アルカナチャンス（2パターン）。動画終了後に専用ルーレットへ分岐する
const ARCANA_RESULTS = new Set(['kakuhen', 'kakuhen_miss'])
// 画面中央に大きく＋周囲を暗転して魅せる演出（アルカナチャンス＋ジャックポット）
const CENTERED_RESULTS = new Set(['kakuhen', 'kakuhen_miss', 'jackpot'])

export function BonusVideo() {
  const idleRef         = useRef<HTMLVideoElement>(null)
  const resultVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const [mode, setMode] = useState('idle')

  const currentResultRef = useRef<string | null>(null)
  const queueRef         = useRef<string[]>([])
  const playingRef       = useRef(false)

  useEffect(() => {
    void idleRef.current?.play().catch(() => {})
  }, [])

  const startBonus = useCallback((result: string) => {
    const idle        = idleRef.current
    const resultVideo = resultVideoRefs.current[result]
    if (!idle || !resultVideo) return

    idle.pause()
    currentResultRef.current = result
    resultVideo.currentTime  = 0
    setMode(result)
    void resultVideo.play().catch(() => {})
  }, [])

  useEffect(() => {
    window.playBonusVideo = (result: string) => {
      if (playingRef.current) {
        queueRef.current.push(result)
        return
      }
      playingRef.current = true
      startBonus(result)
    }
    return () => { window.playBonusVideo = undefined }
  }, [startBonus])

  useEffect(() => {
    const reset = () => {
      queueRef.current         = []
      currentResultRef.current = null
      playingRef.current       = false

      Object.values(resultVideoRefs.current).forEach(v => {
        if (v) { v.pause(); v.currentTime = 0 }
      })
      const idle = idleRef.current
      if (idle) { idle.currentTime = 0; void idle.play().catch(() => {}) }
      setMode('idle')
      window.onSlotEffectApplied?.()
    }
    window.addEventListener('game-scene-changed', reset)
    return () => window.removeEventListener('game-scene-changed', reset)
  }, [])

  const handleVideoEnded = useCallback(() => {
    const ended = currentResultRef.current
    currentResultRef.current = null

    // 演出後の後処理（次キュー消化／アイドル復帰／スロット再開）
    const finish = (skipEffect: boolean) => {
      if (ended && !skipEffect) window.applySlotEffect?.(ended)
      const next = queueRef.current.shift()
      if (next) {
        startBonus(next)
      } else {
        playingRef.current = false
        const idle = idleRef.current
        if (idle) {
          idle.currentTime = 0
          setMode('idle')
          void idle.play().catch(() => {})
        }
        window.onSlotEffectApplied?.()
      }
    }

    // アルカナチャンスは動画終了後、+30固定ではなく専用ルーレットへ。
    // ポイント付与はルーレット側（applyArcanaResult）が行うので applySlotEffect はスキップ。
    if (ended && ARCANA_RESULTS.has(ended) && window.showArcanaRoulette) {
      setMode('idle') // 背後の動画/暗転を消す（ルーレットが全画面で覆う）
      window.showArcanaRoulette(() => finish(true))
      return
    }

    finish(false)
  }, [startBonus])

  const isCentered = CENTERED_RESULTS.has(mode)

  return (
    <>
      {/* アルカナチャンス／ジャックポット中は周囲を暗転して中央の動画に注目させる */}
      {isCentered && <div className="bv-arcana-backdrop" />}

      <video
        ref={idleRef}
        src="/assets/slot/idle.mp4"
        muted playsInline loop autoPlay
        className={`bv-video ${mode === 'idle' ? 'bv-active' : ''}`}
      />
      {Object.entries(RESULT_SRCS).map(([result, src]) => (
        <video
          key={result}
          ref={el => { resultVideoRefs.current[result] = el }}
          src={src}
          muted
          playsInline
          onEnded={handleVideoEnded}
          className={`bv-video ${mode === result ? 'bv-active' : ''}${ARCANA_RESULTS.has(result) ? ' bv-arcana' : ''}${result === 'jackpot' ? ' bv-jackpot' : ''}`}
        />
      ))}
    </>
  )
}
