import { CandlestickData, Time } from 'lightweight-charts'

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
  interval: string = '15m',
  limit: number = 1000,
  endTime?: number
): Promise<CandlestickData<Time>[]> {
  try {
    let url = `${BINANCE_API_BASE}?symbol=BTCUSDT&interval=${interval}&limit=${limit}`
    if (endTime) {
      url += `&endTime=${endTime}`
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
