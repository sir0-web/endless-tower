import { useEffect, useRef, useState } from 'react'

function useFacilityOpen(kind: 'junk' | 'toolshop', onForceClose?: () => void) {
  const [open, setOpen] = useState(false)
  const forceCloseRef = useRef(onForceClose)
  useEffect(() => { forceCloseRef.current = onForceClose })
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail === kind) setOpen(true)
    }
    // ゲームオーバー等でシーンが変わったら内部状態ごと強制クローズ
    const onSceneChanged = () => {
      forceCloseRef.current?.()
      setOpen(false)
    }
    window.addEventListener('facility-open', onOpen)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('facility-open', onOpen)
      window.removeEventListener('game-scene-changed', onSceneChanged)
    }
  }, [kind])
  return [open, setOpen] as const
}

// ── がらくたNPC：いらない装備をコインに変換 ──
export function JunkModal() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const reset = () => { setSelectedId(null); setMsg(null) }
  // 強制クローズ（シーン遷移）時も reset を通し、次回開いたとき途中画面から始まらないようにする
  const [open, setOpen] = useFacilityOpen('junk', reset)
  const close = () => { reset(); setOpen(false) }

  if (!open) return null

  const bag = window.gameState?.bag ?? []
  const heals = window.gameState?.heals ?? []
  const coins = heals.filter(h => h.coin).length
  const candidates = bag.filter(i => i.type === 'equip' && !i.locked)

  const convert = () => {
    if (!selectedId) return
    const item = candidates.find(i => i.id === selectedId)
    const r = window.runJunkConvert?.(selectedId) ?? null
    if (r?.ok) {
      setMsg(`${item?.name ?? 'アイテム'}を換金し コイン+${r.coins ?? 0}枚！`)
    } else {
      setMsg('換金できなかった...')
    }
    setSelectedId(null)
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {!msg && (
          <>
            <p className="facility-title">♻️がらくた屋♻️</p>
            <p className="facility-desc">
              いらない装備をコインに換えます。ロック中の装備は換金できません。
            </p>
            <p className="facility-sub">所持コイン：🪙 {coins}</p>
            <div className="facility-list">
              {candidates.length === 0 && <p className="facility-empty">換金できる装備がありません</p>}
              {candidates.map(item => (
                <button
                  key={item.id}
                  className={`facility-item${selectedId === item.id ? ' selected' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="fi-name">{item.name}</span>
                  {!!item.refineLevel && <span className="fi-refine">+{item.refineLevel}</span>}
                </button>
              ))}
            </div>
            <div className="facility-btns">
              <button className="facility-go-btn" disabled={!selectedId} onClick={convert}>コインに換える</button>
              <button className="facility-close-btn" onClick={close}>とじる</button>
            </div>
          </>
        )}

        {msg && (
          <div className="facility-result">
            <p className="facility-result-sub">{msg}</p>
            <div className="facility-btns">
              {/* 話しかけ直さなくても連続で換金できるよう、一覧へ戻る動線を用意する */}
              <button className="facility-go-btn" onClick={() => setMsg(null)}>つづける</button>
              <button className="facility-close-btn" onClick={close}>とじる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── どうぐやNPC：回復薬をコインで購入 ──
export function ToolShopModal() {
  const [, setTick] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)

  // 強制クローズ（シーン遷移）時もメッセージが残らないようリセットを渡す
  const [open, setOpen] = useFacilityOpen('toolshop', () => setMsg(null))
  const close = () => { setMsg(null); setOpen(false) }

  useEffect(() => {
    if (!open) return
    const onUpdate = () => setTick(t => t + 1)
    window.addEventListener('gamestate-update', onUpdate)
    return () => window.removeEventListener('gamestate-update', onUpdate)
  }, [open])

  if (!open) return null

  const heals = window.gameState?.heals ?? []
  const coins = heals.filter(h => h.coin).length
  const items = window.getToolShopItems?.() ?? []

  const buy = (key: string) => {
    const item = items.find(i => i.key === key)
    const r = window.buyToolItem?.(key)
    if (!r) return
    if (r.ok) {
      setMsg(`${item?.name ?? 'アイテム'}を購入した！`)
    } else if (r.reason === 'coin') {
      setMsg('女神のコインが足りません…')
    } else if (r.reason === 'limit') {
      setMsg('これ以上は持てません')
    }
    setTick(t => t + 1)
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        <p className="facility-title">🏪どうぐや🏪</p>
        <p className="facility-desc">
          女神のコインで回復薬などを購入できます。
        </p>
        <p className="facility-sub">所持コイン：🪙 {coins}</p>
        <div className="facility-list">
          {items.length === 0 && <p className="facility-empty">商品がありません</p>}
          {items.map(it => {
            const disabled = coins < it.cost
            return (
              <div key={it.key} className="facility-item" style={{ alignItems: 'center', gap: 8 }}>
                <span className="fi-name" style={{ flex: 1 }}>
                  {it.icon} {it.name} <span style={{ opacity: 0.7 }}>（🪙{it.cost}）</span>
                  <br /><span className="facility-empty" style={{ fontSize: '0.8em' }}>{it.desc}</span>
                </span>
                <button className="facility-go-btn" disabled={disabled} onClick={() => buy(it.key)}>
                  🪙{it.cost}で購入
                </button>
              </div>
            )
          })}
        </div>
        {msg && <p className="facility-sub">{msg}</p>}
        <div className="facility-btns">
          <button className="facility-close-btn" onClick={close}>とじる</button>
        </div>
      </div>
    </div>
  )
}

// ── 牢屋の柵を開錠 ──
type JailState = { npcName: string; bagEquips: { id: string; name: string }[]; coins: number; statPoints: number }

export function JailUnlockModal() {
  const [state, setState] = useState<JailState | null>(null)
  const [mode, setMode] = useState<'main' | 'equip-select' | 'result'>('main')
  const [sacrificeId, setSacrificeId] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string; broke?: boolean } | null>(null)

  const reset = () => { setState(null); setMode('main'); setSacrificeId(null); setResult(null) }

  useEffect(() => {
    const onOpen = () => {
      const s = window.getJailUnlockState?.() ?? null
      if (!s) return
      setState(s)
      setMode('main')
      setSacrificeId(null)
      setResult(null)
    }
    const onSceneChanged = () => reset()
    window.addEventListener('jail-open', onOpen)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('jail-open', onOpen)
      window.removeEventListener('game-scene-changed', onSceneChanged)
    }
  }, [])

  const close = () => reset()

  if (!state) return null

  const refresh = () => {
    const s = window.getJailUnlockState?.() ?? null
    setState(s)
  }

  const attempt = (method: 'equip' | 'coin' | 'point', id?: string) => {
    const r = window.tryJailUnlock?.(method, id) ?? null
    if (!r) return
    setResult(r)
    setMode('result')
    if (!r.ok) {
      refresh()
    }
  }

  const retryFromResult = () => {
    setResult(null)
    setSacrificeId(null)
    setMode('main')
  }

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        {mode === 'main' && (
          <>
            <p className="facility-title">🔓牢屋🔓</p>
            <p className="facility-desc">
              囚われた {state.npcName} を助け出そう！
            </p>
            <p className="facility-sub">所持コイン：🪙 {state.coins}／ボーナスポイント：{state.statPoints}</p>
            <div className="facility-btns" style={{ flexDirection: 'column' }}>
              <button
                className="facility-go-btn"
                disabled={state.bagEquips.length === 0}
                title={state.bagEquips.length === 0 ? '装備が必要' : undefined}
                onClick={() => setMode('equip-select')}
              >
                いらない装備でこじ開ける
              </button>
              <button
                className="facility-go-btn"
                disabled={state.coins < 3}
                onClick={() => attempt('coin')}
              >
                女神のコイン3枚で開錠
              </button>
              <button
                className="facility-go-btn"
                disabled={state.statPoints < 5}
                onClick={() => attempt('point')}
              >
                ステータスポイント5で開錠
              </button>
              <button className="facility-close-btn" onClick={close}>あきらめる</button>
            </div>
          </>
        )}

        {mode === 'equip-select' && (
          <>
            <p className="facility-title">🔓牢屋🔓</p>
            <p className="facility-desc">生贄に捧げる装備を選んでください。</p>
            <div className="facility-list">
              {state.bagEquips.length === 0 && <p className="facility-empty">装備がありません</p>}
              {state.bagEquips.map(item => (
                <button
                  key={item.id}
                  className={`facility-item${sacrificeId === item.id ? ' selected' : ''}`}
                  onClick={() => setSacrificeId(item.id)}
                >
                  <span className="fi-name">{item.name}</span>
                </button>
              ))}
            </div>
            <div className="facility-btns">
              <button
                className="facility-go-btn"
                disabled={!sacrificeId}
                onClick={() => attempt('equip', sacrificeId ?? undefined)}
              >
                こじ開ける
              </button>
              <button className="facility-close-btn" onClick={() => { setSacrificeId(null); setMode('main') }}>もどる</button>
            </div>
          </>
        )}

        {mode === 'result' && result && (
          <div className="facility-result">
            <p className={`facility-result-text ${result.ok ? 'fr-success' : 'fr-failure'}`}>
              {result.ok ? 'success!!' : 'failure...'}
            </p>
            <p className="facility-result-sub">{result.message}</p>
            <div className="facility-btns">
              {result.ok ? (
                <button className="facility-close-btn" onClick={close}>閉じる</button>
              ) : (
                <>
                  <button className="facility-go-btn" onClick={retryFromResult}>もう一度挑戦する</button>
                  <button className="facility-close-btn" onClick={close}>あきらめる</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 広場の掲示板：捜し人（住人救済）一覧 ──
export function SearchListModal() {
  const [list, setList] = useState<{ person: string; role: string; rescued: boolean }[] | null>(null)

  useEffect(() => {
    const onOpen = () => setList(window.getRescueList?.() ?? null)
    const onSceneChanged = () => setList(null)
    window.addEventListener('signboard-open', onOpen)
    window.addEventListener('game-scene-changed', onSceneChanged)
    return () => {
      window.removeEventListener('signboard-open', onOpen)
      window.removeEventListener('game-scene-changed', onSceneChanged)
    }
  }, [])

  if (!list) return null
  const close = () => setList(null)
  const rescuedCount = list.filter(l => l.rescued).length

  return (
    <div className="facility-overlay">
      <div className="facility-modal">
        <p className="facility-title">📋 捜し人一覧</p>
        <p className="facility-sub">救助済み：{rescuedCount} / {list.length}</p>
        <div className="facility-list">
          {list.map(l => (
            <div key={l.person} className="facility-item" style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between' }}>
              <span>{l.person}</span>
              <span style={{ color: l.rescued ? '#7CFC7C' : '#aaa' }}>
                {l.rescued ? `救助済み（職業：${l.role}）` : '捜索中'}
              </span>
            </div>
          ))}
        </div>
        <div className="facility-btns">
          <button className="facility-close-btn" onClick={close}>とじる</button>
        </div>
      </div>
    </div>
  )
}
