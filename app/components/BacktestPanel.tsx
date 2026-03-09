'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { CandlestickData, Time } from 'lightweight-charts'
import {
  BacktestConfig,
  BacktestDirection,
  BacktestSummary,
  BacktestTrade,
  fetchCandlesForBacktest,
  runBacktest,
} from '../services/backtestEngine'
import {
  SavedBacktest,
  loadHistory,
  saveBacktest,
  deleteBacktest,
  setActiveBacktest,
} from '../services/backtestHistory'

interface BacktestPanelProps {
  onResult: (trades: BacktestTrade[], summary: BacktestSummary, startTimeSec: number, showRulers: boolean) => void
  onClear: () => void
}

export default function BacktestPanel({ onResult, onClear }: BacktestPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  // Config inputs
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('00:00')
  const [triggerPrice, setTriggerPrice] = useState('')
  const [tpPct, setTpPct] = useState(1.0)
  const [slPct, setSlPct] = useState(1.0)
  const [initialDirection, setInitialDirection] = useState<BacktestDirection>('long')
  const [showRulers, setShowRulers] = useState(true)

  // Run state
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<BacktestSummary | null>(null)

  // History
  const [history, setHistory] = useState<SavedBacktest[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const abortRef = useRef(false)

  useEffect(() => {
    loadHistory().then(setHistory)
  }, [])

  const handleSimulate = useCallback(async () => {
    if (!startDate) { setError('Selecciona una fecha de inicio'); return }
    const startMs = new Date(startDate + 'T' + startTime + ':00').getTime()
    if (isNaN(startMs)) { setError('Fecha inválida'); return }

    const nowMs = Date.now()
    if (startMs >= nowMs) { setError('La fecha debe ser anterior a hoy'); return }

    setError(null)
    setSummary(null)
    setRunning(true)
    abortRef.current = false
    setProgress({ fetched: 0, total: 1 })

    const startTimeSec = Math.floor(startMs / 1000)
    const endTimeSec = Math.floor(nowMs / 1000)

    try {
      const candles: CandlestickData<Time>[] = await fetchCandlesForBacktest(
        startTimeSec,
        endTimeSec,
        (fetched, total) => {
          if (!abortRef.current) setProgress({ fetched, total })
        },
      )

      if (abortRef.current) return

      if (candles.length === 0) {
        setError('No se encontraron velas para el rango seleccionado')
        return
      }

      const parsedTrigger = parseFloat(triggerPrice)
      const config: BacktestConfig = {
        startTime: startTimeSec,
        tpPct,
        slPct,
        initialDirection,
        ...(triggerPrice !== '' && !isNaN(parsedTrigger) && parsedTrigger > 0 ? { triggerPrice: parsedTrigger } : {}),
      }

      const result = runBacktest(candles, config)
      setSummary(result)

      // Persist to history
      if (result.trades.length > 0) {
        await saveBacktest(config, result, startTimeSec)
        setHistory(await loadHistory())
      }

      onResult(result.trades, result, startTimeSec, showRulers)
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err.message : 'Error al obtener datos')
      }
    } finally {
      if (!abortRef.current) {
        setRunning(false)
        setProgress(null)
      }
    }
  }, [startDate, tpPct, slPct, initialDirection, onResult])

  const handleClear = useCallback(() => {
    abortRef.current = true
    setRunning(false)
    setProgress(null)
    setSummary(null)
    setError(null)
    onClear()
  }, [onClear])

  const handleLoadFromHistory = useCallback((entry: SavedBacktest) => {
    setSummary(entry.summary)
    setActiveBacktest(entry)
    onResult(entry.summary.trades, entry.summary, entry.startTimeSec, true)
    setShowHistory(false)
  }, [onResult])

  const handleDeleteFromHistory = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteBacktest(id).then(() => loadHistory().then(setHistory))
  }, [])

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.fetched / progress.total) * 100)
      : 0

  return (
    <div
      className="absolute bottom-8 left-4 z-20 bg-gray-900 border border-gray-700 rounded-lg shadow-xl"
      style={{ width: collapsed ? 'auto' : 260 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-gray-700 cursor-pointer select-none"
        onClick={() => setCollapsed(p => !p)}
      >
        <span className="text-xs font-semibold text-orange-400 tracking-wide">
          📊 BACKTEST CADENA
        </span>
        <span className="text-gray-400 text-xs ml-3">{collapsed ? '▲' : '▼'}</span>
      </div>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-2.5">
          {/* Start date + time */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fecha y hora inicio</label>
            <div className="flex gap-1.5">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                disabled={running}
                className="flex-1 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-orange-500 disabled:opacity-50"
              />
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                disabled={running}
                className="w-20 bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-orange-500 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Trigger price (optional) */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Precio de entrada
              <span className="text-gray-600 ml-1">(opcional)</span>
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={triggerPrice}
              onChange={e => setTriggerPrice(e.target.value)}
              disabled={running}
              placeholder="p.ej. 65000"
              className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-orange-500 disabled:opacity-50 placeholder-gray-600"
            />
            <p className="text-gray-600 text-xs mt-0.5">Espera hasta que el precio sea tocado</p>
          </div>

          {/* TP / SL */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">TP %</label>
              <input
                type="number"
                min={0.1}
                max={50}
                step={0.1}
                value={tpPct}
                onChange={e => setTpPct(Math.max(0.1, parseFloat(e.target.value) || 1))}
                disabled={running}
                className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-orange-500 disabled:opacity-50 text-center"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">SL %</label>
              <input
                type="number"
                min={0.1}
                max={50}
                step={0.1}
                value={slPct}
                onChange={e => setSlPct(Math.max(0.1, parseFloat(e.target.value) || 1))}
                disabled={running}
                className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-orange-500 disabled:opacity-50 text-center"
              />
            </div>
          </div>

          {/* Initial direction */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Dirección inicial</label>
            <div className="flex gap-1">
              <button
                onClick={() => setInitialDirection('long')}
                disabled={running}
                className={`flex-1 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
                  initialDirection === 'long'
                    ? 'bg-green-600 text-white font-semibold'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                LONG
              </button>
              <button
                onClick={() => setInitialDirection('short')}
                disabled={running}
                className={`flex-1 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
                  initialDirection === 'short'
                    ? 'bg-red-600 text-white font-semibold'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                SHORT
              </button>
            </div>
          </div>

          {/* Show rulers toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRulers}
              onChange={e => setShowRulers(e.target.checked)}
              disabled={running}
              className="accent-orange-500 w-3.5 h-3.5"
            />
            <span className="text-xs text-gray-300">Proyectar reglas TP/SL</span>
          </label>

                    {/* Action buttons */}
          <div className="flex gap-1.5 mt-1">
            <button
              onClick={handleSimulate}
              disabled={running || !startDate}
              className="flex-1 py-1.5 text-xs rounded font-semibold transition-colors bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              {running ? 'Simulando…' : '▶ Simular'}
            </button>
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-xs rounded transition-colors bg-gray-700 hover:bg-gray-600 text-gray-300"
            >
              Limpiar
            </button>
          </div>

          {/* Progress bar */}
          {running && progress && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Cargando velas…</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all duration-200"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/30 px-2 py-1.5 rounded border border-red-800">
              {error}
            </div>
          )}

          {/* Summary */}
          {summary && summary.trades.length > 0 && (
            <div className="border-t border-gray-700 pt-2 flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Operaciones</span>
                <span className="text-white font-mono">{summary.trades.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Win rate</span>
                <span
                  className={`font-mono ${summary.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {summary.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">TP / SL</span>
                <span className="text-gray-300 font-mono">
                  {summary.winCount}W / {summary.lossCount}L
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">P&amp;L total</span>
                <span
                  className={`font-mono font-semibold ${
                    summary.totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {summary.totalPnlPct >= 0 ? '+' : ''}
                  {summary.totalPnlPct.toFixed(2)}%
                </span>
              </div>
            </div>
          )}

          {summary && summary.trades.length === 0 && !running && (
            <div className="text-xs text-gray-500 text-center">
              Sin operaciones completadas en el rango
            </div>
          )}

          {summary && summary.trades.length > 0 && !running && (
            <Link
              href="/backtest"
              className="block text-center text-xs py-1.5 rounded bg-orange-900/50 hover:bg-orange-800/60 text-orange-300 border border-orange-800/60 transition-colors"
            >
              Ver análisis detallado →
            </Link>
          )}

          {/* History toggle */}
          {history.length > 0 && (
            <div className="border-t border-gray-700 pt-2">
              <button
                onClick={() => setShowHistory(p => !p)}
                className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-200 transition-colors py-0.5"
              >
                <span>📂 Historial ({history.length})</span>
                <span>{showHistory ? '▲' : '▼'}</span>
              </button>

              {showHistory && (
                <div className="mt-2 flex flex-col gap-1 max-h-52 overflow-y-auto pr-0.5">
                  {history.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-start gap-1.5 bg-gray-800 rounded px-2 py-1.5 border border-gray-700"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-200 leading-tight truncate">{entry.name}</div>
                        <div className="flex gap-2 mt-0.5">
                          <span className="text-gray-500 text-[10px]">
                            {new Date(entry.savedAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </span>
                          <span className={`text-[10px] font-mono font-semibold ${entry.summary.totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {entry.summary.totalPnlPct >= 0 ? '+' : ''}{entry.summary.totalPnlPct.toFixed(2)}%
                          </span>
                          <span className="text-gray-500 text-[10px]">{entry.summary.trades.length} ops</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handleLoadFromHistory(entry)}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-orange-700/60 hover:bg-orange-600 text-orange-200 transition-colors"
                          title="Cargar este backtest"
                        >
                          Cargar
                        </button>
                        <button
                          onClick={e => handleDeleteFromHistory(entry.id, e)}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 hover:bg-red-900/60 text-gray-400 hover:text-red-300 transition-colors"
                          title="Eliminar"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
