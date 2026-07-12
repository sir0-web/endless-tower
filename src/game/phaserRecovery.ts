import Phaser from 'phaser'

// ── 入力・描画ループの自己修復ユーティリティ ──────────────────────
// GAME OVER画面などで「ボタンが一切押せなくなる」報告への対策群。
// 原因は主に
//   (1) タッチ処理中に prompt 等の同期ダイアログが開くと touchend がページに届かず、
//       Phaser のタッチポインタが押下状態のまま残り、以後の全タップが無視される
//       （タッチポインタは有限本数で、スタックすると空きが無くなる）
//   (2) バックグラウンド復帰後に requestAnimationFrame が再開せず、
//       カメラフェード完了イベントが永久に来ずシーン遷移が完了しない
// の2系統で、どちらも「画面は正常に見えるのに操作だけ死ぬ」symptom になる。

/**
 * 押下状態のまま取り残されたタッチポインタを解放する。
 * id 0 はマウス用ポインタなので触らない（マウスは本数制限の対象外）。
 */
export function releaseStuckPointers(manager: Phaser.Input.InputManager): void {
  for (const pointer of manager.pointers) {
    if (pointer.id !== 0 && (pointer.active || pointer.isDown)) {
      pointer.reset()
    }
  }
}

/**
 * テキスト入力ダイアログ（DOMモーダル）。window.prompt の代替。
 * prompt はアプリ内WebViewや一部のOEMブラウザ（Xiaomi等）で未実装/描画不全のため使えない
 * （入力欄が出ない・即nullが返る）。全ブラウザで確実に動くHTMLモーダルで置き換える。
 * OK=入力文字列 / キャンセル・背景タップ=null を resolve する。
 */
export function showTextInputDialog(message: string, defaultValue = '', maxLength?: number): Promise<string | null> {
  return new Promise(resolve => {
    // 二重表示ガード：既に開いていたら新規は即キャンセル扱い
    if (document.querySelector('.eb-input-overlay')) { resolve(null); return }

    const overlay = document.createElement('div')
    overlay.className = 'eb-input-overlay'
    overlay.innerHTML = `
      <div class="eb-input-box">
        <div class="eb-input-msg"></div>
        <input class="eb-input-field" type="text" autocomplete="off" autocapitalize="off" />
        <div class="eb-input-btns">
          <button type="button" class="eb-input-cancel">キャンセル</button>
          <button type="button" class="eb-input-ok">OK</button>
        </div>
      </div>`
    overlay.querySelector<HTMLElement>('.eb-input-msg')!.innerText = message
    const input = overlay.querySelector<HTMLInputElement>('.eb-input-field')!
    input.value = defaultValue
    if (maxLength) input.maxLength = maxLength

    let done = false
    const finish = (result: string | null) => {
      if (done) return
      done = true
      overlay.remove()
      resolve(result)
    }

    overlay.querySelector('.eb-input-ok')!.addEventListener('click', () => finish(input.value))
    overlay.querySelector('.eb-input-cancel')!.addEventListener('click', () => finish(null))
    overlay.addEventListener('pointerdown', e => { if (e.target === overlay) finish(null) })
    // Enter=OK / Esc=キャンセル。stopPropagationでPhaserのwindowキーリスナー（移動等）に流さない
    overlay.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(input.value)
      else if (e.key === 'Escape') finish(null)
    })

    document.body.appendChild(overlay)
    input.focus()
    input.select()
  })
}

/**
 * Phaser シーンからのテキスト入力。ダイアログ表示中はシーン入力を止め、
 * 閉じた後にスタックしたポインタを解放する。シーン内から入力を求めるときは必ずこちらを使うこと。
 * （旧実装は window.prompt だったが、prompt非対応ブラウザ対策でDOMモーダルに変更。非同期になった）
 */
export async function safePrompt(scene: Phaser.Scene, message: string, defaultValue?: string, maxLength?: number): Promise<string | null> {
  const keyboard = scene.input.keyboard
  scene.input.enabled = false
  if (keyboard) keyboard.enabled = false
  try {
    return await showTextInputDialog(message, defaultValue ?? '', maxLength)
  } finally {
    scene.input.enabled = true
    if (keyboard) keyboard.enabled = true
    releaseStuckPointers(scene.input.manager)
  }
}

/**
 * フェードアウトしてからシーン遷移する。camerafadeoutcomplete はゲームループ
 * （RAF）駆動のため、ループが止まっていると永久に発火しない。RAF に依存しない
 * window.setTimeout でも遷移を起動して、どちらか先に来た方で1回だけ遷移する。
 */
export function fadeOutToScene(scene: Phaser.Scene, key: string, data?: object, duration = 350): void {
  let done = false
  const go = () => {
    if (done) return
    done = true
    if (!scene.sys.game) return   // Phaser.Game破棄後（アンマウント等）にフォールバックが発火した場合
    scene.scene.start(key, data)
  }
  scene.cameras.main.fadeOut(duration, 0, 0, 0)
  scene.cameras.main.once('camerafadeoutcomplete', go)
  window.setTimeout(go, duration + 500)
}
