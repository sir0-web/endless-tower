// ── BGM / SE 管理 ──
// BGMはHTMLAudioでクロスフェード切り替え。
// SEはWeb Audio APIで再生する：効果音を一度だけデコードして使い回し、
// 再生のたびに軽量なBufferSourceを生成する。これにより従来の cloneNode 量産で
// 起きていた「メディア要素の枯渇でSEだけ鳴らなくなる」問題を原理的に解消する。

let bgmAudio: HTMLAudioElement | null = null
let bgmName: string | null = null
let _muted = false
let fadeTimer: ReturnType<typeof setInterval> | null = null

const BGM_VOLUME = 0.45   // BGMマスター音量（SEとのバランス）

// SE種別ごとの音量（過大なものを抑える）
const SE_VOLUME: Record<string, number> = {
  attack:  0.45,
  crit:    0.6,
  damage:  0.55,
  levelup: 0.7,
  stairs:  0.6,
  potion:  0.6,
  equip:   0.6,
}

export function isMuted(): boolean { return _muted }

/** audio の音量を from→to へ ms かけてランプ（クロスフェード用） */
function rampVolume(audio: HTMLAudioElement, from: number, to: number, ms: number, onDone?: () => void) {
  const steps = Math.max(1, Math.round(ms / 40))
  let i = 0
  audio.volume = Math.max(0, Math.min(1, from))
  const iv = setInterval(() => {
    i++
    const t = i / steps
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t))
    if (i >= steps) {
      clearInterval(iv)
      audio.volume = Math.max(0, Math.min(1, to))
      onDone?.()
    }
  }, 40)
  return iv
}

export function toggleMute(): void {
  _muted = !_muted
  if (_muted) {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null }
  } else {
    resumeAudio()
    if (bgmName) {
      bgmAudio = new Audio(`/bgm/${bgmName}.mp3`)
      bgmAudio.loop = true
      bgmAudio.volume = 0
      void bgmAudio.play().catch(() => {})
      rampVolume(bgmAudio, 0, BGM_VOLUME, 500)
    }
  }
}

export function playBGM(name: string): void {
  // 同じ曲が既に流れていれば何もしない
  if (bgmName === name && bgmAudio && !bgmAudio.paused) return
  bgmName = name
  if (_muted) return

  const old = bgmAudio
  // 旧BGMをフェードアウトして停止
  if (old) {
    if (fadeTimer) clearInterval(fadeTimer)
    rampVolume(old, old.volume, 0, 600, () => { old.pause() })
  }

  // 新BGMをフェードインで開始
  const next = new Audio(`/bgm/${name}.mp3`)
  next.loop = true
  next.volume = 0
  void next.play().catch(() => {})
  bgmAudio = next
  fadeTimer = rampVolume(next, 0, BGM_VOLUME, 600)
}

export function stopBGM(): void {
  const old = bgmAudio
  if (old) {
    rampVolume(old, old.volume, 0, 400, () => { old.pause() })
  }
  bgmAudio = null
  bgmName = null
}

// ── SE（Web Audio API：大量の重なり再生でも要素枯渇しない） ──
const SE_NAMES = ['attack', 'damage', 'levelup', 'stairs', 'potion', 'equip']

let audioCtx: AudioContext | null = null
const seBuffers: Record<string, AudioBuffer> = {}
const seLoading: Record<string, boolean> = {}

function getCtx(): AudioContext | null {
  if (audioCtx) return audioCtx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioCtx = new Ctor()
  } catch {
    return null
  }
  return audioCtx
}

async function loadSeBuffer(name: string): Promise<void> {
  const ctx = getCtx()
  if (!ctx || seBuffers[name] || seLoading[name]) return
  seLoading[name] = true
  try {
    const res = await fetch(`/se/${name}.mp3`)
    const arr = await res.arrayBuffer()
    seBuffers[name] = await ctx.decodeAudioData(arr)
  } catch {
    // デコード失敗時はその音が鳴らないだけ（ゲーム進行は止めない）
  } finally {
    seLoading[name] = false
  }
}

/** 全SEを事前デコード（初回ヒットの取りこぼし防止）。ユーザー操作後に呼ぶと確実。 */
export function preloadSE(): void {
  for (const n of SE_NAMES) void loadSeBuffer(n)
}

/** AudioContextをユーザー操作で起こす（モバイルのsuspend/中断からの自動復帰）。 */
export function resumeAudio(): void {
  const ctx = getCtx()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
}

function se(name: string, volMul = 1, rateMul = 1): void {
  if (_muted) return
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})

  const buf = seBuffers[name]
  if (!buf) { void loadSeBuffer(name); return }  // 未デコードなら今回はスキップ（次回から鳴る）

  const src  = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rateMul
  const gain = ctx.createGain()
  gain.gain.value = Math.max(0, Math.min(1, (SE_VOLUME[name] ?? 0.5) * volMul))
  src.connect(gain).connect(ctx.destination)
  src.start()
  src.onended = () => { src.disconnect(); gain.disconnect() }
}

// ユーザー操作のたびにAudioContextを起こし、SEを事前ロードしておく。
// これにより、何らかの理由で出力が中断されても次の入力で自動復帰する。
if (typeof window !== 'undefined') {
  const prime = () => { resumeAudio(); preloadSE() }
  window.addEventListener('pointerdown', prime, { passive: true })
  window.addEventListener('keydown', prime)
  window.addEventListener('touchstart', prime, { passive: true })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeAudio() })
}

// ── 低HP心音（WebAudio合成：音源ファイル不要） ──
// 「ドクン・ドクン」を2連のローシンセで合成。既存の低HPビネットの脈動と同じテンポ感。
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function thump(when: number, vol: number): void {
  const ctx = getCtx()
  if (!ctx) return
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(58, when)
  osc.frequency.exponentialRampToValueAtTime(36, when + 0.11)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(vol, when + 0.014)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.17)
  osc.connect(gain).connect(ctx.destination)
  osc.start(when)
  osc.stop(when + 0.2)
  osc.onended = () => { osc.disconnect(); gain.disconnect() }
}

/** 低HP時の心音ループを開始/停止する（HP25%以下の緊張演出）。 */
export function setHeartbeat(active: boolean): void {
  if (!active) {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    return
  }
  if (heartbeatTimer) return
  const beat = () => {
    if (_muted) return
    const ctx = getCtx()
    if (!ctx || ctx.state === 'suspended') return
    const t = ctx.currentTime + 0.02
    thump(t, 0.40)          // ドクン（強）
    thump(t + 0.22, 0.26)   // ドクン（弱）
  }
  beat()
  heartbeatTimer = setInterval(beat, 1300)  // ビネットの脈動(650ms yoyo)と同周期
}

export function playAttack():  void { se('attack')  }
export function playCrit():    void { se('attack', 1.5) }  // クリは attack を大きめに鳴らして強調（専用音源なし）
export function playDamage():  void { se('damage')  }
// 撃破専用音源は無いため、damage音をピッチダウン＋音量増で「ドスッ」という低い止め音に加工する。
// hit音（ヒット時）とは別に、トドメの瞬間に必ず追加で鳴らすことで撃破の重さを耳で確定させる。
export function playKill(heavy = false): void { se('damage', heavy ? 1.0 : 0.85, heavy ? 0.72 : 0.8) }
export function playLevelUp(): void { se('levelup') }
export function playStairs():  void { se('stairs')  }
export function playPotion():  void { se('potion')  }
export function playEquip():   void { se('equip')   }
