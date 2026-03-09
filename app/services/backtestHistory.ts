import type { BacktestConfig, BacktestSummary, BacktestTrade, EquityPoint } from './backtestEngine'

export interface SavedBacktest {
  id: string
  name: string        // auto-generated: "15/01/25 → 20/01/25 · TP1% SL1% LONG"
  savedAt: number     // Date.now()
  config: BacktestConfig
  summary: BacktestSummary
  startTimeSec: number
  endTimeSec?: number  // undefined = ran until present
}

// ─── IndexedDB setup ─────────────────────────────────────────────────────────

const DB_NAME    = 'bitcoin-trader-backtest-db'
const DB_VERSION = 1
const STORE_NAME = 'backtests'
const ACTIVE_KEY = 'bitcoin-trader-backtest-summary'
const MAX_SAVED  = 20

let _db: IDBDatabase | null = null
let _openPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  if (_openPromise) return _openPromise

  _openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    req.onsuccess = e => {
      _db = (e.target as IDBOpenDBRequest).result
      resolve(_db)
    }

    req.onerror = e => reject((e.target as IDBOpenDBRequest).error)
  })

  return _openPromise
}

// ─── equityCurve recomputation ───────────────────────────────────────────────

function recomputeEquityCurve(trades: BacktestTrade[]): EquityPoint[] {
  let cumulative = 0
  return trades.map(t => {
    cumulative += t.pnlPct
    return { time: t.exitTime, value: +cumulative.toFixed(4) }
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns all saved backtests sorted newest-first (equityCurve recomputed from trades). */
export async function loadHistory(): Promise<SavedBacktest[]> {
  try {
    const db = await openDB()
    const list = await new Promise<SavedBacktest[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve(req.result as SavedBacktest[])
      req.onerror  = () => reject(req.error)
    })
    return list
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(entry => ({
        ...entry,
        summary: { ...entry.summary, equityCurve: recomputeEquityCurve(entry.summary.trades) },
      }))
  } catch {
    return []
  }
}

/** Saves a new backtest run, returns the new entry (with equityCurve recomputed). */
export async function saveBacktest(
  config: BacktestConfig,
  summary: BacktestSummary,
  startTimeSec: number,
  endTimeSec?: number,
): Promise<SavedBacktest> {
  const fmt = (sec: number) =>
    new Date(sec * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const dateStr = fmt(startTimeSec)
  const endStr  = endTimeSec ? ` → ${fmt(endTimeSec)}` : ''
  const trigger = config.triggerPrice ? ` @${config.triggerPrice}` : ''
  const name    = `${dateStr}${endStr}${trigger} · TP${config.tpPct}% SL${config.slPct}% ${config.initialDirection.toUpperCase()}`

  // Strip equityCurve before storing — recomputed on load
  const toStore: SavedBacktest = {
    id: `bt-${Date.now()}`,
    name,
    savedAt: Date.now(),
    config,
    summary: { ...summary, equityCurve: [] },
    startTimeSec,
    ...(endTimeSec !== undefined ? { endTimeSec } : {}),
  }

  const db = await openDB()

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(toStore)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })

  // Prune entries beyond MAX_SAVED
  await pruneOldEntries(db)

  const entry = { ...toStore, summary: { ...toStore.summary, equityCurve: recomputeEquityCurve(summary.trades) } }
  setActiveBacktest(entry)
  return entry
}

async function pruneOldEntries(db: IDBDatabase): Promise<void> {
  try {
    const all = await new Promise<SavedBacktest[]>((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve(req.result as SavedBacktest[])
      req.onerror   = () => reject(req.error)
    })

    const toDelete = all.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_SAVED)
    if (toDelete.length === 0) return

    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      toDelete.forEach(e => store.delete(e.id))
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  } catch { /* ignore */ }
}

/** Removes a saved backtest by id. */
export async function deleteBacktest(id: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  } catch { /* ignore */ }
}

/** Sets the "active" backtest shown in the analysis page (tiny pointer only). */
export function setActiveBacktest(entry: SavedBacktest): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ _id: entry.id }))
  } catch { /* ignore */ }
}

/** Returns the id stored in the active slot, if any. */
export function getActiveId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY)
    if (!raw) return null
    return JSON.parse(raw)._id ?? null
  } catch {
    return null
  }
}
