'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'

type TradeDirection = 'long' | 'short'

interface TradePosition {
  id: string
  direction: TradeDirection
  entryPrice: number
  entryTime: number
  exitPrice?: number
  exitTime?: number
  source?: 'manual' | 'bot'
  botStatus?: string
}

type SortField = 'index' | 'direction' | 'entryPrice' | 'exitPrice' | 'pnl' | 'entryTime'
type SortDir = 'asc' | 'desc'
type FilterDirection = 'all' | 'long' | 'short'
type FilterStatus = 'all' | 'completed' | 'open'
type FilterSource = 'all' | 'manual' | 'bot'

const PAGE_SIZE = 50

function calcPnl(entry: number, exit: number, direction: TradeDirection): number {
  return direction === 'long'
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100
}

function formatPrice(p: number) {
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function TradesPage() {
  const [trades, setTrades] = useState<TradePosition[]>([])
  const [filterDir, setFilterDir] = useState<FilterDirection>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterSource, setFilterSource] = useState<FilterSource>('all')
  const [sortField, setSortField] = useState<SortField>('index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  useEffect(() => {
    try {
      const manual: TradePosition[] = (() => {
        const raw = localStorage.getItem('bitcoin-trader-positions')
        return raw ? JSON.parse(raw) : []
      })()
      const bot: TradePosition[] = (() => {
        const raw = localStorage.getItem('bitcoin-trader-bot-trades')
        return raw ? JSON.parse(raw) : []
      })()
      const manualTagged = manual.map(t => ({ ...t, source: 'manual' as const }))
      const botTagged = bot.map(t => ({ ...t, source: 'bot' as const }))
      setTrades([...manualTagged, ...botTagged])
    } catch {
      setTrades([])
    }
  }, [])

  const deleteTrade = (id: string) => {
    const trade = trades.find(t => t.id === id)
    if (!trade || trade.source === 'bot') return
    const updated = trades.filter(t => t.id !== id)
    setTrades(updated)
    const manualOnly = updated.filter(t => t.source !== 'bot')
    localStorage.setItem('bitcoin-trader-positions', JSON.stringify(manualOnly))
  }

  // Trades con índice original y pnl calculado
  const enriched = useMemo(() =>
    trades.map((t, i) => ({
      ...t,
      originalIndex: i + 1,
      pnl: t.exitPrice != null ? calcPnl(t.entryPrice, t.exitPrice, t.direction) : null,
    })), [trades])

  // Estadísticas globales
  const stats = useMemo(() => {
    const completed = enriched.filter(t => t.pnl != null)
    const wins = completed.filter(t => t.pnl! >= 0)
    const totalPnl = completed.reduce((s, t) => s + t.pnl!, 0)
    const best = completed.length ? Math.max(...completed.map(t => t.pnl!)) : null
    const worst = completed.length ? Math.min(...completed.map(t => t.pnl!)) : null
    return {
      total: trades.length,
      completed: completed.length,
      open: trades.length - completed.length,
      wins: wins.length,
      losses: completed.length - wins.length,
      winRate: completed.length ? (wins.length / completed.length) * 100 : 0,
      totalPnl,
      avgPnl: completed.length ? totalPnl / completed.length : 0,
      best,
      worst,
      longs: trades.filter(t => t.direction === 'long').length,
      shorts: trades.filter(t => t.direction === 'short').length,
    }
  }, [enriched, trades])

  // Filtros y búsqueda
  const filtered = useMemo(() => {
    let list = enriched
    if (filterDir !== 'all') list = list.filter(t => t.direction === filterDir)
    if (filterStatus === 'completed') list = list.filter(t => t.pnl != null)
    if (filterStatus === 'open') list = list.filter(t => t.pnl == null)
    if (filterSource === 'manual') list = list.filter(t => t.source !== 'bot')
    if (filterSource === 'bot') list = list.filter(t => t.source === 'bot')
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(t =>
        formatPrice(t.entryPrice).includes(q) ||
        (t.exitPrice ? formatPrice(t.exitPrice).includes(q) : false) ||
        t.direction.includes(q) ||
        String(t.originalIndex).includes(q)
      )
    }
    return list
  }, [enriched, filterDir, filterStatus, filterSource, search])

  // Ordenación
  const sorted = useMemo(() => {
    const mult = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'index': return (a.originalIndex - b.originalIndex) * mult
        case 'direction': return a.direction.localeCompare(b.direction) * mult
        case 'entryPrice': return (a.entryPrice - b.entryPrice) * mult
        case 'exitPrice': return ((a.exitPrice ?? 0) - (b.exitPrice ?? 0)) * mult
        case 'pnl': return ((a.pnl ?? -Infinity) - (b.pnl ?? -Infinity)) * mult
        case 'entryTime': return (a.entryTime - b.entryTime) * mult
        default: return 0
      }
    })
  }, [filtered, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-600 ml-1">↕</span>
    return <span className="text-blue-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [filterDir, filterStatus, filterSource, search])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-1"
          >
            ← Volver al gráfico
          </Link>
          <h1 className="text-xl font-bold">Historial de Operaciones</h1>
          <span className="text-sm text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
            {trades.length} total
          </span>
        </div>
      </div>

      <div className="flex-1 px-6 py-4 flex flex-col gap-4 overflow-auto">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Completadas" value={stats.completed} />
          <StatCard label="Abiertas" value={stats.open} color="text-yellow-400" />
          <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'} />
          <StatCard label="Ganadoras" value={stats.wins} color="text-green-400" />
          <StatCard label="Perdedoras" value={stats.losses} color="text-red-400" />
          <StatCard label="P&L Medio" value={`${stats.avgPnl >= 0 ? '+' : ''}${stats.avgPnl.toFixed(2)}%`} color={stats.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
          <StatCard label="P&L Total" value={`${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}%`} color={stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Longs" value={stats.longs} color="text-green-400" />
          <StatCard label="Shorts" value={stats.shorts} color="text-red-400" />
          <StatCard label="Mejor trade" value={stats.best != null ? `+${stats.best.toFixed(2)}%` : '—'} color="text-green-400" />
          <StatCard label="Peor trade" value={stats.worst != null ? `${stats.worst.toFixed(2)}%` : '—'} color="text-red-400" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
          <input
            type="text"
            placeholder="Buscar precio, dirección, #..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-700 text-white text-sm px-3 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-blue-500 w-56"
          />

          <div className="flex gap-1">
            {(['all', 'long', 'short'] as FilterDirection[]).map(d => (
              <button
                key={d}
                onClick={() => setFilterDir(d)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  filterDir === d
                    ? d === 'long' ? 'bg-green-600 text-white' : d === 'short' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {d === 'all' ? 'Todas' : d === 'long' ? '📈 Long' : '📉 Short'}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {(['all', 'completed', 'open'] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {s === 'all' ? 'Todas' : s === 'completed' ? 'Completadas' : 'Abiertas'}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {(['all', 'manual', 'bot'] as FilterSource[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterSource(s)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  filterSource === s
                    ? s === 'bot' ? 'bg-purple-700 text-white' : 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {s === 'all' ? 'Todas' : s === 'manual' ? 'Manual' : '🤖 Bot'}
              </button>
            ))}
          </div>

          <span className="text-sm text-gray-400 ml-auto">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-gray-800 rounded-lg overflow-hidden flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-750 border-b border-gray-700">
                <tr>
                  <Th onClick={() => handleSort('index')} label="#" sortIcon={<SortIcon field="index" />} />
                  <Th onClick={() => handleSort('direction')} label="Dir." sortIcon={<SortIcon field="direction" />} />
                  <Th onClick={() => handleSort('entryTime')} label="Entrada (fecha)" sortIcon={<SortIcon field="entryTime" />} />
                  <Th onClick={() => handleSort('entryPrice')} label="Precio entrada" sortIcon={<SortIcon field="entryPrice" />} />
                  <Th onClick={() => handleSort('exitPrice')} label="Precio salida" sortIcon={<SortIcon field="exitPrice" />} />
                  <Th onClick={() => handleSort('pnl')} label="P&L %" sortIcon={<SortIcon field="pnl" />} />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Acc.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                      No hay operaciones que mostrar
                    </td>
                  </tr>
                ) : paginated.map(trade => {
                  const isLong = trade.direction === 'long'
                  const isComplete = trade.pnl != null
                  const isBot = trade.source === 'bot'
                  const pnlColor = !isComplete ? 'text-yellow-400' : trade.pnl! >= 0 ? 'text-green-400' : 'text-red-400'
                  return (
                    <tr key={trade.id} className={`hover:bg-gray-750 transition-colors ${isBot ? 'bg-purple-950/20' : ''}`}>
                      <td className="px-4 py-3 text-gray-400 font-mono">
                        #{trade.originalIndex}
                        {isBot && <span className="ml-1.5 text-xs bg-purple-800 text-purple-200 px-1 py-0.5 rounded font-semibold">BOT</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                          isLong
                            ? isBot ? 'bg-purple-900 text-purple-300' : 'bg-green-900 text-green-300'
                            : isBot ? 'bg-amber-900 text-amber-300' : 'bg-red-900 text-red-300'
                        }`}>
                          {isLong ? '📈 LONG' : '📉 SHORT'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                        {formatTime(trade.entryTime)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-200">
                        ${formatPrice(trade.entryPrice)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-200">
                        {trade.exitPrice != null ? `$${formatPrice(trade.exitPrice)}` : <span className="text-gray-600">—</span>}
                      </td>
                      <td className={`px-4 py-3 font-mono font-semibold ${pnlColor}`}>
                        {isComplete
                          ? `${trade.pnl! >= 0 ? '+' : ''}${trade.pnl!.toFixed(2)}%`
                          : <span className="text-yellow-500 text-xs">En curso</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        {isComplete ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            trade.pnl! >= 0 ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                          }`}>
                            {trade.pnl! >= 0 ? 'Win' : 'Loss'}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-300">Abierta</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isBot ? (
                          <span className="text-gray-700 rounded p-1" title="Las operaciones del bot no se pueden eliminar manualmente">—</span>
                        ) : (
                          <button
                            onClick={() => deleteTrade(trade.id)}
                            className="text-gray-500 hover:text-red-400 hover:bg-red-900/30 rounded p-1 transition-colors"
                            title="Eliminar operación"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-gray-700 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-gray-400">
                Página {page} de {totalPages} · {sorted.length} operaciones
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ««
                </button>
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 1}
                  className="px-3 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ‹ Anterior
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                  const p = start + i
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`px-3 py-1 text-xs rounded transition-colors ${
                        p === page ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                      }`}
                    >
                      {p}
                    </button>
                  )
                })}
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente ›
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  »»
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg px-4 py-3 border border-gray-700">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    </div>
  )
}

function Th({ onClick, label, sortIcon }: { onClick: () => void; label: string; sortIcon: React.ReactNode }) {
  return (
    <th
      onClick={onClick}
      className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white select-none transition-colors"
    >
      {label}{sortIcon}
    </th>
  )
}
