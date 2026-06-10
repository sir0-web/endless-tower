let bgmAudio: HTMLAudioElement | null = null
let bgmName: string | null = null
let _muted = false

export function isMuted(): boolean { return _muted }

export function toggleMute(): void {
  _muted = !_muted
  if (_muted) {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio = null }
  } else {
    if (bgmName) {
      bgmAudio = new Audio(`/bgm/${bgmName}.mp3`)
      bgmAudio.loop = true
      void bgmAudio.play().catch(() => {})
    }
  }
}

export function playBGM(name: string): void {
  if (bgmName === name && bgmAudio && !bgmAudio.paused) return
  stopBGM()
  bgmName = name
  if (_muted) return
  bgmAudio = new Audio(`/bgm/${name}.mp3`)
  bgmAudio.loop = true
  void bgmAudio.play().catch(() => {})
}

export function stopBGM(): void {
  if (bgmAudio) { bgmAudio.pause(); bgmAudio = null }
  bgmName = null
}

const sePool: Record<string, HTMLAudioElement> = {}

function se(name: string): void {
  if (_muted) return
  let a = sePool[name]
  if (!a) {
    a = new Audio(`/se/${name}.mp3`)
    sePool[name] = a
  }
  a.currentTime = 0
  void a.play().catch(() => {})
}

export function playAttack():  void { se('attack')  }
export function playDamage():  void { se('damage')  }
export function playLevelUp(): void { se('levelup') }
export function playStairs():  void { se('stairs')  }
export function playPotion():  void { se('potion')  }
export function playEquip():   void { se('equip')   }
