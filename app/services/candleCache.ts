import { CandlestickData, Time } from 'lightweight-charts'

const DB_NAME = 'bitcoin-trader-cache'
const DB_VERSION = 1
const STORE_NAME = 'candles_BTCUSDT_5m'

type CandleRecord = CandlestickData<Time> & { volume?: number }

class CandleCache {
  private db: IDBDatabase | null = null
  private openPromise: Promise<void> | null = null

  async open(): Promise<void> {
    if (this.db) return
    if (this.openPromise) {
      await this.openPromise
      return
    }

    this.openPromise = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'time' })
        }
      }

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve()
      }

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error)
      }
    })

    return this.openPromise
  }

  async getCandles(startTimeSec: number, endTimeSec: number): Promise<CandleRecord[]> {
    try {
      await this.open()
      if (!this.db) return []

      return new Promise<CandleRecord[]>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const range = IDBKeyRange.bound(startTimeSec, endTimeSec)
        const request = store.getAll(range)

        request.onsuccess = () => resolve((request.result as CandleRecord[]) || [])
        request.onerror = () => reject(request.error)
      })
    } catch {
      return []
    }
  }

  async storeCandles(candles: CandleRecord[]): Promise<void> {
    if (candles.length === 0) return
    try {
      await this.open()
      if (!this.db) return

      return new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        candles.forEach((candle) => store.put(candle))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // La caché es best-effort: si falla, seguimos sin ella
    }
  }

  async getCacheSize(): Promise<number> {
    try {
      await this.open()
      if (!this.db) return 0

      return new Promise<number>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.count()

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch {
      return 0
    }
  }
}

export const candleCache = new CandleCache()
