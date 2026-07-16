// public/assets 配下の全ファイルのcontentハッシュ一覧を生成する。
// キャッシュバスター(?v=)にファイル内容ハッシュを使うことで、
// 「変更したファイルだけ」ブラウザキャッシュを更新させ、無変更のファイルは
// 引き続き長期キャッシュの恩恵（再訪問時ゼロ通信）を受けられるようにする。
// npm run build の prebuild で自動実行される。手動編集不要・src/assetManifest.tsは自動生成物。
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ASSETS_DIR = join(ROOT, 'public', 'assets')
const OUT_FILE = join(ROOT, 'src', 'assetManifest.ts')

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else {
      const buf = readFileSync(full)
      const hash = createHash('md5').update(buf).digest('hex').slice(0, 10)
      const publicPath = '/' + relative(join(ROOT, 'public'), full).split('\\').join('/')
      out[publicPath] = hash
    }
  }
}

const manifest = {}
walk(ASSETS_DIR, manifest)

const body = `// 自動生成ファイル。scripts/gen-asset-manifest.mjs (npm run build の prebuild) で生成。手動編集しないこと。
export const ASSET_MANIFEST: Record<string, string> = ${JSON.stringify(manifest)}
`
writeFileSync(OUT_FILE, body)
console.log(`[asset-manifest] ${Object.keys(manifest).length} files hashed -> ${relative(ROOT, OUT_FILE)}`)
