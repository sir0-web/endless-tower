import { useEffect, useMemo, useRef, useState } from 'react'

type SlotResult = '777' | 'triple' | 'skulls' | 'lr_match' | 'adjacent' | 'sequential' | 'miss' | 'kakuhen' | 'kakuhen_start'

interface Config {
  text: string
  sub: string
  color: string
  fontSize: string
  animClass: string
  holdMs: number
  overlay: boolean
  flash: boolean
  sparkles: number
}

const CONFIGS: Record<SlotResult, Config> = {
  '777': {
    text: '👊阿修羅覇王拳👊',
    sub: 'Lv+10 ＋ HP/STA上限+10% ＋ SP+50 ＋ 全敵消滅！！',
    color: '#ffdd00',
    fontSize: 'clamp(44px, 9vw, 76px)',
    animClass: 'sa-anim-zoom',
    holdMs: 3000,
    overlay: true,
    flash: false,
    sparkles: 32,
  },
  triple: {
    text: '✨女神の加護✨',
    sub: 'HP&STA完全回復 ＋ ランダム装備×3！',
    color: '#00ff88',
    fontSize: 'clamp(36px, 7vw, 60px)',
    animClass: 'sa-anim-slide',
    holdMs: 2500,
    overlay: false,
    flash: false,
    sparkles: 20,
  },
  skulls: {
    text: '💀ゴスリンの呪い💀',
    sub: '3・3・3 ── HP が半分になった…',
    color: '#ff3333',
    fontSize: 'clamp(36px, 7vw, 60px)',
    animClass: 'sa-anim-drop',
    holdMs: 2500,
    overlay: false,
    flash: true,
    sparkles: 0,
  },
  lr_match: {
    text: '💚ヒール💚',
    sub: 'HP を 50% 回復！',
    color: '#22cc88',
    fontSize: 'clamp(28px, 5vw, 48px)',
    animClass: 'sa-anim-fade',
    holdMs: 2000,
    overlay: false,
    flash: false,
    sparkles: 0,
  },
  adjacent: {
    text: '⚡マグニフィカート⚡',
    sub: 'スタミナを 50% 回復！',
    color: '#22aaff',
    fontSize: 'clamp(28px, 5vw, 48px)',
    animClass: 'sa-anim-fade',
    holdMs: 2000,
    overlay: false,
    flash: false,
    sparkles: 0,
  },
  sequential: {
    text: '🎁運営からのプレゼント🎁',
    sub: 'ランダム装備品をバッグに追加！',
    color: '#ffcc00',
    fontSize: 'clamp(28px, 5vw, 48px)',
    animClass: 'sa-anim-fade',
    holdMs: 2000,
    overlay: false,
    flash: false,
    sparkles: 0,
  },
  miss: {
    text: '😭何も揃わなかった😭',
    sub: 'ハズレ…',
    color: '#888899',
    fontSize: 'clamp(22px, 4.5vw, 38px)',
    animClass: 'sa-anim-fade',
    holdMs: 1500,
    overlay: false,
    flash: false,
    sparkles: 0,
  },
  kakuhen_start: {
    text: '🌌アルカナチャンス！🌌',
    sub: '',
    color: '#ff66ff',
    fontSize: 'clamp(40px, 8vw, 72px)',
    animClass: 'sa-anim-zoom',
    holdMs: 3000,
    overlay: true,
    flash: false,
    sparkles: 32,
  },
  kakuhen: {
    text: '✨ボーナス獲得✨',
    sub: 'ステータスポイント+30獲得！',
    color: '#ff66ff',
    fontSize: 'clamp(36px, 7vw, 60px)',
    animClass: 'sa-anim-slide',
    holdMs: 2500,
    overlay: false,
    flash: false,
    sparkles: 20,
  },
}

interface Sparkle {
  id: number
  tx: number
  ty: number
  size: number
  delay: number
  dur: number
}

function genSparkles(count: number): Sparkle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * Math.PI * 2
    const dist  = 90 + Math.random() * 230
    return {
      id: i,
      tx: Math.cos(angle) * dist,
      ty: Math.sin(angle) * dist,
      size: 5 + Math.random() * 9,
      delay: Math.random() * 0.28,
      dur: 0.4 + Math.random() * 0.55,
    }
  })
}

export function SlotAnnouncement() {
  const [active, setActive] = useState<{ result: SlotResult; seq: number; subOverride?: string } | null>(null)
  const [hiding, setHiding] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearAll = () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }
  const addTimer = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms); timersRef.current.push(t)
  }

  useEffect(() => {
    window.showSlotAnnouncement = (result: string, sub?: string) => {
      if (!(result in CONFIGS)) return
      const typedResult = result as SlotResult
      const cfg = CONFIGS[typedResult]

      // シンプルな演出（overlay/flash/sparklesなし）→ EventMsgBar へ（PC・スマホ共通）
      if (!cfg.overlay && !cfg.flash && cfg.sparkles === 0) {
        const subText = sub ?? cfg.sub
        const msg = subText ? `${cfg.text}\n${subText}` : cfg.text
        window.showEventMessage?.(msg, cfg.color)
        return
      }

      clearAll()
      setHiding(false)
      setActive({ result: typedResult, seq: Date.now(), subOverride: sub })
      const holdMs = cfg.holdMs
      addTimer(() => setHiding(true), holdMs)
      addTimer(() => { setActive(null); setHiding(false) }, holdMs + 500)
    }
    return () => { window.showSlotAnnouncement = undefined; clearAll() }
  }, [])

  const sparkles = useMemo(
    () => active ? genSparkles(CONFIGS[active.result].sparkles) : [],
    [active?.seq] // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!active) return null
  const cfg = CONFIGS[active.result]

  return (
    <div className={`sa-root${hiding ? ' sa-hiding' : ''}`}>
      {cfg.overlay && <div className="sa-overlay" />}
      {cfg.flash   && <div className="sa-flash" key={active.seq} />}

      {sparkles.length > 0 && (
        <div className="sa-sparkle-origin">
          {sparkles.map(s => (
            <div
              key={s.id}
              className="sa-sparkle"
              style={{
                width:  s.size,
                height: s.size,
                backgroundColor: cfg.color,
                '--sa-tx':    `${s.tx}px`,
                '--sa-ty':    `${s.ty}px`,
                '--sa-dur':   `${s.dur}s`,
                '--sa-delay': `${s.delay}s`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      <div className="sa-body">
        <p
          key={active.seq}
          className={`sa-text ${cfg.animClass}`}
          style={{ color: cfg.color, fontSize: cfg.fontSize }}
        >
          {cfg.text}
        </p>
        {(active.subOverride ?? cfg.sub) && (
          <p
            key={active.seq + 1}
            className="sa-sub"
            style={{ color: cfg.color }}
          >
            {active.subOverride ?? cfg.sub}
          </p>
        )}
      </div>
    </div>
  )
}
