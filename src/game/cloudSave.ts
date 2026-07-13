import { supabase } from './supabase'
import { repairWeaponKind, type SaveData } from './save'

// ── 端末を問わないクラウドセーブ ──
// 名前（スロット名）＋パスワードで Supabase にセーブデータ(JSON)を保存し、
// 別端末でも同じ名前＋パスワードで再開できるようにする。
//
// セキュリティ：パスワードは SHA-256 でハッシュ化して送る（平文は保持しない）。
// テーブル(ebt_cloud_saves)へは直接アクセスせず、SECURITY DEFINER の RPC 経由で
// 「名前＋ハッシュ一致時のみ読める/上書きできる」ようサーバー側で制御する（docs参照）。
//
// ライフサイクル：
//   ・ロードしたらサーバー行を削除（＝消費）。ローカル自動セーブと二重に残さない。
//   ・このランに紐づくクラウド鍵(cloudKey)をローカルに控え、死亡時に削除できるようにする（permadeath維持）。

const CLOUD_KEY = 'et_cloud_key'   // { name, hash } をローカルに控える（死亡時の削除・整合用）

export type CloudSaveResult = 'ok' | 'name_taken' | 'error'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function rememberCloudKey(name: string, hash: string): void {
  try { localStorage.setItem(CLOUD_KEY, JSON.stringify({ name, hash })) } catch { /* ignore */ }
}
function readCloudKey(): { name: string; hash: string } | null {
  try {
    const raw = localStorage.getItem(CLOUD_KEY)
    return raw ? (JSON.parse(raw) as { name: string; hash: string }) : null
  } catch { return null }
}
function forgetCloudKey(): void {
  try { localStorage.removeItem(CLOUD_KEY) } catch { /* ignore */ }
}

/** クラウドへ保存（upsert）。同名・別パスワードは 'name_taken' で拒否される。 */
export async function cloudSaveGame(name: string, password: string, data: SaveData): Promise<CloudSaveResult> {
  try {
    const hash = await sha256Hex(password)
    const { data: res, error } = await supabase.rpc('cloud_save', { p_name: name, p_hash: hash, p_data: data })
    if (error) { console.warn('クラウド保存失敗:', error.message); return 'error' }
    if (res === 'name_taken') return 'name_taken'
    rememberCloudKey(name, hash)
    return 'ok'
  } catch (e) {
    console.warn('クラウド保存例外:', e)
    return 'error'
  }
}

/** クラウドから読み込み。成功時はサーバー行を削除（＝消費）して SaveData を返す。 */
export async function cloudLoadGame(name: string, password: string): Promise<SaveData | null> {
  try {
    const hash = await sha256Hex(password)
    const { data, error } = await supabase.rpc('cloud_load', { p_name: name, p_hash: hash })
    if (error) { console.warn('クラウド読込失敗:', error.message); return null }
    if (!data) return null   // 名前 or パスワード不一致
    // ロードで消費：サーバー行を削除し、ローカルの控えも消す（再開後はローカル自動セーブが進行を持つ）
    await supabase.rpc('cloud_delete', { p_name: name, p_hash: hash })
    forgetCloudKey()
    return repairWeaponKind(data as SaveData)
  } catch (e) {
    console.warn('クラウド読込例外:', e)
    return null
  }
}

/**
 * このランに紐づくクラウドセーブを削除する（控えた cloudKey がある場合のみ）。
 * 死亡時・別経路での再開時に呼び、復活（セーブスカミング）を防ぐ。鍵が無ければ何もしない。
 */
export async function deleteOwnCloudSave(): Promise<void> {
  const key = readCloudKey()
  if (!key) return
  try {
    await supabase.rpc('cloud_delete', { p_name: key.name, p_hash: key.hash })
  } catch (e) {
    console.warn('クラウド削除例外:', e)
  } finally {
    forgetCloudKey()
  }
}
