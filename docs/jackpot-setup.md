# 全鯖共有ジャックポット セットアップ

全プレイヤーのスロット回転を 1 つのプールに積み上げ、ジャックポット絵柄（8 番の絵柄が 3 つ揃い）を
引いた人がプールを総取りする「プログレッシブ・ジャックポット」の DB セットアップ手順。

- プール上限は **100**。100 到達時に全プレイヤーへ EVENT アナウンス（`world_notifications`）が1度だけ流れる。
- 当選確率はクライアント側 `SlotMachine.tsx` の `JACKPOT_CHANCE`（既定 0.33%＝アルカナチャンス1.1%より低い）で制御。
  当選時のみリールが 8 番で揃う（通常出目は 1〜7、8 番は回転アニメ表示のみ）。

> 依存: 上限到達 EVENT は `world_notifications` テーブルへ INSERT する。先に
> `docs/world-notification-plan.md` のテーブルが作成済みであること。

Supabase の SQL Editor で以下を **一度だけ** 実行する。

```sql
-- ── テーブル（id=1 の1行だけを使うシングルトン）──
create table if not exists ebt_jackpot (
  id         smallint primary key default 1,
  pool       integer  not null   default 0,
  updated_at timestamptz not null default now(),
  constraint ebt_jackpot_singleton check (id = 1)
);

insert into ebt_jackpot (id, pool) values (1, 0)
on conflict (id) do nothing;

-- ── RLS：読み取りは全員可。書き込みは RPC(security definer)経由のみ ──
alter table ebt_jackpot enable row level security;

drop policy if exists "jackpot read" on ebt_jackpot;
create policy "jackpot read" on ebt_jackpot
  for select using (true);

-- ── Realtime：UPDATE をクライアントへ配信 ──
alter publication supabase_realtime add table ebt_jackpot;

-- ── 加算（スロットが回るたびに呼ぶ）──
-- プールは 100 が上限（least で頭打ち）。0〜99 から 100 へ到達した最初の1回だけ、
-- 全プレイヤー向けに world_notifications へ EVENT 通知を INSERT する（row lock により1回だけ）。
create or replace function increment_jackpot(amount integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare prev integer; v integer;
begin
  select pool into prev from ebt_jackpot where id = 1 for update;
  v := least(prev + amount, 100);
  update ebt_jackpot set pool = v, updated_at = now() where id = 1;
  if prev < 100 and v >= 100 then
    insert into world_notifications (type, title, message, player_name, player_id)
    values (
      'event',
      '【💰JACKPOT💰】',
      'ジャックポットが上限に達しました！次にJACKPOT絵柄を揃えた冒険者が全鯖共有プールを総取りします！',
      null, null
    );
  end if;
  return v;
end;
$$;

-- ── 総取り（ジャックポット成立時に呼ぶ）──
-- リセット前の pool を返す。row lock により同時成立でも1人だけ満額、他は0。
-- p_claim_id はクライアント生成のUUID。同じ claim_id で再送された場合は
-- 新たにプールを引かず、前回と同じ結果をそのまま返す（冪等）。
-- サーバー側では成功していたのにレスポンスがクライアントへ届かず失敗扱いになり、
-- 「プールは空だったので最低保証」を誤って表示してしまう取りこぼし対策。
alter table ebt_jackpot add column if not exists last_claim_id     uuid;
alter table ebt_jackpot add column if not exists last_claim_amount integer not null default 0;

drop function if exists claim_jackpot();

create or replace function claim_jackpot(p_claim_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare won integer;
declare prev_claim_id uuid;
declare prev_claim_amount integer;
begin
  select pool, last_claim_id, last_claim_amount into won, prev_claim_id, prev_claim_amount
  from ebt_jackpot where id = 1 for update;

  if p_claim_id is not null and prev_claim_id = p_claim_id then
    return prev_claim_amount;
  end if;

  update ebt_jackpot
    set pool = 0, last_claim_id = p_claim_id, last_claim_amount = won, updated_at = now()
    where id = 1;
  return won;
end;
$$;

grant execute on function increment_jackpot(integer)  to anon, authenticated;
grant execute on function claim_jackpot(uuid)          to anon, authenticated;
```


## 必要なアセット（配置済み）

- `public/assets/slot/slot8.png` … リールのジャックポット絵柄（必須・配置済み・透過処理済み）。
- `public/assets/slot/jack.mp4` … ジャックポット成立時に流す専用動画（配置済み）。
  `BonusVideo.tsx` の `RESULT_SRCS['jackpot']` が参照する。

## 仕組みの要点

- スロットが1回回るたび `incrementJackpot()` で pool += 1（全鯖共有・上限100）。
- 当選は `JACKPOT_CHANCE`（0.33%）の確率ロールで決定。当選時のみリールを 8 番で揃え、
  `evaluate()` が `'jackpot'` を返す。演出フローは次の通り：
  1. 当選 → 黒背景で「💰JACKPOT💰」（`showSlotAnnouncement('jackpot_start')`、アルカナチャンスと同じ作り）
  2. `jack.mp4` を再生
  3. 動画終了後 `applySlotEffect('jackpot')` → `claimJackpot()` でプールを総取り→ステータスポイントへ加算、
     「ポイント総取り XX ポイントゲット！」を表示。pool は 0 にリセット。
     直前に他プレイヤーが総取りした等でプールが空だった場合は最低保証20ポイントを付与（「当選したのに0枚」を防ぐ）。
     `claimJackpot()` はクライアント生成のUUID(`claim_id`)を付けて呼び、失敗時は同じIDで最大3回まで
     再試行する。サーバー側では成功していたのにレスポンスが届かず失敗扱いになるケースでも、
     再試行で前回と同じ結果を受け取れるため、取りこぼし（例: 2026-07-09 8:30 屍のモコの事例）を防ぐ。
- プールが 100 に達すると（`increment_jackpot` RPC 内で）全鯖へ EVENT アナウンスが1度だけ流れる。
- 777（7 が 3 つ揃い）は従来どおり阿修羅覇王拳のまま（ジャックポットとは別）。
