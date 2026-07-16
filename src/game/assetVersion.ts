import { ASSET_MANIFEST } from '../assetManifest'

// public/配下の画像はファイル名を変えずに中身だけ差し替えることがあり、
// Cache-Control: immutable な配信環境だとブラウザキャッシュが更新されない事故が起きる。
// ファイル内容のハッシュ(ビルド時生成のASSET_MANIFEST)を?v=に付けることで、
// 「変更したファイルだけ」キャッシュを更新させる（無変更ファイルは長期キャッシュを維持）。
export function withV(path: string): string {
  const hash = ASSET_MANIFEST[path]
  return hash ? `${path}?v=${hash}` : path
}
