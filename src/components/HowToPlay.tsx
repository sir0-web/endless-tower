import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 遊び方ガイド（タイトルの HOW TO PLAY から window.showHowToPlay() で開く）。
 * 現状の仕様に基づく初心者向けの丁寧な解説。スクロール可能・スマホ/PC対応。
 */
export function HowToPlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    window.showHowToPlay = () => setOpen(true)
    return () => { window.showHowToPlay = undefined }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="htp-backdrop" onClick={() => setOpen(false)}>
      <div className="htp-panel" onClick={e => e.stopPropagation()}>
        <div className="htp-header">
          <span className="htp-title">✦ 遊び方ガイド ✦</span>
          <button className="htp-close" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="htp-body">
          <p className="htp-lead">
            ようこそ、<b>エンドレスタワー</b>へ。<br />
            地下に広がる果てなき塔を、一歩ずつ攻略する冒険が始まります。<br />
            女神の加護を背に、どこまで深く潜れるか――あなたの挑戦を待っています。
          </p>

          <Section icon="🎯" title="ゲームの目的">
            <p>地下へ、地下へと続く塔（Basement Floor）を<b>できるだけ深く</b>進みましょう。階層に終わりはありません。</p>
            <p>力尽きた時の<b>到達階層</b>がスコアとなり、世界中の冒険者とランキングで競えます。</p>
          </Section>

          <Section icon="🕹️" title="操作方法">
            <ul className="htp-list">
              <li><Key>↑↓←→</Key> または <Key>W A S D</Key> … 移動</li>
              <li><Key>テンキー</Key> または <Key>Q E Z C</Key> … <b>斜め移動・斜め攻撃</b></li>
              <li><b>PC・マウス</b> … マップを<b>クリック</b>すると、その方向へ1歩進みます（8方向対応・キー操作と併用可）</li>
              <li><b>スマホ</b> … 画面をなぞる<b>バーチャルジョイスティック</b>で8方向移動</li>
              <li><Key>I</Key> … インベントリ（持ち物） / <Key>Esc</Key> … ポーズ</li>
            </ul>
            <p className="htp-note">これは<b>ターン制</b>です。あなたが1マス動く（または攻撃する）たびに、敵も1手動きます。焦らず一手ずつ考えましょう。キー配置はタイトルの <b>SETTINGS</b> から変更できます。</p>
          </Section>

          <Section icon="⚔️" title="戦闘">
            <p>敵がいるマスへ<b>移動しようとすると攻撃</b>になります。<b>斜めにも攻撃できます。</b></p>
            <p>今まさに殴れる敵の頭上には <b className="htp-accent">⚔️マーク</b> が浮かびます。これが出ている敵は安全に攻撃可能の合図です。</p>
            <p className="htp-note">ただし<b>壁の角を挟んだ斜め</b>は、あなたも敵も攻撃できません（マークも出ません）。壁を背にして斜めから来る敵をいなす、といった立ち回りが鍵になります。</p>
          </Section>

          <Section icon="🏹" title="弓（レンジ武器）">
            <p><b>弓</b>を装備すると、隣接して攻撃するときも<b>STRではなくDEX基準</b>のダメージになり、装備中は足元に薄緑の<b>射程マス（4マス）</b>が表示されます。</p>
            <p>射程内なら隣接しなくても攻撃可能。<b>射程内の敵を直接タップ/クリック</b>するとその敵を狙い撃ちます。マップ右下の <b>🏹</b> ボタンや <Key>Space</Key> キーでもその場から撃てます（向いている方向の敵を優先）。射程内に敵がいないときは🏹ボタンが薄く表示されます。</p>
            <p>バッグに剣と弓の両方があると、🏹ボタンの上に<b>持ち替えボタン（⚔️/🏹）</b>が出ます。ワンタップで最強の異種武器に持ち替え（通常の装備と同じく1ターン消費）。</p>
            <p className="htp-note">敵が隣接する前の本当の遠距離弾には<b>不意打ちボーナス（威力+30%）</b>が乗ります。逆に<b>隣接した敵への弓攻撃は威力半減</b>（近すぎて引き絞れない）。さらに矢を1回放つごとに<b>スタミナを2消費</b>します。「離れて先制するなら弓、詰められたら・スタミナを節約したいなら剣」が使い分けの基本です。命中率は距離が離れるほど下がるので過信は禁物です。</p>
          </Section>

          <Section icon="📊" title="ステータス（6種）">
            <p>レベルアップごとに<b>+5ポイント</b>を獲得し、好きな能力へ自由に割り振れます。何を伸ばすかが個性になります。</p>
            <ul className="htp-list htp-stats">
              <li><Tag c="str">STR</Tag> 攻撃力。1ポイントで火力が大きく伸びる基本ステータス。</li>
              <li><Tag c="agi">AGI</Tag> 攻撃回数。必要値が 50→100→200→400… と倍々で増え、<b>最大8連撃</b>まで伸びる。</li>
              <li><Tag c="dex">DEX</Tag> 命中率（<b>DEX100で100%</b>）。超過分は<b>装甲貫通</b>に変わり、敵の防御を無視するダメージが増える。</li>
              <li><Tag c="vit">VIT</Tag> 防御力。被ダメージを軽減。</li>
              <li><Tag c="int">INT</Tag> 魔法の威力。魔法の書の効果が強まる。</li>
              <li><Tag c="luk">LUK</Tag> 会心率＋幸運。会心の一撃・<b>幸運フロア</b>の出やすさ・<b>フロアの敵の数</b>・🪙コインのドロップ率が上がります。（スロットの<b>当選確率そのものは一定</b>ですが、敵が増え早く倒せるぶん回せる回数は増えます）</li>
            </ul>
          </Section>

          <Section icon="❤️" title="HPとスタミナ">
            <p><b>HP</b>が0になると冒険は終了します。回復はポーション・回復の泉・スロットの当たりなどで。</p>
            <p><b>スタミナ</b>は2ターンに1ずつ減少し、<b>0になるとHPが少しずつ削れます</b>。スタミナポーションや「あるかなひろば」で補給を。空腹で倒れないよう注意しましょう。</p>
          </Section>

          <Section icon="🎒" title="アイテム">
            <p>床に落ちている<b>宝箱を踏む</b>と入手できます。</p>
            <ul className="htp-list">
              <li>💊 <b>ポーション</b> … HPやスタミナを回復（黄・白・赤・スタミナ）</li>
              <li>🧪 <b>灰ポーション</b> … 上位の回復薬。<b>最大HPの50%</b>を回復し、深層ほど頼りになります。ドロップは控えめ（5階以降）</li>
              <li>📖 <b>魔法の書</b> … ファイアボルト・ブレッシング・メテオストームなど（INTで威力UP）</li>
              <li>⚔️ <b>装備品</b> … 7部位に装備して能力強化</li>
              <li>🪙 <b>女神のコイン</b> … 敵撃破時に約20%でドロップ（LUKで最大30%まで上昇）。使うと<b>スロットを1回まわせる</b>幸運の証</li>
            </ul>
          </Section>

          <Section icon="🛡️" title="装備と「あるかなひろば」">
            <p>装備は<b>武器・鎧・肩・靴・指輪×2・お守り</b>の7部位。深い階層ほど強力な装備が眠っています。</p>
            <p><b>5階ごと</b>に休憩所「<b>あるかなひろば</b>」に立ち寄れます。ここでは――</p>
            <ul className="htp-list">
              <li>🔨 <b>精錬</b> … 装備を生贄に、武具を <b>+1, +2…</b> と強化（精錬値が上がるほど成功率ダウン。成功率は精錬画面に表示）</li>
              <li>🌑 <b>影装</b> … ステータスポイントを捧げ、成功で<b>全能力+3</b></li>
              <li>📚 <b>魔法の書</b> … 手持ちの書を別の書と交換</li>
              <li>🛒 <b>行商人</b> … 🪙女神のコインと引き換えに<b>羽アイテム</b>を購入（所持上限あり）</li>
            </ul>
            <p className="htp-note">羽は緊急脱出・仕切り直しに便利です。🪰<b>ハエの羽</b>＝同じ階の<b>階段のそば</b>へワープ／🦋<b>蝶の羽</b>＝<b>今いる階を再生成</b>して仕切り直す（敵やアイテムが配置し直され、経験値やドロップはそのまま得られます）。</p>
          </Section>

          <Section icon="🧩" title="フロアの仕掛け">
            <ul className="htp-list">
              <li>🟦 <b>青いタイル（階段）</b> … 踏むと次の階へ</li>
              <li>🟪 <b>ベノムダスト</b> … 踏むと<b>毒</b>状態に</li>
              <li>🟫 <b>泥の沼</b> … しばらく動きが鈍くなる</li>
              <li>💧 <b>回復の泉</b> … 浸かるとHP回復（枯れることも）</li>
              <li>🕳️ <b>落とし穴</b> … 1〜3階ぶん下の階へ転落！（踏破済みの階では経験値・アイテムは得られません。回復の泉などは通常どおり使えます）</li>
            </ul>
          </Section>

          <Section icon="✨" title="フロアの種類">
            <ul className="htp-list">
              <li><Tag c="normal">通常</Tag> 標準的なフロア。</li>
              <li><Tag c="lucky">幸運</Tag> 不思議な光に包まれ、<b>アイテムが豊富</b>。LUKが高いほど出やすい。</li>
              <li><Tag c="chaos">混沌</Tag> <b>モンスターハウス</b>。敵がひしめく高リスク・高リターン。装備を整えてから挑むのが吉。</li>
            </ul>
          </Section>

          <Section icon="👑" title="ボス">
            <p>節目の階には強敵が待ち受けます。倒せば大量の経験値と、世界に轟く<b>討伐速報</b>が。</p>
            <ul className="htp-list">
              <li><b>MINIボス</b> … 10階ごと</li>
              <li><b>MVPボス</b> … 15階ごとの強敵</li>
              <li><b>エリアボス</b> … 各エリアの主。出現階はゲームごとに変化</li>
            </ul>
          </Section>

          <Section icon="🎰" title="女神の加護（スロット）">
            <p>右側のスロットは、<b>敵を2体倒すごとに1回</b>自動で回転します（🪙女神のコインでも回せます）。出た役で大きな恩恵が――</p>
            <ul className="htp-list htp-slot">
              <li><b className="htp-accent">💰JACKPOT💰</b> … 激レア！ <b>全サーバー共有</b>のプールを<b>総取り</b>してステータスポイントに！（スロット下の金枠カウンターが現在の貯まり額。上限到達は全鯖に速報されます）</li>
              <li><b className="htp-accent">👊阿修羅覇王拳👊</b> … 超大当たり！ Lv+10・HP/STA上限+10%・<b>全ての敵が消滅</b></li>
              <li><b>✨女神の加護✨</b> … 同じ絵柄が3つ。HP/スタミナ全回復＋<b>装備3個</b>獲得</li>
              <li><b>🎁女神からのプレゼント🎁</b> … ランダムな装備品をプレゼント</li>
              <li><b>💚ヒール💚</b> … 最大HPの半分を回復</li>
              <li><b>⚡マグニフィカート⚡</b> … スタミナを半分回復</li>
              <li><b className="htp-warn">👻ゴスリンの呪い👻</b> … お化けが3つそろうとHPが半分に（要注意）</li>
              <li><b className="htp-warn">💀痛恨の一撃を受けた💀</b> … ハズレ。まれに毒やスタミナ減少</li>
              <li><b className="htp-accent">🌌アルカナチャンス🌌</b> … 激レア演出！ 専用ルーレットで<b>大量ステータスポイント</b>獲得チャンス</li>
            </ul>
            <p className="htp-note"><b>AUTO / MANUAL</b> の切替や、回転待ちの<b>ストック</b>も。コインを貯めて勝負どころで一気に回すのも作戦です。</p>
          </Section>

          <Section icon="🌐" title="ワールド通知と名前">
            <p>世界中の冒険者のボス討伐や到達記録が、画面上部に<b>リアルタイム</b>で流れます。あなたの活躍も世界へ配信されます。</p>
            <p>流れてきた通知には <b className="htp-accent">「いいね！」</b> を送れます。送った人・受け取った人の<b>双方に通知</b>が届き、運が良ければ<b>アイテム報酬</b>も。冒険者どうしの交流機能です（1日の上限を超えても、いいね自体はいつでも送れます）。</p>
            <p>タイトル画面の<b>名前枠</b>から、いつでも表示名を設定・変更できます（任意）。</p>
          </Section>

          <Section icon="🏆" title="ランキング">
            <p>力尽きた後、名前を登録して<b>到達階層ランキング（TOP30）</b>に挑戦できます。一覧は<b>スクロール</b>で見られ、自分の記録は強調表示されます。</p>
            <p>順位には到達階・レベルに加えて、そのプレイでの <b className="htp-accent">🔨全身の精錬値合計</b> と <b className="htp-accent">💰ジャックポット当選回数</b> も記録・表示されます。深く潜るだけでなく、装備を鍛え・幸運を掴んだ証も残せます。</p>
          </Section>

          <Section icon="💾" title="セーブ（オートセーブ＆クラウドセーブ）">
            <p>セーブは<b>2種類</b>。目的に合わせて使い分けましょう。</p>
            <ul className="htp-list">
              <li><b>オートセーブ（この端末用）</b> … 階を進むたびに<b>自動保存</b>。タイトルの <b>GAME START</b> →「続きから」で再開できます。<b>SETTINGS</b> でON/OFF可（初期ON）。この端末のブラウザ内に保存され、他の端末へは引き継げません。</li>
              <li><b>クラウドセーブ（端末を問わない）</b> … プレイ中の <b>セーブ</b> ボタンで <b>名前＋パスワード</b> を決めて保存。別の端末でもタイトルの <b>「クラウド再開」</b> から同じ名前・パスワードで続けられます。機種変更やスマホ↔PCの引き継ぎに便利です。</li>
            </ul>
            <p className="htp-note">⚠️ 大切なルール：<b>パスワードは復旧できません</b>（必ず控えてください）。<b className="htp-warn">ゲームオーバーになると、オート・クラウドの両方のセーブが消え、復活はできません</b>（ランキングの公平性を保つための仕様です）。また<b>再開した時点でセーブは使い切られ</b>、同じ場所へ何度も戻ることはできません。クラウドの名前は<b>自分だけが使う固有の名前</b>にしてください（同じ名前を別のパスワードで上書きすることはできません）。</p>
          </Section>

          <Section icon="💡" title="初心者へのヒント">
            <ul className="htp-list">
              <li>序盤は <Tag c="vit">VIT</Tag> と <Tag c="str">STR</Tag> を中心に伸ばすと安定します。</li>
              <li><b>スタミナ管理</b>を忘れずに。無駄な往復を減らし、補給を切らさないこと。</li>
              <li><b>斜め攻撃</b>を活用すれば、囲まれても一体ずつ確実に削れます。</li>
              <li><b>混沌フロア</b>は装備とHPを整えてから。引き返す勇気も大切です。</li>
              <li>気に入った武器は<b>精錬</b>で育て、長く相棒にしましょう。</li>
            </ul>
          </Section>

          <p className="htp-outro">
            さあ、女神の加護とともに、未知なる深層へ。<br />
            あなたの冒険に、幸運がありますように。✦
          </p>

          <button className="htp-bottom-close" onClick={() => setOpen(false)}>とじる</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="htp-section">
      <h3 className="htp-h"><span className="htp-h-icon">{icon}</span>{title}</h3>
      {children}
    </section>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="htp-key">{children}</kbd>
}

function Tag({ c, children }: { c: string; children: React.ReactNode }) {
  return <span className={`htp-tag htp-tag-${c}`}>{children}</span>
}
