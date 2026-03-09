import { CandlestickData, Time } from 'lightweight-charts'
import { candleCache } from './candleCache'

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '4h': 14400, '1d': 86400,
}

export interface BinanceKline {
  0: number
  1: string
  2: string
  3: string
  4: string
  5: string
  6: number
  7: string
  8: number
  9: number
  10: string
  11: string
}

const BINANCE_API_BASE = 'https://api.binance.com/api/v3/klines'

export async function fetchBitcoinCandlesticks(
  interval: string = '5m',
  limit: number = 1000,
  endTime?: number,
  startTime?: number,
  symbol: string = 'BTCUSDT'
): Promise<CandlestickData<Time>[]> {
  try {
    let url = `${BINANCE_API_BASE}?symbol=${symbol}&interval=${interval}&limit=${limit}`
    if (endTime) {
      url += `&endTime=${endTime}`
    }
    if (startTime) {
      url += `&startTime=${startTime}`
    }

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data: BinanceKline[] = await response.json()

    return data.map((kline) => ({
      time: Math.floor(kline[0] / 1000) as Time,
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
    }))
  } catch (error) {
    console.error('Error fetching candlestick data:', error)
    throw error
  }
}

// Wrapper con caché local (IndexedDB). Solo aplica cuando se especifica endTime o startTime,
// ya que las peticiones sin límite temporal siempre deben traer datos frescos del presente.
export async function fetchCandlesWithCache(
  interval: string = '5m',
  limit: number = 1000,
  endTime?: number,
  startTime?: number,
  symbol: string = 'BTCUSDT'
): Promise<CandlestickData<Time>[]> {
  const intervalSec = INTERVAL_SECONDS[interval] ?? 300

  if (endTime || startTime) {
    const endSec = endTime ? Math.floor(endTime / 1000) : undefined
    const startSec = startTime ? Math.floor(startTime / 1000) : undefined
    const rangeEnd = endSec ?? (startSec! + (limit - 1) * intervalSec)
    const rangeStart = startSec ?? (endSec! - (limit - 1) * intervalSec)

    const cached = await candleCache.getCandles(symbol, interval, rangeStart, rangeEnd)
    if (cached.length >= limit * 0.95) {
      return cached.sort((a, b) => (a.time as number) - (b.time as number))
    }
  }

  const data = await fetchBitcoinCandlesticks(interval, limit, endTime, startTime, symbol)
  candleCache.storeCandles(symbol, interval, data).catch(() => {})
  return data
}
