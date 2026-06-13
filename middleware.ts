import { next } from '@vercel/edge'

// ──────────────────────────────────────────────────────────────
// 時間限定公開ゲート（Vercel Edge Middleware・本番サイトのみ動作）
//   ・Supabase の system_config テーブルから公開ウィンドウを動的に取得
//   ・Supabase が応答しない場合はフォールバック定数で判定（サイトは「開く」方向に倒す）
//   ・/admin パスはメンテ中でも常に素通し
// ──────────────────────────────────────────────────────────────

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// フォールバック（Supabase 接続失敗時）：過去の日付 = 常時メンテ扱いにしない。
// "開く" 方向に倒すため空配列ではなく、遠い未来を入れておく。
// 実際の公開管理は admin パネルの Supabase 設定で行う。
const FALLBACK_OPEN: { from: number; to: number }[] = [
  // Supabase 障害時は "開いたまま" にするため from=0, to=遠い未来
  { from: 0, to: Date.UTC(2099, 0, 1) },
]

export const config = {
  // 静的アセット・Vercel内部パス・管理画面は素通し
  matcher: ['/((?!_vercel|assets/|admin).*)'],
}

type Window = { from: number; to: number }

async function fetchWindows(): Promise<Window[]> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return FALLBACK_OPEN

  try {
    const res = await fetch(
      `${url}/rest/v1/system_config?key=eq.maintenance_windows&select=value`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(2500),
      }
    )
    if (!res.ok) return FALLBACK_OPEN
    const data = (await res.json()) as Array<{ value: Window[] }>
    const wins = data[0]?.value
    return Array.isArray(wins) && wins.length > 0 ? wins : FALLBACK_OPEN
  } catch {
    return FALLBACK_OPEN
  }
}

export default async function middleware(request: Request): Promise<Response> {
  const now = Date.now()
  const windows = await fetchWindows()

  const isOpen     = windows.some(w => now >= w.from && now < w.to)
  const upcoming   = windows.find(w => now < w.to) ?? null

  if (isOpen) return next()

  return new Response(maintenanceHtml(now, windows, upcoming), {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'retry-after': '3600',
    },
  })
}

function formatWindowJst(w: Window): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const f = new Date(w.from + JST_OFFSET_MS)
  const t = new Date(w.to   + JST_OFFSET_MS)
  const date = `${f.getUTCFullYear()}/${p(f.getUTCMonth() + 1)}/${p(f.getUTCDate())}`
  return `${date} ${p(f.getUTCHours())}:${p(f.getUTCMinutes())} 〜 ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`
}

function maintenanceHtml(now: number, _windows: Window[], upcoming: Window | null): string {
  const realUpcoming = upcoming && upcoming.from > now ? upcoming : null
  const openLabel    = realUpcoming ? formatWindowJst(realUpcoming) : '未定'
  const FROM = realUpcoming ? realUpcoming.from : 0
  const TO   = realUpcoming ? realUpcoming.to   : 0

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
  .logo video { width: 100%; max-width: 320px; display: block; margin: 0 auto; clip-path: inset(15% 0 0 0 round 12px); }
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
    <p class="lead">⏰次回のオープンβテスト期間⏰</p>
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
      var m = Math.floor(s / 60);   s -= m * 60;
      return h + '時間' + pad(m) + '分' + pad(s) + '秒';
    }
    function tick(){
      var now = Date.now();
      var el = document.getElementById('status');
      if (FROM && now >= FROM && now < TO) { location.reload(); return; }
      if (FROM && now < FROM) { el.textContent = '公開まで あと ' + fmt(FROM - now); }
      else { el.textContent = '本日の公開は終了しました。'; }
    }
    tick();
    setInterval(tick, 1000);
  </script>
</body>
</html>`
}
