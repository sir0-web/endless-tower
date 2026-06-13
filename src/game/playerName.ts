// ── 表示名システム（ワールド通知で使う冒険者名）──
// 名前入力は任意。未設定時は「冒険者XXXX」を自動生成して永続化する。いつでも変更可。
const KEY = 'et_display_name'
const HEX = () => Math.random().toString(16).slice(2, 6).toUpperCase() // 4桁

/** 現在の表示名を返す。初回アクセス時は仮名を生成・永続化する。 */
export function getDisplayName(): string {
  let n = localStorage.getItem(KEY)
  if (!n) { n = `冒険者${HEX()}`; localStorage.setItem(KEY, n) }
  return n
}

/** 表示名を保存する（12文字まで）。空白のみは無視。変更を UI に通知する。 */
export function setDisplayName(name: string): void {
  const v = name.trim().slice(0, 12)
  if (v) {
    localStorage.setItem(KEY, v)
    window.dispatchEvent(new Event('displayname-changed'))
  }
}
