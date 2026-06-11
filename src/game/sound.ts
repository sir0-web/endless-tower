// ── BGM / SE 管理 ──
// BGMはクロスフェードで滑らかに切り替え、SEは多重再生（連撃が重なって鳴る）に対応。

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

// ── SE（多重再生対応：cloneNode で同時発音を許可） ──
const seTemplates: Record<string, HTMLAudioElement> = {}

function se(name: string, volMul = 1): void {
  if (_muted) return
  let tpl = seTemplates[name]
  if (!tpl) {
    tpl = new Audio(`/se/${name}.mp3`)
    tpl.preload = 'auto'
    seTemplates[name] = tpl
  }
  // クローンを再生 → 連続ヒットでも切れずに重なって鳴る
  const a = tpl.cloneNode() as HTMLAudioElement
  a.volume = Math.max(0, Math.min(1, (SE_VOLUME[name] ?? 0.5) * volMul))
  void a.play().catch(() => {})
}

export function playAttack():  void { se('attack')  }
export function playCrit():    void { se('attack', 1.5) }  // クリは attack を大きめに鳴らして強調（専用音源なし）
export function playDamage():  void { se('damage')  }
export function playLevelUp(): void { se('levelup') }
export function playStairs():  void { se('stairs')  }
export function playPotion():  void { se('potion')  }
export function playEquip():   void { se('equip')   }
