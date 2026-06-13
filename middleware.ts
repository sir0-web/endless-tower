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

// 公開期間（JST基準・[FROM, TO) の半開区間）
// Date.UTC(年, 月-1, 日, 時, 分) で JST の壁時計を書き、-9h して実UTC時刻にする
const OPEN_FROM = Date.UTC(2026, 5, 13, 15, 0, 0) - JST_OFFSET_MS // 2026-06-13 15:00 JST
const OPEN_TO   = Date.UTC(2026, 5, 13, 23, 0, 0) - JST_OFFSET_MS // 2026-06-13 23:00 JST

export const config = {
  // Vercel 内部パス(_vercel/*)は素通し。それ以外の全リクエストを判定対象にする
  matcher: ['/((?!_vercel).*)'],
}

export default function middleware(request: Request): Response {
  const now = Date.now()
  const isOpen = now >= OPEN_FROM && now < OPEN_TO
  if (isOpen) return next()

  return new Response(maintenanceHtml(), {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 公開開始時刻をまたいでも古いメンテ画面がキャッシュされないようにする
      'cache-control': 'no-store, max-age=0',
      'retry-after': '3600',
    },
  })
}

function maintenanceHtml(): string {
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
  .logo { font-size: 52px; line-height: 1; margin-bottom: 14px; }
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
    <div class="logo">🏰</div>
    <h1>ただいま準備中です</h1>
    <p class="lead">Endless Tower は下記の時間のみ公開しています。<br>時間になると自動で開きます。</p>
    <div class="window">
      <span class="label">OPEN HOURS</span>
      <time>2026/06/13 15:00 〜 23:00 <small>(JST)</small></time>
    </div>
    <p id="status" class="status">読み込み中…</p>
    <p class="note">このページは開いたままお待ちください。<br>自動で更新されます。</p>
  </main>
  <script>
    var FROM = ${OPEN_FROM}, TO = ${OPEN_TO};
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
