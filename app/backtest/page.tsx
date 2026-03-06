'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import Link from 'next/link'
import { createChart, BaselineSeries, ColorType, Time } from 'lightweight-charts'
import type { BacktestSummary, BacktestTrade } from '../services/backtestEngine'

const PAGE_SIZE = 100

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtTime(unix: number) {
  return new Date(unix * 1000).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function pnlColor(v: number) {
  return v >= 0 ? 'text-green-400' : 'text-red-400'
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'green' | 'red' | 'neutral' }) {
  const color = highlight === 'green' ? 'text-green-400' : highlight === 'red' ? 'text-red-400' : 'text-white'
  return (
    <div className="bg-gray-800 rounded-lg p-4 flex flex-col gap-1 border border-gray-700">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-2xl font-bold font-mono ${color}`}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  )
}

export default function BacktestAnalysisPage() {
  const [summary, setSummary] = useState<BacktestSummary | null>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const [filterResult, setFilterResult] = useState<'all' | 'tp' | 'sl'>('all')
  const [filterDir, setFilterDir] = useState<'all' | 'long' | 'short'>('all')
  const [sortDesc, setSortDesc] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('bitcoin-trader-backtest-summary')
      if (raw) setSummary(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  // Build equity curve chart
  useEffect(() => {
    if (!summary || !chartContainerRef.current || summary.equityCurve.length === 0) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(55,65,81,0.5)' },
        horzLines: { color: 'rgba(55,65,81,0.5)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(55,65,81,0.8)' },
      timeScale: { borderColor: 'rgba(55,65,81,0.8)', timeVisible: true, secondsVisible: false },
      height: 280,
    })

    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22ab94',
      topFillColor1: 'rgba(34,171,148,0.28)',
      topFillColor2: 'rgba(34,171,148,0.05)',
      bottomLineColor: '#f7525f',
      bottomFillColor1: 'rgba(247,82,95,0.05)',
      bottomFillColor2: 'rgba(247,82,95,0.28)',
      lineWidth: 2,
    })

    series.setData(
      summary.equityCurve.map(p => ({ time: p.time as Time, value: p.value }))
    )
    chart.timeScale().fitContent()

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [summary])

  const filteredTrades = useMemo(() => {
    if (!summary) return []
    let trades = [...summary.trades]
    if (filterResult !== 'all') trades = trades.filter(t => t.result === filterResult)
    if (filterDir !== 'all') trades = trades.filter(t => t.direction === filterDir)
    if (sortDesc) trades.reverse()
    return trades
  }, [summary, filterResult, filterDir, sortDesc])

  const totalPages = Math.ceil(filteredTrades.length / PAGE_SIZE)
  const pageTrades = filteredTrades.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white gap-4">
        <div className="text-lg text-gray-400">No hay datos de backtest.</div>
        <Link href="/" className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm transition-colors">
          ← Ir al gráfico
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-orange-400">📊 Análisis de Backtest</h1>
        <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Volver al gráfico
        </Link>
      </div>

      <div className="p-6 flex flex-col gap-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="P&L Total"
            value={`${summary.totalPnlPct >= 0 ? '+' : ''}${fmt(summary.totalPnlPct)}%`}
            highlight={summary.totalPnlPct >= 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Win Rate"
            value={`${fmt(summary.winRate)}%`}
            sub={`${summary.winCount}W / ${summary.lossCount}L`}
            highlight={summary.winRate >= 50 ? 'green' : 'red'}
          />
          <StatCard
            label="Operaciones"
            value={String(summary.trades.length)}
            sub={`${summary.winCount} TP · ${summary.lossCount} SL`}
            highlight="neutral"
          />
          <StatCard
            label="Max Drawdown"
            value={`${fmt(summary.maxDrawdown)}%`}
            sub="caída máx. desde pico"
            highlight="red"
          />
          <StatCard
            label="Max Runup"
            value={`+${fmt(summary.maxRunup)}%`}
            sub="subida máx. desde valle"
            highlight="green"
          />
          <StatCard
            label="Ratio RU/DD"
            value={summary.maxDrawdown !== 0 ? fmt(Math.abs(summary.maxRunup / summary.maxDrawdown)) : '∞'}
            sub="runup / drawdown"
            highlight={Math.abs(summary.maxRunup) >= Math.abs(summary.maxDrawdown) ? 'green' : 'red'}
          />
        </div>

        {/* Equity curve */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Curva de Balance (P&amp;L acumulado %)</h2>
            <span className="text-xs text-gray-500">{summary.equityCurve.length} puntos</span>
          </div>
          <div ref={chartContainerRef} className="w-full" />
        </div>

        {/* Drawdown / Runup detail */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-lg border border-red-900/40 p-4">
            <h3 className="text-sm font-semibold text-red-400 mb-3">📉 Drawdown máximo</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Caída</span>
                <span className="font-mono text-red-400 font-semibold">{fmt(summary.maxDrawdown)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">En pérdidas consecutivas</span>
                <span className="font-mono text-gray-300">{maxConsecutiveLosses(summary.trades)}</span>
              </div>
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-green-900/40 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">📈 Runup máximo</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Subida</span>
                <span className="font-mono text-green-400 font-semibold">+{fmt(summary.maxRunup)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">En ganancias consecutivas</span>
                <span className="font-mono text-gray-300">{maxConsecutiveWins(summary.trades)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trade table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-300 mr-auto">Operaciones ({filteredTrades.length})</h2>
            {/* Filters */}
            <div className="flex gap-1">
              {(['all', 'tp', 'sl'] as const).map(f => (
                <button key={f} onClick={() => { setFilterResult(f); setPage(0) }}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${filterResult === f ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                  {f === 'all' ? 'Todos' : f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['all', 'long', 'short'] as const).map(f => (
                <button key={f} onClick={() => { setFilterDir(f); setPage(0) }}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${filterDir === f ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                  {f === 'all' ? 'Dir.' : f.toUpperCase()}
                </button>
              ))}
            </div>
            <button onClick={() => setSortDesc(p => !p)}
              className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors">
              {sortDesc ? '↑ Recientes' : '↓ Primeros'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Dir.</th>
                  <th className="px-3 py-2 text-right">Entrada</th>
                  <th className="px-3 py-2 text-right">TP</th>
                  <th className="px-3 py-2 text-right">SL</th>
                  <th className="px-3 py-2 text-right">Salida</th>
                  <th className="px-3 py-2 text-center">Resultado</th>
                  <th className="px-3 py-2 text-right">P&amp;L</th>
                  <th className="px-3 py-2 text-right">Acumulado</th>
                  <th className="px-3 py-2 text-left">Fecha entrada</th>
                  <th className="px-3 py-2 text-left">Fecha salida</th>
                </tr>
              </thead>
              <tbody>
                {pageTrades.map((trade, i) => {
                  const globalIdx = sortDesc
                    ? filteredTrades.length - (page * PAGE_SIZE + i)
                    : page * PAGE_SIZE + i + 1
                  const cumIdx = summary.trades.indexOf(trade)
                  const cumPnl = summary.equityCurve[cumIdx]?.value ?? 0
                  return (
                    <tr key={trade.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-1.5 text-gray-500">{globalIdx}</td>
                      <td className="px-3 py-1.5">
                        <span className={`font-semibold ${trade.direction === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.direction === 'long' ? '▲ L' : '▼ S'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{fmt(trade.entryPrice)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-green-400/70">{fmt(trade.tpPrice)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-red-400/70">{fmt(trade.slPrice)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-300">{fmt(trade.exitPrice)}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${trade.result === 'tp' ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'}`}>
                          {trade.result.toUpperCase()}
                        </span>
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono font-semibold ${pnlColor(trade.pnlPct)}`}>
                        {trade.pnlPct >= 0 ? '+' : ''}{fmt(trade.pnlPct)}%
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono ${pnlColor(cumPnl)}`}>
                        {cumPnl >= 0 ? '+' : ''}{fmt(cumPnl)}%
                      </td>
                      <td className="px-3 py-1.5 text-gray-400">{fmtTime(trade.entryTime)}</td>
                      <td className="px-3 py-1.5 text-gray-400">{fmtTime(trade.exitTime)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Página {page + 1} de {totalPages} · {filteredTrades.length} operaciones
              </span>
              <div className="flex gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0}
                  className="px-2 py-1 text-xs rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600 transition-colors">«</button>
                <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
                  className="px-2 py-1 text-xs rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600 transition-colors">‹</button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
                  className="px-2 py-1 text-xs rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600 transition-colors">›</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                  className="px-2 py-1 text-xs rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600 transition-colors">»</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function maxConsecutiveLosses(trades: BacktestTrade[]): number {
  let max = 0, cur = 0
  for (const t of trades) {
    if (t.result === 'sl') { cur++; if (cur > max) max = cur } else cur = 0
  }
  return max
}

function maxConsecutiveWins(trades: BacktestTrade[]): number {
  let max = 0, cur = 0
  for (const t of trades) {
    if (t.result === 'tp') { cur++; if (cur > max) max = cur } else cur = 0
  }
  return max
}
