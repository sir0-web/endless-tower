import { useEffect, useRef, useState } from 'react'
import { submitArcadeScore, fetchArcadeRanking, type ArcadeScoreEntry } from '../game/arcadeScores'

// ── げーせん「弾幕よけ」：指/マウスで筐体画面をなぞって弾を避け続ける超カジュアルミニゲーム ──
// 難易度は経過時間で自動上昇（弾の発生間隔short化・速度up）。生存時間(ms)がスコア。

const CANVAS_W = 320
const CANVAS_H = 440
const PLAYER_R = 9
const BULLET_R = 6

interface Bullet { x: number; y: number; vx: number; vy: number }

type Phase = 'idle' | 'playing' | 'result'

function fmtTime(ms: number): string {
  return (ms / 1000).toFixed(2) + '秒'
}

export function ArcadeModal() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [resultMs, setResultMs] = useState(0)
  const [ranking, setRanking] = useState<ArcadeScoreEntry[] | null>(null)
  const [loadingRank, setLoadingRank] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const playerRef = useRef({ x: CANVAS_W / 2, y: CANVAS_H * 0.75 })
  const bulletsRef = useRef<Bullet[]>([])
  const startTimeRef = useRef(0)
  const lastSpawnRef = useRef(0)
  const overRef = useRef(false)

  const loadRanking = () => {
    setLoadingRank(true)
    void fetchArcadeRanking(10).then(list => { setRanking(list); setLoadingRank(false) })
  }

  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      setPhase('idle')
      loadRanking()
    }
    const onSceneChanged = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      setOpen(false)
      setPhase('idle')
    }
    window.addEventListener('arcade-open', onOpen)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('arcade-open', onOpen)
      window.removeEventListener('game-scene-changed', onSceneChanged)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const close = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setOpen(false)
    setPhase('idle')
    window.closeArcade?.()
  }

  const endGame = () => {
    if (overRef.current) return
    overRef.current = true
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    const elapsed = performance.now() - startTimeRef.current
    setResultMs(elapsed)
    setPhase('result')
    void submitArcadeScore(elapsed).then(loadRanking)
  }

  const startGame = () => {
    playerRef.current = { x: CANVAS_W / 2, y: CANVAS_H * 0.75 }
    bulletsRef.current = []
    overRef.current = false
    startTimeRef.current = performance.now()
    lastSpawnRef.current = startTimeRef.current
    setPhase('playing')

    let lastFrame = performance.now()
    const loop = (now: number) => {
      if (overRef.current) return
      const dt = Math.min(48, now - lastFrame)
      lastFrame = now
      const elapsed = now - startTimeRef.current

      // 難易度：経過時間に応じて発生間隔を短く・弾速を速くする（下限あり）
      const spawnInterval = Math.max(180, 650 - elapsed * 0.03)
      const speed = Math.min(0.34, 0.14 + elapsed * 0.00003)

      if (now - lastSpawnRef.current >= spawnInterval) {
        lastSpawnRef.current = now
        const edge = Math.floor(Math.random() * 4)
        let sx = 0, sy = 0
        if (edge === 0)      { sx = Math.random() * CANVAS_W; sy = -10 }
        else if (edge === 1) { sx = Math.random() * CANVAS_W; sy = CANVAS_H + 10 }
        else if (edge === 2) { sx = -10; sy = Math.random() * CANVAS_H }
        else                 { sx = CANVAS_W + 10; sy = Math.random() * CANVAS_H }
        // プレイヤーへ向けて、狙いすぎないよう角度にランダムなブレを持たせる
        const p = playerRef.current
        const baseAngle = Math.atan2(p.y - sy, p.x - sx)
        const angle = baseAngle + (Math.random() - 0.5) * 0.9
        bulletsRef.current.push({ x: sx, y: sy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed })
      }

      const margin = 30
      bulletsRef.current = bulletsRef.current.filter(b => {
        b.x += b.vx * dt
        b.y += b.vy * dt
        return b.x > -margin && b.x < CANVAS_W + margin && b.y > -margin && b.y < CANVAS_H + margin
      })

      const p = playerRef.current
      for (const b of bulletsRef.current) {
        const dx = b.x - p.x, dy = b.y - p.y
        if (dx * dx + dy * dy < (PLAYER_R + BULLET_R) * (PLAYER_R + BULLET_R)) {
          endGame()
          return
        }
      }

      draw(elapsed)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const draw = (elapsedMs: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = '#0b0b1e'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // 弾
    for (const b of bulletsRef.current) {
      ctx.beginPath()
      ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2)
      ctx.fillStyle = '#ff5566'
      ctx.shadowColor = '#ff5566'
      ctx.shadowBlur = 8
      ctx.fill()
    }
    ctx.shadowBlur = 0

    // プレイヤー
    const p = playerRef.current
    ctx.beginPath()
    ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2)
    ctx.fillStyle = '#66ccff'
    ctx.shadowColor = '#66ccff'
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.shadowBlur = 0

    // タイマー
    ctx.fillStyle = '#ffe08a'
    ctx.font = 'bold 18px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(fmtTime(elapsedMs), CANVAS_W / 2, 26)
  }

  // 指/マウスでキャンバスをなぞった位置へプレイヤーを追従させる
  const movePlayerFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    playerRef.current = {
      x: Math.max(PLAYER_R, Math.min(CANVAS_W - PLAYER_R, x)),
      y: Math.max(PLAYER_R, Math.min(CANVAS_H - PLAYER_R, y)),
    }
  }

  if (!open) return null

  const bestMine = ranking?.[0] ?? null

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        <p className="facility-title">🕹️げーせん🕹️</p>

        {phase === 'idle' && (
          <>
            <p className="facility-desc">
              画面をなぞって弾を避け続けろ！<br />生き残った時間がスコアになる。
            </p>
            {bestMine && <p className="facility-sub">現在の1位：{bestMine.player_name}（{fmtTime(bestMine.time_ms)}）</p>}
            <div className="arcade-rank-list">
              {loadingRank && <p className="facility-empty">ランキング読み込み中…</p>}
              {!loadingRank && ranking?.length === 0 && <p className="facility-empty">まだ記録がありません</p>}
              {!loadingRank && ranking?.map((r, i) => (
                <div key={r.id} className="arcade-rank-row">
                  <span>{i + 1}. {r.player_name}</span>
                  <span>{fmtTime(r.time_ms)}</span>
                </div>
              ))}
            </div>
            <div className="facility-btns">
              <button className="facility-go-btn" onClick={startGame}>スタート</button>
              <button className="facility-close-btn" onClick={close}>とじる</button>
            </div>
          </>
        )}

        {phase === 'playing' && (
          <>
            <div className="arcade-canvas-wrap">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="arcade-canvas"
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); movePlayerFromEvent(e) }}
                onPointerMove={e => { if (e.buttons > 0) movePlayerFromEvent(e) }}
              />
            </div>
            <div className="facility-btns">
              <button className="facility-close-btn" onClick={close}>やめる</button>
            </div>
          </>
        )}

        {phase === 'result' && (
          <div className="facility-result">
            <p className="facility-result-text fr-success">{fmtTime(resultMs)}</p>
            <p className="facility-result-sub">生存！ 弾に当たって終了。</p>
            <div className="arcade-rank-list">
              {ranking?.map((r, i) => (
                <div key={r.id} className="arcade-rank-row">
                  <span>{i + 1}. {r.player_name}</span>
                  <span>{fmtTime(r.time_ms)}</span>
                </div>
              ))}
            </div>
            <div className="facility-btns">
              <button className="facility-go-btn" onClick={startGame}>もう一度</button>
              <button className="facility-close-btn" onClick={close}>とじる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
