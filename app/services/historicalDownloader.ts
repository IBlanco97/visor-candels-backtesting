import { fetchBitcoinCandlesticks } from './binance'
import { candleCache } from './candleCache'

export const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '4h': 14400, '1d': 86400,
}

const BATCH_SIZE = 1000
const REQUEST_DELAY_MS = 180
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 2000

const META_KEY = 'bitcoin-trader-dl-meta'

export interface DownloadMeta {
  symbol: string
  interval: string
  fromSec: number
  toSec: number
  downloadedAt: number
  totalCandles: number
}

export interface DownloadProgress {
  symbol: string
  interval: string
  done: number
  total: number
  phase: 'downloading' | 'done' | 'cancelled' | 'error'
  error?: string
}

export function getAllMeta(): DownloadMeta[] {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '[]')
  } catch {
    return []
  }
}

function saveMeta(meta: DownloadMeta[]): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

export function getMeta(symbol: string, interval: string): DownloadMeta | undefined {
  return getAllMeta().find(m => m.symbol === symbol && m.interval === interval)
}

export function deleteMeta(symbol: string, interval: string): void {
  saveMeta(getAllMeta().filter(m => !(m.symbol === symbol && m.interval === interval)))
}

export interface CacheRange {
  earliest: number | null  // oldest candle time (sec) in IndexedDB
  latest: number | null    // newest candle time (sec) in IndexedDB
}

/** Queries IndexedDB directly for the actual stored range — source of truth. */
export async function getActualCacheRange(symbol: string, interval: string): Promise<CacheRange> {
  const [earliest, latest] = await Promise.all([
    candleCache.getEarliestCandleTime(symbol, interval),
    candleCache.getLatestCandleTime(symbol, interval),
  ])
  return { earliest, latest }
}

/** Estimated number of candles from a given start to now for a given interval */
export function estimateCandles(interval: string, fromSec: number): number {
  const intervalSec = INTERVAL_SECONDS[interval] ?? 300
  const nowSec = Math.floor(Date.now() / 1000)
  return Math.max(0, Math.ceil((nowSec - fromSec) / intervalSec))
}

/** Estimated download time in seconds, accounting for already-downloaded data */
export function estimateSeconds(interval: string, fromSec: number, alreadyDownloaded?: DownloadMeta): number {
  const intervalSec = INTERVAL_SECONDS[interval] ?? 300
  const nowSec = Math.floor(Date.now() / 1000)
  // Resume from existing.toSec only if existing covers fromSec already
  const effectiveFrom = (alreadyDownloaded && alreadyDownloaded.fromSec <= fromSec)
    ? alreadyDownloaded.toSec
    : fromSec
  const remaining = Math.max(0, nowSec - effectiveFrom)
  const batches = Math.ceil(remaining / (BATCH_SIZE * intervalSec))
  return Math.ceil((batches * REQUEST_DELAY_MS) / 1000)
}

export async function downloadHistoricalData(
  symbol: string,
  interval: string,
  fromSec: number,
  onProgress: (p: DownloadProgress) => void,
  cancelRef: { cancelled: boolean }
): Promise<void> {
  const intervalSec = INTERVAL_SECONDS[interval] ?? 300
  const nowSec = Math.floor(Date.now() / 1000)

  // Use actual IndexedDB range as source of truth
  const { earliest: earliestCached, latest: latestCached } = await getActualCacheRange(symbol, interval)
  const existing = getMeta(symbol, interval)
  const totalCandlesSoFar = existing?.totalCandles ?? 0

  // If fromSec is before the earliest cached candle, there's a gap at the start.
  // In that case, start from fromSec to fill the gap (existing data will be overwritten idempotently).
  // Otherwise, resume from the latest cached candle to avoid re-downloading.
  const hasStartGap = earliestCached !== null && fromSec < earliestCached
  const downloadFromSec = hasStartGap
    ? fromSec
    : latestCached
    ? Math.max(latestCached, fromSec)
    : fromSec

  const remaining = nowSec - downloadFromSec
  const totalBatches = Math.ceil(remaining / (BATCH_SIZE * intervalSec))

  if (totalBatches <= 0) {
    onProgress({ symbol, interval, done: 1, total: 1, phase: 'done' })
    return
  }

  let done = 0
  let currentSec = downloadFromSec
  let accumulatedCandles = totalCandlesSoFar

  onProgress({ symbol, interval, done: 0, total: totalBatches, phase: 'downloading' })

  while (currentSec < nowSec) {
    if (cancelRef.cancelled) {
      onProgress({ symbol, interval, done, total: totalBatches, phase: 'cancelled' })
      return
    }

    const batchEndSec = Math.min(currentSec + BATCH_SIZE * intervalSec, nowSec)

    let retries = 0
    let batchDone = false
    while (!batchDone) {
      try {
        const candles = await fetchBitcoinCandlesticks(
          interval,
          BATCH_SIZE,
          batchEndSec * 1000,
          currentSec * 1000,
          symbol
        )
        if (candles.length > 0) {
          await candleCache.storeCandles(symbol, interval, candles)
          accumulatedCandles += candles.length
        }
        batchDone = true
      } catch (err) {
        const isNetworkError = err instanceof TypeError && err.message.includes('fetch')
        if (isNetworkError) {
          // Sin internet — parar limpiamente; el resume continuará desde aquí
          onProgress({ symbol, interval, done, total: totalBatches, phase: 'error', error: 'Sin conexión. Reconecta y pulsa Descargar para continuar desde este punto.' })
          return
        }
        retries++
        if (retries > MAX_RETRIES) {
          onProgress({ symbol, interval, done, total: totalBatches, phase: 'error', error: `Error tras ${MAX_RETRIES} reintentos: ${String(err)}` })
          return
        }
        // Error de servidor (rate limit, 5xx) — esperar y reintentar
        await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * retries))
      }
    }

    currentSec = batchEndSec
    done++

    // Persist metadata incrementally so resume works if interrupted
    const meta = getAllMeta().filter(m => !(m.symbol === symbol && m.interval === interval))
    meta.push({
      symbol,
      interval,
      fromSec,
      toSec: currentSec,
      downloadedAt: Date.now(),
      totalCandles: accumulatedCandles,
    })
    saveMeta(meta)

    onProgress({
      symbol,
      interval,
      done,
      total: totalBatches,
      phase: done >= totalBatches ? 'done' : 'downloading',
    })

    if (currentSec < nowSec && done < totalBatches) {
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS))
    }
  }
}
