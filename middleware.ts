import { next } from '@vercel/edge'

// ──────────────────────────────────────────────────────────────
// 時間限定公開ゲート（Vercel Edge Middleware・本番サイトのみ動作）
//   ・指定時間内 … 通常表示（next() で素通し）
//   ・指定時間外 … メンテナンス画面（503）を返す（終了後は自動で閉じる）
//   ・JST(UTC+9) 基準で判定。日時はここで定数化。
//   ※ ローカルの vite dev では middleware は動かないため常に通常表示。
//   ※ 既存ゲームロジックには一切変更なし（このファイルの追加のみ）。
// ──────────────────────────────────────────────────────────────

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// JST の壁時計を実UTC時刻(ms)に変換するヘルパ
// Date.UTC(年, 月-1, 日, 時, 分) で JST の壁時計を書き、-9h して実UTC時刻にする
const jst = (y: number, mo: number, d: number, h: number, mi: number) =>
  Date.UTC(y, mo - 1, d, h, mi, 0) - JST_OFFSET_MS

// 公開ウィンドウ（JST基準・[from, to) の半開区間）。複数枠OK・昇順で並べる。
// この配列内のどこかに該当すれば公開、それ以外はメンテ画面。
const OPEN_WINDOWS: { from: number; to: number }[] = [
  { from: jst(2026, 6, 13, 15, 0), to: jst(2026, 6, 13, 23, 0) }, // 2026-06-13 15:00〜23:00 JST
  { from: jst(2026, 6, 14, 18, 0), to: jst(2026, 6, 14, 23, 0) }, // 2026-06-14 18:00〜23:00 JST（次回）
]

const isOpenAt = (now: number) => OPEN_WINDOWS.some(w => now >= w.from && now < w.to)
// まだ終了していない最初のウィンドウ（＝現在公開中 or 次回公開）を返す
const upcomingWindow = (now: number) => OPEN_WINDOWS.find(w => now < w.to) ?? null

export const config = {
  // 静的アセット(assets/*)とVercel内部パス(_vercel/*)は素通し
  matcher: ['/((?!_vercel|assets/).*)'],
}

export default function middleware(request: Request): Response {
  const now = Date.now()
  if (isOpenAt(now)) return next()

  return new Response(maintenanceHtml(now), {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 公開開始時刻をまたいでも古いメンテ画面がキャッシュされないようにする
      'cache-control': 'no-store, max-age=0',
      'retry-after': '3600',
    },
  })
}

// 公開ウィンドウを JST の「YYYY/MM/DD HH:MM 〜 HH:MM」表記に整形する
function formatWindowJst(w: { from: number; to: number }): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const f = new Date(w.from + JST_OFFSET_MS) // +9h して UTC 各成分＝JST 壁時計にする
  const t = new Date(w.to + JST_OFFSET_MS)
  const date = `${f.getUTCFullYear()}/${p(f.getUTCMonth() + 1)}/${p(f.getUTCDate())}`
  return `${date} ${p(f.getUTCHours())}:${p(f.getUTCMinutes())} 〜 ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`
}

function maintenanceHtml(now: number): string {
  // 次回（まだ終了していない最初の）公開ウィンドウ。無ければ最後の枠を表示に使う。
  const nextWin = upcomingWindow(now) ?? OPEN_WINDOWS[OPEN_WINDOWS.length - 1]
  const openLabel = formatWindowJst(nextWin)
  // カウントダウン用。次回が存在すればその from/to、全終了済みなら 0 を渡し「終了」表示にする
  const FROM = upcomingWindow(now) ? nextWin.from : 0
  const TO   = upcomingWindow(now) ? nextWin.to   : 0
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="60">
<title>準備中 | Endless Tower</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    min-height: 100dvh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif;
    color: #e8e8f8;
    background: radial-gradient(1200px 800px at 50% -10%, #1b1b3a 0%, #0a0a18 60%, #06060f 100%);
  }
  .card {
    width: 100%; max-width: 440px; text-align: center;
    background: rgba(18, 18, 38, 0.82);
    border: 1px solid rgba(150, 150, 255, 0.28);
    border-radius: 18px;
    padding: 36px 26px 30px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
  }
  .logo { margin-bottom: 14px; }
  .logo video { width: 100%; max-width: 320px; border-radius: 12px; display: block; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 10px; letter-spacing: 0.04em; }
  .lead { font-size: 14px; color: #b9b9dd; margin: 0 0 22px; line-height: 1.7; }
  .window {
    background: rgba(90, 110, 255, 0.10);
    border: 1px solid rgba(120, 140, 255, 0.30);
    border-radius: 12px; padding: 14px 12px; margin-bottom: 18px;
  }
  .window .label { display: block; font-size: 11px; letter-spacing: 0.16em; color: #8e8ec8; margin-bottom: 6px; }
  .window time { font-size: 17px; font-weight: 700; color: #cfd6ff; }
  .window small { font-size: 12px; color: #9a9ad0; font-weight: 400; }
  .status { font-size: 15px; font-weight: 700; color: #ffd95a; margin: 0 0 16px; min-height: 1.4em; }
  .note { font-size: 12px; color: #8a8ab0; margin: 0; line-height: 1.7; }
  @media (max-width: 380px) {
    .card { padding: 30px 18px 24px; }
    h1 { font-size: 20px; }
    .window time { font-size: 15px; }
  }
</style>
</head>
<body>
  <main class="card">
    <div class="logo">
      <video src="/assets/maintenance/maintenance.mp4" autoplay muted loop playsinline></video>
    </div>
    <h1>より良いゲームをお届けするために<br>スタッフが鋭意準備中です</h1>
    <p class="lead">Endless Tower は下記の時間のみ公開しています。<br>時間になると自動で開きます。</p>
    <div class="window">
      <span class="label">OPEN HOURS</span>
      <time>${openLabel} <small>(JST)</small></time>
    </div>
    <p id="status" class="status">読み込み中…</p>
    <p class="note">このページは開いたままお待ちください。<br>自動で更新されます。</p>
  </main>
  <script>
    var FROM = ${FROM}, TO = ${TO};
    function pad(n){ return (n < 10 ? '0' : '') + n; }
    function fmt(ms){
      var s = Math.floor(ms / 1000);
      var h = Math.floor(s / 3600); s -= h * 3600;
      var m = Math.floor(s / 60); s -= m * 60;
      return h + '時間' + pad(m) + '分' + pad(s) + '秒';
    }
    function tick(){
      var now = Date.now();
      var el = document.getElementById('status');
      if (now >= FROM && now < TO) { location.reload(); return; }
      if (now < FROM) { el.textContent = '公開まで あと ' + fmt(FROM - now); }
      else { el.textContent = '本日の公開は終了しました。'; }
    }
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`
}
