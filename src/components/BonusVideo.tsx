import { useCallback, useEffect, useRef, useState } from 'react'

const RESULT_SRCS: Record<string, string> = {
  '777':        '/assets/slot/777.mp4',
  'triple':     '/assets/slot/triple.mp4',
  'skulls':     '/assets/slot/skulls.mp4',
  'lr_match':   '/assets/slot/lr.mp4',
  'adjacent':   '/assets/slot/adjacent.mp4',
  'sequential': '/assets/slot/sequential.mp4',
  'miss':       '/assets/slot/miss.mp4',
}

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
    if (currentResultRef.current) {
      window.applySlotEffect?.(currentResultRef.current)
      currentResultRef.current = null
    }
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
  }, [startBonus])

  return (
    <div className="bonus-video-area">
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
          className={`bv-video ${mode === result ? 'bv-active' : ''}`}
        />
      ))}
    </div>
  )
}
