import { CandlestickData, Time } from 'lightweight-charts'
import { fetchCandlesWithCache } from './binance'

export type BacktestDirection = 'long' | 'short'
export type BacktestResult = 'tp' | 'sl'

export interface BacktestTrade {
  id: string
  direction: BacktestDirection
  entryPrice: number
  entryTime: number   // unix seconds
  exitPrice: number
  exitTime: number    // unix seconds
  result: BacktestResult
  pnlPct: number      // directional % P&L (positive = profit)
  tpPrice: number     // exact TP level used for this trade
  slPrice: number     // exact SL level used for this trade
}

export interface BacktestConfig {
  startTime: number           // unix seconds
  tpPct: number               // e.g. 1.0 for 1%
  slPct: number               // e.g. 1.0 for 1%
  initialDirection: BacktestDirection
}

export interface EquityPoint {
  time: number   // unix seconds (exitTime of each trade)
  value: number  // cumulative P&L %
}

export interface BacktestSummary {
  trades: BacktestTrade[]
  totalPnlPct: number
  winCount: number
  lossCount: number
  winRate: number             // 0–100
  maxDrawdown: number         // most negative cumulative drop (e.g. -5.3)
  maxRunup: number            // largest cumulative rise from a trough (e.g. +8.2)
  equityCurve: EquityPoint[]  // cumulative P&L % over time
}

const INTERVAL = '5m'
const INTERVAL_SEC = 300
const CANDLES_PER_BATCH = 1000
// Conservative delay between API batches. Binance klines costs 2 weight/call,
// limit is ~1200 weight/min — 300 ms gives ~3 calls/s, well within limits.
// IndexedDB cache makes subsequent runs free.
const BATCH_DELAY_MS = 300

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * Fetches all 5-minute candles from startTimeSec to endTimeSec in batches of
 * 1000, respecting rate limits via BATCH_DELAY_MS. Uses IndexedDB cache so
 * repeated calls for the same range skip the network entirely.
 */
export async function fetchCandlesForBacktest(
  startTimeSec: number,
  endTimeSec: number,
  onProgress?: (fetched: number, total: number) => void,
): Promise<CandlestickData<Time>[]> {
  const totalCandles = Math.ceil((endTimeSec - startTimeSec) / INTERVAL_SEC) + 1
  const allCandles: CandlestickData<Time>[] = []
  let currentStartSec = startTimeSec
  let fetchedSoFar = 0

  while (currentStartSec <= endTimeSec) {
    if (allCandles.length > 0) await sleep(BATCH_DELAY_MS)

    const candles = await fetchCandlesWithCache(
      INTERVAL,
      CANDLES_PER_BATCH,
      undefined,
      currentStartSec * 1000, // fetchCandlesWithCache expects milliseconds
    )

    if (candles.length === 0) break

    allCandles.push(...candles)
    fetchedSoFar += candles.length
    onProgress?.(Math.min(fetchedSoFar, totalCandles), totalCandles)

    const lastTime = candles[candles.length - 1].time as number
    currentStartSec = lastTime + INTERVAL_SEC
    if (lastTime >= endTimeSec) break
  }

  // Deduplicate, filter to range, sort
  const seen = new Set<number>()
  return allCandles
    .filter(c => {
      const t = c.time as number
      if (seen.has(t)) return false
      seen.add(t)
      return t >= startTimeSec && t <= endTimeSec
    })
    .sort((a, b) => (a.time as number) - (b.time as number))
}

/**
 * Pure backtest engine. Given sorted OHLC candles and a config, chains TP/SL
 * trades one after another until the last candle is consumed.
 *
 * Direction logic (matches reversalStrategy):
 *   TP hit → next trade opens in the SAME direction
 *   SL hit → next trade opens in the OPPOSITE direction
 *
 * When both TP and SL fall within a single candle's [low, high] range (and the
 * candle open did not gap past either level), the level closer to the open is
 * assumed to have been hit first — a standard OHLC backtest approximation.
 */
export function runBacktest(
  candles: CandlestickData<Time>[],
  config: BacktestConfig,
): BacktestSummary {
  const { tpPct, slPct, initialDirection } = config

  // Find the first candle at or after startTime
  const startIdx = candles.findIndex(c => (c.time as number) >= config.startTime)
  if (startIdx === -1 || startIdx >= candles.length - 1) {
    return { trades: [], totalPnlPct: 0, winCount: 0, lossCount: 0, winRate: 0, maxDrawdown: 0, maxRunup: 0, equityCurve: [] }
  }

  const trades: BacktestTrade[] = []
  let direction: BacktestDirection = initialDirection
  let entryPrice = candles[startIdx].open
  let entryTime = candles[startIdx].time as number
  // Start scanning from the entry candle itself (open is the entry price)
  let scanFrom = startIdx

  while (scanFrom < candles.length) {
    const tpPrice =
      direction === 'long'
        ? entryPrice * (1 + tpPct / 100)
        : entryPrice * (1 - tpPct / 100)
    const slPrice =
      direction === 'long'
        ? entryPrice * (1 - slPct / 100)
        : entryPrice * (1 + slPct / 100)

    let exitResult: BacktestResult | null = null
    let exitTime = 0
    let exitPrice = 0

    for (let j = scanFrom; j < candles.length; j++) {
      const { open, high, low } = candles[j]

      let tpHit = false
      let slHit = false

      if (direction === 'long') {
        if (open >= tpPrice) {
          tpHit = true // gap up: TP hit immediately at open
        } else if (open <= slPrice) {
          slHit = true // gap down: SL hit immediately at open
        } else {
          tpHit = high >= tpPrice
          slHit = low <= slPrice
        }
      } else {
        // SHORT
        if (open <= tpPrice) {
          tpHit = true // gap down: TP hit immediately at open
        } else if (open >= slPrice) {
          slHit = true // gap up: SL hit immediately at open
        } else {
          tpHit = low <= tpPrice
          slHit = high >= slPrice
        }
      }

      if (tpHit || slHit) {
        exitTime = candles[j].time as number

        if (tpHit && slHit) {
          // Ambiguous same-candle hit: assume the level nearer to the candle
          // open was reached first
          const distToTp = Math.abs(open - tpPrice)
          const distToSl = Math.abs(open - slPrice)
          exitResult = distToTp <= distToSl ? 'tp' : 'sl'
        } else {
          exitResult = tpHit ? 'tp' : 'sl'
        }

        exitPrice = exitResult === 'tp' ? tpPrice : slPrice
        // Next trade starts scanning from the candle AFTER the exit candle
        scanFrom = j + 1
        break
      }
    }

    if (!exitResult) break // Ran out of candles without hitting either level

    const pnlPct =
      direction === 'long'
        ? ((exitPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - exitPrice) / entryPrice) * 100

    trades.push({
      id: `bt-${entryTime}-${direction}`,
      direction,
      entryPrice,
      entryTime,
      exitPrice,
      exitTime,
      result: exitResult,
      pnlPct,
      tpPrice,
      slPrice,
    })

    // Chain: next entry at the exact exit level
    entryPrice = exitPrice
    entryTime = exitTime

    // TP → same direction; SL → reverse
    if (exitResult === 'sl') {
      direction = direction === 'long' ? 'short' : 'long'
    }
  }

  const winCount = trades.filter(t => t.result === 'tp').length
  const lossCount = trades.filter(t => t.result === 'sl').length
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0)
  const winRate = trades.length > 0 ? (winCount / trades.length) * 100 : 0

  // Equity curve, max drawdown, max runup
  const equityCurve: EquityPoint[] = []
  let cumulative = 0
  let peak = 0
  let trough = 0
  let maxDrawdown = 0
  let maxRunup = 0
  for (const trade of trades) {
    cumulative += trade.pnlPct
    equityCurve.push({ time: trade.exitTime, value: parseFloat(cumulative.toFixed(4)) })
    if (cumulative > peak) peak = cumulative
    if (cumulative < trough) trough = cumulative
    const dd = cumulative - peak
    const ru = cumulative - trough
    if (dd < maxDrawdown) maxDrawdown = dd
    if (ru > maxRunup) maxRunup = ru
  }

  return { trades, totalPnlPct, winCount, lossCount, winRate, maxDrawdown, maxRunup, equityCurve }
}
