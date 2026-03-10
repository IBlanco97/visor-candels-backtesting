'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  getAllMeta,
  getMeta,
  deleteMeta,
  estimateCandles,
  estimateSeconds,
  downloadHistoricalData,
  getActualCacheRange,
  DownloadMeta,
  DownloadProgress,
  CacheRange,
} from '../services/historicalDownloader'
import { candleCache } from '../services/candleCache'

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'LTCUSDT', 'MATICUSDT',
]

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']

function formatCandles(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function formatSeconds(s: number): string {
  if (s < 60) return `~${s}s`
  if (s < 3600) return `~${Math.ceil(s / 60)}min`
  return `~${(s / 3600).toFixed(1)}h`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  })
}

interface ProgressEntry {
  key: string
  symbol: string
  interval: string
  progress: DownloadProgress
}

export default function DataPage() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(['BTCUSDT'])
  const [selectedIntervals, setSelectedIntervals] = useState<string[]>(['1h', '4h', '1d'])
  const [fromDate, setFromDate] = useState('2022-01-01')
  const [metas, setMetas] = useState<DownloadMeta[]>([])
  const [cacheCount, setCacheCount] = useState<number | null>(null)
  const [progressMap, setProgressMap] = useState<Record<string, ProgressEntry>>({})
  const [isDownloading, setIsDownloading] = useState(false)
  const cancelRef = useRef({ cancelled: false })

  const fromSec = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000)

  // Real coverage from IndexedDB per "symbol-interval" key
  const [coverageMap, setCoverageMap] = useState<Record<string, CacheRange>>({})

  const refreshMetas = useCallback(() => {
    setMetas(getAllMeta())
  }, [])

  useEffect(() => {
    refreshMetas()
    candleCache.getCacheSize().then(setCacheCount)
  }, [refreshMetas])

  // Query actual IndexedDB coverage for selected pairs + already-downloaded pairs
  const refreshCoverage = useCallback(() => {
    const selectedPairs = selectedSymbols.flatMap(sym =>
      selectedIntervals.map(itv => `${sym}-${itv}`)
    )
    const metaPairs = getAllMeta().map(m => `${m.symbol}-${m.interval}`)
    const allKeys = Array.from(new Set([...selectedPairs, ...metaPairs]))
    Promise.all(
      allKeys.map(async key => {
        const [sym, itv] = key.split('-') as [string, string]
        return { key, range: await getActualCacheRange(sym, itv) }
      })
    ).then(results => {
      const map: Record<string, CacheRange> = {}
      results.forEach(r => { map[r.key] = r.range })
      setCoverageMap(map)
    })
  }, [selectedSymbols, selectedIntervals])

  useEffect(() => { refreshCoverage() }, [refreshCoverage])

  function toggleSymbol(s: string) {
    setSelectedSymbols(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    )
  }

  function toggleInterval(i: string) {
    setSelectedIntervals(prev =>
      prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
    )
  }

  // Build list of (symbol, interval) pairs to download, ordered by interval desc (faster ones first)
  const queue = selectedSymbols.flatMap(sym =>
    [...selectedIntervals]
      .sort((a, b) => (INTERVALS.indexOf(b) - INTERVALS.indexOf(a)))
      .map(itv => ({ symbol: sym, interval: itv }))
  )

  const INTERVAL_SECONDS_PAGE: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '1d': 86400,
  }

  /** Candles actually missing = startGap + endGap (ignores already-cached middle). */
  function pendingCandles(symbol: string, interval: string): number {
    const coverage = coverageMap[`${symbol}-${interval}`]
    if (!coverage?.latest) return estimateCandles(interval, fromSec)

    const intervalSec = INTERVAL_SECONDS_PAGE[interval] ?? 300
    const nowSec = Math.floor(Date.now() / 1000)

    // End gap: candles from latest cached to now
    const endGap = Math.max(0, Math.ceil((nowSec - coverage.latest) / intervalSec))

    // Start gap: candles from user's fromSec to our earliest cached (if fromSec is before earliest)
    const startGap = (coverage.earliest !== null && fromSec < coverage.earliest)
      ? Math.ceil((coverage.earliest - fromSec) / intervalSec)
      : 0

    return endGap + startGap
  }

  const totalEstimated = queue.reduce((sum, { symbol: sym, interval }) =>
    sum + pendingCandles(sym, interval), 0)

  const totalSecs = queue.reduce((sum, { symbol: sym, interval }) => {
    const p = pendingCandles(sym, interval)
    const intervalSec = INTERVAL_SECONDS_PAGE[interval] ?? 300
    const batches = Math.ceil((p * intervalSec) / (1000 * intervalSec))
    return sum + Math.ceil((batches * 180) / 1000)
  }, 0)

  async function startDownload() {
    if (isDownloading || queue.length === 0) return
    cancelRef.current = { cancelled: false }
    setIsDownloading(true)

    for (const { symbol, interval } of queue) {
      if (cancelRef.current.cancelled) break
      const key = `${symbol}-${interval}`

      await downloadHistoricalData(
        symbol,
        interval,
        fromSec,
        (p) => {
          setProgressMap(prev => ({ ...prev, [key]: { key, symbol, interval, progress: p } }))
          if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') {
            refreshMetas()
            refreshCoverage()
            candleCache.getCacheSize().then(setCacheCount)
          }
        },
        cancelRef.current
      )
    }

    setIsDownloading(false)
    refreshMetas()
    candleCache.getCacheSize().then(setCacheCount)
  }

  function cancelDownload() {
    cancelRef.current.cancelled = true
  }

  function handleDelete(symbol: string, interval: string) {
    deleteMeta(symbol, interval)
    refreshMetas()
  }

  const activeProgress = Object.values(progressMap)
    .filter(e => e.progress.phase === 'downloading' || e.progress.phase === 'error')

  const completedProgress = Object.values(progressMap)
    .filter(e => e.progress.phase === 'done')
    .slice(-5) // show last 5

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors text-sm">
            ← Volver al gráfico
          </Link>
          <h1 className="text-2xl font-bold">Datos Históricos Offline</h1>
          {cacheCount !== null && (
            <span className="ml-auto text-sm text-gray-400 bg-gray-800 px-3 py-1 rounded-full">
              {formatCandles(cacheCount)} velas en caché
            </span>
          )}
        </div>

        {/* Symbol selector */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Símbolos</h2>
          <div className="flex flex-wrap gap-2">
            {SYMBOLS.map(s => (
              <button
                key={s}
                onClick={() => toggleSymbol(s)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  selectedSymbols.includes(s)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {s.replace('USDT', '')}
              </button>
            ))}
          </div>
        </section>

        {/* Interval selector */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Intervalos</h2>
          <div className="flex flex-wrap gap-2">
            {INTERVALS.map(i => {
              const repSymbol = selectedSymbols[0] ?? 'BTCUSDT'
              const coverage = coverageMap[`${repSymbol}-${i}`]
              const nowSec = Math.floor(Date.now() / 1000)
              const upToDate = coverage?.latest && (nowSec - coverage.latest) < 2 * 86400
              const hasData = !!coverage?.latest
              return (
                <button
                  key={i}
                  onClick={() => toggleInterval(i)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex flex-col items-center min-w-[56px] ${
                    selectedIntervals.includes(i)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <span>{i}</span>
                  <span className="text-xs mt-0.5">
                    {(() => {
                      const hasStartGap = coverage?.earliest != null && fromSec < coverage.earliest
                      if (hasStartGap)
                        return <span className="text-orange-300">gap desde {formatDate(fromSec * 1000)}</span>
                      if (upToDate)
                        return <span className="text-green-300">✓ al día</span>
                      if (hasData)
                        return <span className="text-yellow-300">hasta {formatDate(coverage!.latest! * 1000)}</span>
                      return <span className="opacity-50">{formatCandles(estimateCandles(i, fromSec))}</span>
                    })()}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* From date */}
        <section className="mb-6">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Desde</h2>
              <input
                type="date"
                value={fromDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => setFromDate(e.target.value)}
                className="bg-gray-800 border border-gray-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <p className="text-xs text-gray-500 mt-4 max-w-xs">
              Si ya tienes datos desde esa fecha, el sistema solo descargará las velas que faltan desde el último dato guardado.
            </p>
          </div>
        </section>

        {/* Per-combo status + action */}
        {queue.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 mb-6">
            {/* Per-combo breakdown */}
            <div className="space-y-2 mb-4">
              {queue.map(({ symbol: sym, interval: itv }) => {
                const coverage = coverageMap[`${sym}-${itv}`]
                const nowSec = Math.floor(Date.now() / 1000)
                const pending = pendingCandles(sym, itv)
                const hasData = !!coverage?.latest
                const hasStartGap = hasData && coverage!.earliest! > fromSec
                const upToDate = hasData && !hasStartGap && (nowSec - coverage!.latest!) < 2 * 86400
                return (
                  <div key={`${sym}-${itv}`} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-300">{sym} <span className="text-gray-500">{itv}</span></span>
                    <span className="text-right text-xs">
                      {!hasData && (
                        <span className="text-gray-400">Sin datos · descargar {formatCandles(pending)} velas</span>
                      )}
                      {hasData && upToDate && (
                        <span className="text-green-400">✓ Al día — nada que descargar</span>
                      )}
                      {hasData && !upToDate && !hasStartGap && (
                        <span className="text-yellow-300">
                          Tienes {formatDate(coverage!.earliest! * 1000)}→{formatDate(coverage!.latest! * 1000)}
                          <span className="text-gray-400 ml-1">· actualizar {formatCandles(pending)} velas recientes</span>
                        </span>
                      )}
                      {hasData && hasStartGap && (
                        <span className="text-orange-300">
                          Tienes desde {formatDate(coverage!.earliest! * 1000)} · necesitas desde {fromDate}
                          <span className="text-gray-400 ml-1">· descargar {formatCandles(pending)} velas</span>
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Totals + buttons */}
            <div className="flex items-center gap-6 pt-3 border-t border-gray-700">
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Total a descargar</div>
              <div className="text-lg font-mono font-semibold">{formatCandles(totalEstimated)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-0.5">Tiempo estimado</div>
              <div className="text-lg font-mono font-semibold">{formatSeconds(totalSecs)}</div>
            </div>
            <div className="ml-auto flex gap-3">
              {isDownloading ? (
                <button
                  onClick={cancelDownload}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded font-medium transition-colors"
                >
                  Cancelar
                </button>
              ) : (
                <button
                  onClick={startDownload}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium transition-colors"
                >
                  Descargar
                </button>
              )}
            </div>
            </div>{/* end totals row */}
          </div>
        )}

        {/* Active progress */}
        {(activeProgress.length > 0 || completedProgress.length > 0) && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Progreso</h2>
            <div className="space-y-2">
              {activeProgress.map(e => (
                <ProgressRow key={e.key} entry={e} />
              ))}
              {completedProgress.map(e => (
                <ProgressRow key={e.key} entry={e} />
              ))}
            </div>
          </section>
        )}

        {/* Downloaded data */}
        {metas.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Datos descargados ({metas.length})
            </h2>
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-xs">
                    <th className="text-left px-4 py-2">Símbolo</th>
                    <th className="text-left px-4 py-2">Intervalo</th>
                    <th className="text-right px-4 py-2">Velas</th>
                    <th className="text-right px-4 py-2">Rango en caché</th>
                    <th className="text-right px-4 py-2">Completo</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {metas
                    .sort((a, b) => a.symbol.localeCompare(b.symbol) || INTERVALS.indexOf(a.interval) - INTERVALS.indexOf(b.interval))
                    .map(m => {
                      const real = coverageMap[`${m.symbol}-${m.interval}`]
                      const nowSec = Math.floor(Date.now() / 1000)
                      // Use real IndexedDB latest as source of truth, fall back to metadata
                      const latestSec = real?.latest ?? m.toSec
                      const earliestSec = real?.earliest ?? m.fromSec
                      const gapDays = Math.floor((nowSec - latestSec) / 86400)
                      const isComplete = gapDays < 2
                      return (
                      <tr key={`${m.symbol}-${m.interval}`} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="px-4 py-2 font-medium">{m.symbol}</td>
                        <td className="px-4 py-2 text-gray-300">{m.interval}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-400">{formatCandles(m.totalCandles)}</td>
                        <td className="px-4 py-2 text-right text-gray-400 text-xs">
                          {real
                            ? <>{formatDate(earliestSec * 1000)} → {formatDate(latestSec * 1000)}</>
                            : <span className="text-gray-600">—</span>
                          }
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isComplete
                            ? <span className="text-green-400 text-xs">✓ Al día</span>
                            : <span className="text-yellow-400 text-xs" title={`Faltan ~${gapDays} días`}>⚠ Falta hasta hoy</span>
                          }
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleDelete(m.symbol, m.interval)}
                            className="text-gray-500 hover:text-red-400 transition-colors text-xs"
                            title="Borrar metadatos (no borra la caché IndexedDB)"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    )})}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              * El botón ✕ solo borra el registro de descarga. Los datos en IndexedDB se reutilizan si vuelves a descargar.
            </p>
          </section>
        )}

        {metas.length === 0 && !isDownloading && (
          <div className="text-center text-gray-500 py-12">
            Selecciona símbolos, intervalos y fecha de inicio, luego pulsa Descargar.
          </div>
        )}
      </div>
    </div>
  )
}

function ProgressRow({ entry }: { entry: ProgressEntry }) {
  const { symbol, interval, progress } = entry
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="bg-gray-800 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-medium text-sm">{symbol} · {interval}</span>
        <span className={`text-xs font-medium ${
          progress.phase === 'done' ? 'text-green-400' :
          progress.phase === 'error' ? 'text-red-400' :
          progress.phase === 'cancelled' ? 'text-yellow-400' :
          'text-blue-400'
        }`}>
          {progress.phase === 'done' ? '✓ Completado' :
           progress.phase === 'error' ? `✗ Error: ${progress.error}` :
           progress.phase === 'cancelled' ? '⏹ Cancelado' :
           `${pct}% · ${progress.done}/${progress.total} lotes`}
        </span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            progress.phase === 'done' ? 'bg-green-500' :
            progress.phase === 'error' ? 'bg-red-500' :
            'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
