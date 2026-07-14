// ── BGM / SE 管理 ──
// BGMはHTMLAudioでクロスフェード切り替え。
// SEはWeb Audio APIで再生する：効果音を一度だけデコードして使い回し、
// 再生のたびに軽量なBufferSourceを生成する。これにより従来の cloneNode 量産で
// 起きていた「メディア要素の枯渇でSEだけ鳴らなくなる」問題を原理的に解消する。

let bgmAudio: HTMLAudioElement | null = null
let bgmGain: GainNode | null = null   // BGM音量はGainNodeで制御（iOSはaudio.volumeへの代入を無視するため）
let bgmName: string | null = null
let _muted = false
let fadeTimer: ReturnType<typeof setInterval> | null = null

// BGM: 0.32、SE: 各SE_VOLUMEの値が「これまでの調整済みデフォルト音量」。
// スライダーはこれを100分率のパーセントとして扱い、BGMは50、SEは70を初期値（＝これまでの音量）とする。
const BGM_BASE_VOLUME = 0.32
const BGM_DEFAULT_PCT = 50
const SE_DEFAULT_PCT  = 70
const VOL_STORE_KEY = 'et_sound_volumes'

function loadVolumePrefs(): { bgmPct: number; sePct: number } {
  if (typeof localStorage === 'undefined') return { bgmPct: BGM_DEFAULT_PCT, sePct: SE_DEFAULT_PCT }
  try {
    const raw = localStorage.getItem(VOL_STORE_KEY)
    if (!raw) return { bgmPct: BGM_DEFAULT_PCT, sePct: SE_DEFAULT_PCT }
    const p = JSON.parse(raw) as { bgmPct?: number; sePct?: number }
    return {
      bgmPct: clampPct(p.bgmPct ?? BGM_DEFAULT_PCT),
      sePct:  clampPct(p.sePct  ?? SE_DEFAULT_PCT),
    }
  } catch {
    return { bgmPct: BGM_DEFAULT_PCT, sePct: SE_DEFAULT_PCT }
  }
}

function clampPct(v: number): number { return Math.max(0, Math.min(100, Math.round(v))) }

let { bgmPct: _bgmPct, sePct: _sePct } = loadVolumePrefs()

function saveVolumePrefs(): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(VOL_STORE_KEY, JSON.stringify({ bgmPct: _bgmPct, sePct: _sePct })) } catch { /* noop */ }
}

/** 現在のBGM実効音量（0〜1）。スライダー50%＝これまでのデフォルト音量。 */
function currentBgmVolume(): number { return BGM_BASE_VOLUME * (_bgmPct / BGM_DEFAULT_PCT) }
/** 現在のSE倍率。スライダー70%＝これまでのデフォルト音量（等倍）。 */
function currentSeMul(): number { return _sePct / SE_DEFAULT_PCT }

export function getBgmVolumePct(): number { return _bgmPct }
export function getSeVolumePct():  number { return _sePct }

export function setBgmVolumePct(pct: number): void {
  _bgmPct = clampPct(pct)
  saveVolumePrefs()
  if (_muted) return
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
  if (bgmGain) {
    // iOS対応：GainNode経由なら音量変更が即時反映される
    bgmGain.gain.value = currentBgmVolume()
  } else if (bgmAudio) {
    // フォールバック（Web Audio非対応環境のみ。iOSではこの代入は無視される）
    bgmAudio.volume = Math.max(0, Math.min(1, currentBgmVolume()))
  }
}

/** SEスライダー調整用の試し打ち音（現在のSE音量設定で鳴る） */
export function playSePreview(): void { se('attack') }

export function setSeVolumePct(pct: number): void {
  _sePct = clampPct(pct)
  saveVolumePrefs()
}


// SE種別ごとの音量（1.0超はWeb Audioのgainで原音より増幅。currentSeMul()でスライダー倍率をさらに掛ける）
const SE_VOLUME: Record<string, number> = {
  attack:  1.0,
  crit:    1.0,
  damage:  1.1,
  levelup: 1.1,
  stairs:  1.1,
  potion:  1.1,
  equip:   1.1,
  fall:    1.0,
}

export function isMuted(): boolean { return _muted }

/** audio の音量を from→to へ ms かけてランプ（Web Audio非対応環境向けフォールバック） */
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

/** GainNode の音量を from→to へ ms かけてランプ（クロスフェード用） */
function rampGain(g: GainNode, from: number, to: number, ms: number, onDone?: () => void) {
  const steps = Math.max(1, Math.round(ms / 40))
  let i = 0
  g.gain.value = Math.max(0, from)
  const iv = setInterval(() => {
    i++
    const t = i / steps
    g.gain.value = Math.max(0, from + (to - from) * t)
    if (i >= steps) {
      clearInterval(iv)
      g.gain.value = Math.max(0, to)
      onDone?.()
    }
  }, 40)
  return iv
}

/**
 * BGM用HTMLAudioをWeb Audioのゲイン経由で出力に接続する。
 * iOSはHTMLAudioElement.volumeへの代入をOS仕様で無視するため、音量制御はGainNodeで行う必要がある。
 * 接続に失敗した環境ではnullを返し、従来のaudio.volume制御にフォールバックする。
 */
function attachBgmGain(audio: HTMLAudioElement): GainNode | null {
  const ctx = getCtx()
  if (!ctx) return null
  try {
    const src = ctx.createMediaElementSource(audio)
    const g = ctx.createGain()
    src.connect(g).connect(ctx.destination)
    return g
  } catch {
    return null
  }
}

/** BGMを指定曲で起動し、フェードインする（既存曲のフェードアウトは呼び出し側で行う） */
function startBgm(name: string, fadeMs: number): void {
  resumeAudio()
  const next = new Audio(`/bgm/${name}.mp3`)
  next.loop = true
  const g = attachBgmGain(next)
  bgmAudio = next
  bgmGain = g
  if (g) {
    next.volume = 1   // 実音量はGainNodeで制御（iOSでも有効）
    g.gain.value = 0
    void next.play().catch(() => {})
    fadeTimer = rampGain(g, 0, currentBgmVolume(), fadeMs)
  } else {
    next.volume = 0
    void next.play().catch(() => {})
    fadeTimer = rampVolume(next, 0, Math.min(1, currentBgmVolume()), fadeMs)
  }
}

/** 現在のBGMをフェードアウトして停止する */
function fadeOutBgm(fadeMs: number): void {
  const oldAudio = bgmAudio
  const oldGain = bgmGain
  if (!oldAudio) return
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
  if (oldGain) rampGain(oldGain, oldGain.gain.value, 0, fadeMs, () => oldAudio.pause())
  else rampVolume(oldAudio, oldAudio.volume, 0, fadeMs, () => oldAudio.pause())
}

export function toggleMute(): void {
  _muted = !_muted
  if (_muted) {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null; bgmGain = null }
  } else {
    resumeAudio()
    if (bgmName) startBgm(bgmName, 500)
  }
}

export function playBGM(name: string): void {
  // 同じ曲が既に流れていれば何もしない
  if (bgmName === name && bgmAudio && !bgmAudio.paused) return
  bgmName = name
  if (_muted) return

  fadeOutBgm(600)   // 旧BGMをフェードアウトして停止
  startBgm(name, 600)
}

export function stopBGM(): void {
  fadeOutBgm(400)
  bgmAudio = null
  bgmGain = null
  bgmName = null
}

// ── SE（Web Audio API：大量の重なり再生でも要素枯渇しない） ──
const SE_NAMES = ['attack', 'damage', 'levelup', 'stairs', 'potion', 'equip', 'fall']

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
  gain.gain.value = Math.max(0, Math.min(2.4, (SE_VOLUME[name] ?? 0.5) * volMul * currentSeMul()))
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
let heartbeatActive = false   // 論理状態（バックグラウンド中もtrueを保持し、復帰時にタイマーを再開する）

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

function startHeartbeatTimer(): void {
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

function stopHeartbeatTimer(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

/** 低HP時の心音ループを開始/停止する（HP25%以下の緊張演出）。 */
export function setHeartbeat(active: boolean): void {
  heartbeatActive = active
  if (!active) { stopHeartbeatTimer(); return }
  // バックグラウンド中は鳴らさない（発熱・電池対策）。復帰時のvisibilitychangeで再開する。
  if (typeof document !== 'undefined' && document.hidden) return
  startHeartbeatTimer()
}

// バックグラウンドでは心音intervalを完全停止する（音は元々suspendで鳴らないが、
// タイマー起動自体がCPU/電池を消費するため）。復帰時に論理状態から復元する。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeartbeatTimer()
    else if (heartbeatActive) startHeartbeatTimer()
  })
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
export function playFall():    void { se('fall')    }
