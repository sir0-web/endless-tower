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
 * window.prompt の安全版。ダイアログ表示中に touchend が飲み込まれた場合の
 * 後始末として、戻ってきた直後にスタックしたポインタを必ず解放する。
 * Phaser シーン内から prompt を呼ぶときは必ずこちらを使うこと。
 */
export function safePrompt(scene: Phaser.Scene, message: string, defaultValue?: string): string | null {
  const result = window.prompt(message, defaultValue)
  releaseStuckPointers(scene.input.manager)
  return result
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
