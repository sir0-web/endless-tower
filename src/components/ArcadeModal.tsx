import { useEffect, useRef, useState } from 'react'
import { submitArcadeScore, fetchArcadeRanking, type ArcadeScoreEntry, type ArcadeGameId } from '../game/arcadeScores'
import { playAttack, playDamage } from '../game/sound'

// ── げーせん：超カジュアルミニゲーム集 ──
// 「ゲーム選択 → プレイ → 結果」の3フェーズ共通シェルの中に、各ミニゲームを差し込む構成。
// 新しいミニゲームを増やすときは GAMES に1行足し、<GameId>Game コンポーネントを追加するだけでよい。

interface GameDef {
  id: ArcadeGameId
  name: string
  icon: string
  desc: string
  lowerIsBetter: boolean   // true: 値が小さいほど上位（反応速度など）
  confirmText?: string     // 指定時、プレイ開始前に「はい」だけの確認画面を挟む
}

const GAMES: GameDef[] = [
  { id: 'dodge', name: '避けろ！ぽり男あたっく！', icon: '💥', desc: '無数のぽり男が主人公めがけて襲ってくる！なぞって避け続けろ！生存時間を競う', lowerIsBetter: false },
  { id: 'tap',   name: '納品援助早いマン', icon: '⚡', desc: '合図が出たら即タップ！平均反応速度を競う',     lowerIsBetter: true, confirmText: '今日も高速納品援助を行いますか？' },
  { id: 'mole',  name: '９山高速狩り',   icon: '🔨', desc: '制限時間内にモグラを叩きまくれ！撃破数を競う', lowerIsBetter: false },
]

function fmtScore(game: ArcadeGameId, value: number): string {
  if (game === 'dodge') return (value / 1000).toFixed(2) + '秒'
  if (game === 'tap')   return Math.round(value) + 'ms'
  return Math.round(value) + '匹'
}

type Phase = 'select' | 'confirm' | 'playing' | 'result'

export function ArcadeModal() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('select')
  const [gameId, setGameId] = useState<ArcadeGameId | null>(null)
  const [resultValue, setResultValue] = useState(0)
  const [ranking, setRanking] = useState<ArcadeScoreEntry[] | null>(null)
  const [loadingRank, setLoadingRank] = useState(false)
  const [previews, setPreviews] = useState<Partial<Record<ArcadeGameId, ArcadeScoreEntry | null>>>({})

  const loadRanking = (game: ArcadeGameId) => {
    const def = GAMES.find(g => g.id === game)!
    setLoadingRank(true)
    void fetchArcadeRanking(game, def.lowerIsBetter, 10).then(list => { setRanking(list); setLoadingRank(false) })
  }

  const loadPreviews = () => {
    for (const def of GAMES) {
      void fetchArcadeRanking(def.id, def.lowerIsBetter, 1).then(list => {
        setPreviews(prev => ({ ...prev, [def.id]: list[0] ?? null }))
      })
    }
  }

  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      setPhase('select')
      setGameId(null)
      loadPreviews()
    }
    const onSceneChanged = () => {
      setOpen(false)
      setPhase('select')
      setGameId(null)
    }
    window.addEventListener('arcade-open', onOpen)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('arcade-open', onOpen)
      window.removeEventListener('game-scene-changed', onSceneChanged)
    }
  }, [])

  const close = () => {
    setOpen(false)
    setPhase('select')
    setGameId(null)
    window.closeArcade?.()
  }

  const backToSelect = () => {
    setPhase('select')
    setGameId(null)
    loadPreviews()
  }

  const selectGame = (id: ArcadeGameId) => {
    setGameId(id)
    const def = GAMES.find(g => g.id === id)!
    setPhase(def.confirmText ? 'confirm' : 'playing')
  }

  const handleEnd = (value: number) => {
    if (!gameId) return
    setResultValue(value)
    setPhase('result')
    void submitArcadeScore(gameId, value).then(() => loadRanking(gameId))
  }

  const retry = () => { setPhase('playing') }

  if (!open) return null

  const def = gameId ? GAMES.find(g => g.id === gameId)! : null

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        <p className="facility-title">{phase === 'select' || !def ? '🕹️げーせん🕹️' : `${def.icon}${def.name}${def.icon}`}</p>

        {phase === 'select' && (
          <>
            <p className="facility-desc">遊びたいゲームを選んでね</p>
            <div className="facility-list arcade-game-list">
              {GAMES.map(g => {
                const p = previews[g.id]
                return (
                  <button key={g.id} className="facility-item" onClick={() => selectGame(g.id)}>
                    <span style={{ fontSize: 22 }}>{g.icon}</span>
                    <span style={{ flex: 1 }}>
                      <span className="fi-name">{g.name}</span>
                      <br />
                      <span className="facility-empty" style={{ fontSize: '0.8em', padding: 0 }}>{g.desc}</span>
                    </span>
                    {p && <span className="fi-chance">1位 {fmtScore(g.id, p.time_ms)}</span>}
                  </button>
                )
              })}
            </div>
            <div className="facility-btns">
              <button className="facility-close-btn" onClick={close}>とじる</button>
            </div>
          </>
        )}

        {phase === 'confirm' && def && (
          <>
            <p className="facility-desc">{def.confirmText}</p>
            <div className="facility-btns" style={{ flexDirection: 'column' }}>
              <button className="facility-go-btn" onClick={() => setPhase('playing')}>はい</button>
              <p className="facility-empty" style={{ textAlign: 'center', padding: 0 }}>はいをおすとゲームを開始します</p>
            </div>
          </>
        )}

        {phase === 'playing' && gameId === 'dodge' && <DodgeGame onEnd={handleEnd} onAbort={backToSelect} />}
        {phase === 'playing' && gameId === 'tap'   && <TapGame   onEnd={handleEnd} onAbort={backToSelect} />}
        {phase === 'playing' && gameId === 'mole'  && <MoleGame  onEnd={handleEnd} onAbort={backToSelect} />}

        {phase === 'result' && def && (
          <div className="facility-result">
            <p className="facility-result-text fr-success">{fmtScore(def.id, resultValue)}</p>
            <p className="facility-result-sub">{def.name}：結果が出ました！</p>
            <div className="arcade-rank-list">
              {loadingRank && <p className="facility-empty">ランキング読み込み中…</p>}
              {!loadingRank && ranking?.map((r, i) => (
                <div key={r.id} className="arcade-rank-row">
                  <span>{i + 1}. {r.player_name}</span>
                  <span>{fmtScore(def.id, r.time_ms)}</span>
                </div>
              ))}
            </div>
            <div className="facility-btns">
              <button className="facility-go-btn" onClick={retry}>もう一度</button>
              <button className="facility-close-btn" onClick={backToSelect}>ゲーム一覧</button>
              <button className="facility-close-btn" onClick={close}>とじる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface GameProps {
  onEnd: (value: number) => void
  onAbort: () => void
}

// ── ①だんまくよけ：canvasで弾を回避。生存時間(ms)を競う ──
const CANVAS_W = 320
const CANVAS_H = 440
const PLAYER_R = 9
const BULLET_R = 11
const POLI_OTOKO_SRC = '/assets/characters/enemies/pori.webp'   // ぽり男

interface Bullet { x: number; y: number; vx: number; vy: number }

function DodgeGame({ onEnd, onAbort }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const playerRef = useRef({ x: CANVAS_W / 2, y: CANVAS_H * 0.75 })
  const bulletsRef = useRef<Bullet[]>([])
  const startTimeRef = useRef(0)
  const lastSpawnRef = useRef(0)
  const overRef = useRef(false)
  const poliImgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    playerRef.current = { x: CANVAS_W / 2, y: CANVAS_H * 0.75 }
    bulletsRef.current = []
    overRef.current = false
    startTimeRef.current = performance.now()
    lastSpawnRef.current = startTimeRef.current

    const poliImg = new Image()
    poliImg.src = POLI_OTOKO_SRC
    poliImg.onload = () => { poliImgRef.current = poliImg }

    let lastFrame = performance.now()
    const draw = (elapsedMs: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = '#0b0b1e'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      const poli = poliImgRef.current
      for (const b of bulletsRef.current) {
        if (poli) {
          const d = BULLET_R * 2.4
          ctx.drawImage(poli, b.x - d / 2, b.y - d / 2, d, d)
        } else {
          ctx.beginPath()
          ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2)
          ctx.fillStyle = '#ff5566'
          ctx.shadowColor = '#ff5566'
          ctx.shadowBlur = 8
          ctx.fill()
        }
      }
      ctx.shadowBlur = 0
      const p = playerRef.current
      ctx.beginPath()
      ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2)
      ctx.fillStyle = '#66ccff'
      ctx.shadowColor = '#66ccff'
      ctx.shadowBlur = 10
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = '#ffe08a'
      ctx.font = 'bold 18px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText((elapsedMs / 1000).toFixed(2) + '秒', CANVAS_W / 2, 26)
    }

    const loop = (now: number) => {
      if (overRef.current) return
      const dt = Math.min(48, now - lastFrame)
      lastFrame = now
      const elapsed = now - startTimeRef.current

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
          overRef.current = true
          onEnd(performance.now() - startTimeRef.current)
          return
        }
      }

      draw(elapsed)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
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
        <button className="facility-close-btn" onClick={onAbort}>やめる</button>
      </div>
    </>
  )
}

// ── ②納品援助早いマン：5回の合図に反応し、平均反応時間(ms)を競う ──
const TAP_ROUNDS = 5
const TAP_IMG_WAIT = '/assets/town/touch/arcade_tap_wait.webp'
const TAP_IMG_GO   = '/assets/town/touch/arcade_tap_go.webp'
const TAP_IMG_OK   = '/assets/town/touch/arcade_tap_ok.webp'
const TAP_IMG_NG   = '/assets/town/touch/arcade_tap_ng.webp'

function TapGame({ onEnd, onAbort }: GameProps) {
  const [state, setState] = useState<'wait' | 'go' | 'early' | 'success'>('wait')
  const [round, setRound] = useState(1)
  const goAtRef = useRef(0)
  const timesRef = useRef<number[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleGo = () => {
    setState('wait')
    const delay = 800 + Math.random() * 2200
    timerRef.current = setTimeout(() => {
      goAtRef.current = performance.now()
      setState('go')
    }, delay)
  }

  useEffect(() => {
    scheduleGo()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  const onTap = () => {
    if (state === 'wait') {
      // フライング：タイマーを止めて「納品へ」ボタンが押されるまで静止する
      if (timerRef.current) clearTimeout(timerRef.current)
      setState('early')
      return
    }
    if (state === 'go') {
      const reaction = performance.now() - goAtRef.current
      timesRef.current.push(reaction)
      if (timerRef.current) clearTimeout(timerRef.current)
      // 画像をしっかり見せるため、「納品へ」ボタンが押されるまで静止する
      setState('success')
    }
  }

  // success/early状態で「納品へ」ボタンを押した時：次ラウンドへ進む（早押し失敗時は同じラウンドをやり直す）
  const proceed = () => {
    if (state === 'success') {
      if (round >= TAP_ROUNDS) {
        const avg = timesRef.current.reduce((a, b) => a + b, 0) / timesRef.current.length
        onEnd(avg)
        return
      }
      setRound(r => r + 1)
    } else if (state === 'early') {
      scheduleGo()
    }
  }

  const label = state === 'wait' ? '誰かの納品援助要請まち・・・'
    : state === 'early' ? 'タップが早すぎる！少し待てぇい！'
    : state === 'success' ? '高速納品完了！'
    : '納品援助せよ！'
  const bgImg = state === 'wait' ? TAP_IMG_WAIT
    : state === 'early' ? TAP_IMG_NG
    : state === 'success' ? TAP_IMG_OK
    : TAP_IMG_GO

  return (
    <>
      <p className="arcade-tap-message">{label}</p>
      {state === 'wait' && (
        <p className="arcade-tap-hint">「タップ！」の表示が出たら高速で納品だ！</p>
      )}
      <div className="arcade-canvas-wrap">
        <div
          className={`arcade-tap-area${state === 'go' ? ' go' : ''}`}
          style={bgImg ? { backgroundImage: `url(${bgImg})` } : undefined}
          onPointerDown={onTap}
        >
          {state === 'go' && <span className="arcade-tap-go-flash">タァァァプゥゥゥゥ！</span>}
        </div>
      </div>
      <p className="facility-sub" style={{ textAlign: 'center' }}>ラウンド {Math.min(round, TAP_ROUNDS)} / {TAP_ROUNDS}</p>
      <div className="facility-btns">
        <button className="facility-close-btn" onClick={onAbort}>やめる</button>
        {(state === 'success' || state === 'early') && (
          <button className="facility-go-btn" onClick={proceed}>納品へ</button>
        )}
      </div>
    </>
  )
}

// ── ③モグラ叩き：モンスターが高速で出現/消滅。叩くと+1、まぎれ込んだ広場の住人アイコンを
//    誤って叩くと減点。制限時間20秒での正味撃破数を競う ──
const MOLE_GRID = 9
// テンキー配列（7,8,9が上段）に合わせた、見た目グリッド(左上0〜右下8)ごとの数字ラベル
const MOLE_NUMPAD_LABELS = [7, 8, 9, 4, 5, 6, 1, 2, 3]
const MOLE_TIME_MS = 20000
const MOLE_SHOW_MS_MIN = 220
const MOLE_SHOW_MS_MAX = 380
const MOLE_GAP_MS_MIN = 40
const MOLE_GAP_MS_MAX = 140
const MOLE_PENALTY_RATE = 0.22   // 出現のうち、誤って叩くと減点になる「住人」が混じる割合
const MOLE_HIT_SCORE = 1
const MOLE_PENALTY_SCORE = -2

const MONSTER_NAMES = [
  '10-2flora', '10sasukachi', '11marinsfia', '12isis', '13marudyuku', '14fen', '15marina', '16bongon',
  '17anybis', '18hankobo', '19jack', '1kurimi', '20sofi', '21jirutasu', '22joker', '23kuranp', '24jesta',
  '2supoa', '3yoyo', '4hidora', '5-2pekopeko', '5zonbi', '6flog', '7bokaru', '8paisuke', '9-2manthis',
  '9gaiasu', 'abyssalknight', 'alarm', 'amon', 'angeling', 'anybis', 'bitata', 'bokaru', 'bongon',
  'chinpira', 'dark', 'darkpri', 'devilchi', 'deviling', 'dorakyura', 'dragonfly', 'drake', 'eclipse',
  'farao', 'fen', 'fendark', 'fishman', 'flog', 'flora', 'furioni', 'gaiasu', 'ghostring', 'goldenbug',
  'golem', 'hakurengoku', 'hankobo', 'hidora', 'horu', 'isis', 'jack', 'jesta', 'jirutasu', 'joker',
  'kimera', 'kingdramo', 'kuranp', 'kurimi', 'lunatic', 'maho', 'manthis', 'marina', 'marinsfia',
  'marudyuku', 'master', 'masterring', 'minotaur', 'mistel', 'moroku', 'mummy', 'munack', 'myutant',
  'nekuro', 'nightmare', 'oakhero', 'oaklord', 'osiris', 'otto', 'oul', 'paisuke', 'pekopeko',
  'sasukachi', 'smokey', 'sofi', 'soldierskeleton', 'stra', 'supoa', 'toad', 'wanderwolf', 'whisper',
  'yafa', 'yoyo', 'zonbi',
].map(n => `/assets/characters/enemies/${n}.webp`)

const PENALTY_NAMES = ['refine', 'shadow', 'spellbook', 'toolshop', 'miner', 'merchant']
  .map(n => `/assets/characters/enemies/${n}.webp`)

interface MoleCell { img: string; penalty: boolean }

function randomMoleCell(): MoleCell {
  if (Math.random() < MOLE_PENALTY_RATE) {
    return { img: PENALTY_NAMES[Math.floor(Math.random() * PENALTY_NAMES.length)], penalty: true }
  }
  return { img: MONSTER_NAMES[Math.floor(Math.random() * MONSTER_NAMES.length)], penalty: false }
}

function MoleGame({ onEnd, onAbort }: GameProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [activeCell, setActiveCell] = useState<MoleCell | null>(null)
  const [hits, setHits] = useState(0)
  const [remainMs, setRemainMs] = useState(MOLE_TIME_MS)
  const [flash, setFlash] = useState(false)
  const hitsRef = useRef(0)
  const endedRef = useRef(false)
  const spawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevIdxRef = useRef<number | null>(null)
  const spawnFnRef = useRef<(() => void) | null>(null)
  // キーダウン(テンキー)ハンドラはマウント時1回だけ登録するため、最新のactiveIdx/activeCellをrefで参照する
  const activeIdxRef = useRef<number | null>(null)
  const activeCellRef = useRef<MoleCell | null>(null)
  useEffect(() => { activeIdxRef.current = activeIdx; activeCellRef.current = activeCell }, [activeIdx, activeCell])

  useEffect(() => {
    const startAt = performance.now()

    const spawn = () => {
      if (endedRef.current) return
      let next = Math.floor(Math.random() * MOLE_GRID)
      if (next === prevIdxRef.current) next = (next + 1) % MOLE_GRID
      prevIdxRef.current = next
      setActiveIdx(next)
      setActiveCell(randomMoleCell())
      const showMs = MOLE_SHOW_MS_MIN + Math.random() * (MOLE_SHOW_MS_MAX - MOLE_SHOW_MS_MIN)
      hideTimerRef.current = setTimeout(() => {
        setActiveIdx(null)
        setActiveCell(null)
        const gap = MOLE_GAP_MS_MIN + Math.random() * (MOLE_GAP_MS_MAX - MOLE_GAP_MS_MIN)
        spawnTimerRef.current = setTimeout(spawn, gap)
      }, showMs)
    }
    spawnFnRef.current = spawn
    spawnTimerRef.current = setTimeout(spawn, 300)

    const tick = setInterval(() => {
      const left = Math.max(0, MOLE_TIME_MS - (performance.now() - startAt))
      setRemainMs(left)
      if (left <= 0 && !endedRef.current) {
        endedRef.current = true
        clearInterval(tick)
        if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current)
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        onEnd(Math.max(0, hitsRef.current))
      }
    }, 100)

    return () => {
      clearInterval(tick)
      if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const whack = (i: number) => {
    const cell = activeCellRef.current
    if (activeIdxRef.current !== i || !cell) return
    if (cell.penalty) {
      playDamage()
      setFlash(true)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = setTimeout(() => setFlash(false), 200)
    } else {
      playAttack()
    }
    hitsRef.current += cell.penalty ? MOLE_PENALTY_SCORE : MOLE_HIT_SCORE
    setHits(Math.max(0, hitsRef.current))
    setActiveIdx(null)
    setActiveCell(null)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    // 次のモグラも spawn() 経由にする（表示→自動非表示→次回への連鎖を必ず引き継ぐため）。
    // ここで表示だけ直接セットして連鎖を省略すると、叩いた後だけ自動で消えなくなるバグになる。
    const gap = MOLE_GAP_MS_MIN + Math.random() * (MOLE_GAP_MS_MAX - MOLE_GAP_MS_MIN)
    spawnTimerRef.current = setTimeout(() => spawnFnRef.current?.(), gap)
  }

  // PC向け：テンキー/数字キーでも叩けるようにする（クリックは狙いが振れやすいため）。
  // 見た目のグリッド(左上0〜右下8)に対し、テンキー配列(7,8,9が上段)に合わせて対応させる。
  useEffect(() => {
    const NUMKEY_TO_INDEX: Record<string, number> = { '7': 0, '8': 1, '9': 2, '4': 3, '5': 4, '6': 5, '1': 6, '2': 7, '3': 8 }
    const onKeyDown = (e: KeyboardEvent) => {
      const idx = NUMKEY_TO_INDEX[e.key]
      if (idx !== undefined) whack(idx)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <p className="facility-sub" style={{ textAlign: 'center' }}>
        残り {(remainMs / 1000).toFixed(1)}秒　撃破 {hits}匹
      </p>
      <div className="arcade-canvas-wrap" style={{ position: 'relative' }}>
        <div className="arcade-mole-grid">
          {Array.from({ length: MOLE_GRID }, (_, i) => (
            <button
              key={i}
              className={`arcade-mole-hole${activeIdx === i ? ' active' : ''}`}
              onPointerDown={() => whack(i)}
            >
              <span className="arcade-mole-key">{MOLE_NUMPAD_LABELS[i]}</span>
              {activeIdx === i && activeCell && (
                <img src={activeCell.img} className="arcade-mole-img" draggable={false} />
              )}
            </button>
          ))}
        </div>
        {flash && <div className="arcade-mole-flash" />}
      </div>
      <div className="facility-btns">
        <button className="facility-close-btn" onClick={onAbort}>やめる</button>
      </div>
    </>
  )
}
