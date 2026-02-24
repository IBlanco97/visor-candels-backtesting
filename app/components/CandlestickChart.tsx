'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, ColorType, Time, CandlestickData, createSeriesMarkers, ISeriesMarkersPluginApi } from 'lightweight-charts'
import { fetchBitcoinCandlesticks } from '../services/binance'

type TradeStage = 'idle' | 'entry_placed' | 'exit_placed'

interface TradePosition {
  id: string
  entryPrice: number
  entryTime: Time
  exitPrice?: number
  exitTime?: Time
}

interface TradeMarker {
  time: Time
  position: 'aboveBar' | 'belowBar' | 'inBar'
  color: string
  shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown'
  text: string
}

export default function CandlestickChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const initialLoadCompleteRef = useRef(false)
  const [currentPrice, setCurrentPrice] = useState<number>(0)
  const [tradeStage, setTradeStage] = useState<TradeStage>('idle')
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
  const [tradePositions, setTradePositions] = useState<TradePosition[]>([])
  const tradePositionsRef = useRef<TradePosition[]>([])
  const activeTradeIdRef = useRef<string | null>(null)
  const tradeStageRef = useRef<TradeStage>('idle')
  const [profitLoss, setProfitLoss] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const loadingMoreRef = useRef(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadedCandlesRef = useRef<CandlestickData<Time>[]>([])
  const [loadedCandles, setLoadedCandles] = useState<CandlestickData<Time>[]>([])
  const hasMoreHistoricalDataRef = useRef(true)
  const [hasMoreHistoricalData, setHasMoreHistoricalData] = useState(true)
  const oldestCandleTimeRef = useRef<number | null>(null)

  useEffect(() => {
    // Verificar que estamos en el navegador (no en SSR)
    if (typeof window === 'undefined') return
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#758696',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#758696',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(42, 46, 57, 0.8)',
      },
      timeScale: {
        borderColor: 'rgba(42, 46, 57, 0.8)',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22ab94',
      downColor: '#f7525f',
      borderDownColor: '#f7525f',
      borderUpColor: '#22ab94',
      wickDownColor: '#f7525f',
      wickUpColor: '#22ab94',
    })

    const markersPlugin = createSeriesMarkers(candlestickSeries)
    markersPluginRef.current = markersPlugin

    chartRef.current = chart
    seriesRef.current = candlestickSeries

    const loadData = async () => {
      console.log('=== loadData called ===')
      try {
        console.log('Setting loading to true')
        setLoading(true)
        initialLoadCompleteRef.current = false
        const data = await fetchBitcoinCandlesticks('15m', 1000)
        console.log('Received initial data:', data.length, 'candles')
        candlestickSeries.setData(data)
        loadedCandlesRef.current = data
        setLoadedCandles(data)
        if (data.length > 0) {
          const lastCandle = data[data.length - 1]
          setCurrentPrice(lastCandle.close)
          const firstCandleTime = data[0].time
          oldestCandleTimeRef.current = typeof firstCandleTime === 'number' ? firstCandleTime : 0
          console.log('Oldest candle time:', oldestCandleTimeRef.current, new Date(oldestCandleTimeRef.current * 1000))
        }
        console.log('Setting loading to false')
        setLoading(false)
        initialLoadCompleteRef.current = true
        console.log('Initial load complete set to true')
      } catch (error) {
        console.error('Error loading data:', error)
        setLoading(false)
      }
    }

    const loadMoreHistoricalData = async () => {
      console.log('=== loadMoreHistoricalData called ===')
      console.log('loadingMoreRef.current:', loadingMoreRef.current)
      console.log('hasMoreHistoricalDataRef.current:', hasMoreHistoricalDataRef.current)
      console.log('oldestCandleTime:', oldestCandleTimeRef.current)
      console.log('loadedCandlesRef.current length:', loadedCandlesRef.current.length)

      if (loadingMoreRef.current || !hasMoreHistoricalDataRef.current || !oldestCandleTimeRef.current) {
        console.log('Returning early from loadMoreHistoricalData')
        return
      }

      try {
        loadingMoreRef.current = true
        setLoadingMore(true)
        const endTime = (oldestCandleTimeRef.current * 1000) - 1
        console.log('Fetching more data with endTime:', new Date(endTime))
        const newData = await fetchBitcoinCandlesticks('15m', 1000, endTime)
        console.log('Received new data:', newData.length, 'candles')

        if (newData.length === 0) {
          console.log('No more data available')
          hasMoreHistoricalDataRef.current = false
          setHasMoreHistoricalData(false)
        } else if (newData.length < 1000) {
          console.log('Reached end of historical data (got', newData.length, 'candles)')
          hasMoreHistoricalDataRef.current = false
          setHasMoreHistoricalData(false)
          const allData = [...newData, ...loadedCandlesRef.current]
          candlestickSeries.setData(allData)
          loadedCandlesRef.current = allData
          setLoadedCandles(allData)
          const firstCandleTime = newData[0].time
          oldestCandleTimeRef.current = typeof firstCandleTime === 'number' ? firstCandleTime : 0
        } else {
          const allData = [...newData, ...loadedCandlesRef.current]
          console.log('Updating series with total:', allData.length, 'candles')
          candlestickSeries.setData(allData)
          loadedCandlesRef.current = allData
          setLoadedCandles(allData)
          const firstCandleTime = newData[0].time
          oldestCandleTimeRef.current = typeof firstCandleTime === 'number' ? firstCandleTime : 0

          const timeScale = chart.timeScale()
          const currentTimeRange = timeScale.getVisibleRange()
          console.log('Current visible range:', currentTimeRange)
          if (currentTimeRange) {
            let fromValue: number
            if (typeof currentTimeRange.from === 'number') {
              fromValue = currentTimeRange.from
            } else {
              fromValue = parseInt(currentTimeRange.from as string)
            }
            const newFrom = fromValue - newData.length
            console.log('Setting visible range from', newFrom, 'to', currentTimeRange.to)
            timeScale.setVisibleRange({
              from: newFrom as Time,
              to: currentTimeRange.to
            })
          }
        }
      } catch (error) {
        console.error('Error loading more historical data:', error)
      } finally {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }

    loadData()

    const loadMoreHistoricalDataRef = { current: loadMoreHistoricalData }

    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleLogicalRangeChange((range: any) => {
      if (range && range.from !== null && range.to !== null) {
        const isAtBeginning = range.from <= 10
        console.log('=== Visible range change ===')
        console.log('range.from:', range.from)
        console.log('range.to:', range.to)
        console.log('isAtBeginning:', isAtBeginning)
        console.log('loading:', loading)
        console.log('initialLoadCompleteRef.current:', initialLoadCompleteRef.current)
        console.log('loadingMoreRef.current:', loadingMoreRef.current)
        console.log('hasMoreHistoricalDataRef.current:', hasMoreHistoricalDataRef.current)

        if (isAtBeginning && initialLoadCompleteRef.current && !loadingMoreRef.current && hasMoreHistoricalDataRef.current) {
          console.log('Calling loadMoreHistoricalData')
          loadMoreHistoricalDataRef.current()
        }
      }
    })

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize()

    chart.subscribeCrosshairMove((param: any) => {
      if (param.point && param.seriesData.size > 0) {
        const seriesData = param.seriesData.get(candlestickSeries)
        if (seriesData && 'close' in seriesData) {
          if (tradeStageRef.current === 'entry_placed' && activeTradeIdRef.current) {
            const activeTrade = tradePositionsRef.current.find(t => t.id === activeTradeIdRef.current)
            if (activeTrade) {
              const pointerPrice = seriesData.close as number
              const percentage = ((pointerPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100
              setProfitLoss(percentage)
            }
          }
        }
      }
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      markersPluginRef.current?.detach()
      chart.remove()
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return

    const chart = chartRef.current
    const candlestickSeries = seriesRef.current

    const handleClick = (event: MouseEvent) => {
      if (!chartContainerRef.current) return

      const rect = chartContainerRef.current.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const timeScale = chart.timeScale()
      const time = timeScale.coordinateToTime(x)

      if (!time) return

      const clickedTime = time as Time
      let clickedPrice: number = 0

      const data = candlestickSeries.data()
      for (let i = 0; i < data.length; i++) {
        if (data[i].time === clickedTime) {
          clickedPrice = data[i].close
          break
        }
      }

      if (clickedPrice === 0) return

      if (tradeStage === 'idle') {
        const newId = Date.now().toString()
        const newPosition: TradePosition = {
          id: newId,
          entryPrice: clickedPrice,
          entryTime: clickedTime,
        }
        setTradePositions(prev => [...prev, newPosition])
        setActiveTradeId(newId)
        setTradeStage('entry_placed')
        setProfitLoss(0)

        updateMarkers([...tradePositions, newPosition])
      } else if (tradeStage === 'entry_placed' && activeTradeId) {
        const updatedPositions = tradePositions.map(t => {
          if (t.id === activeTradeId) {
            return {
              ...t,
              exitPrice: clickedPrice,
              exitTime: clickedTime,
            }
          }
          return t
        })
        const activeTrade = tradePositions.find(t => t.id === activeTradeId)
        if (activeTrade) {
          const percentage = ((clickedPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100
          setProfitLoss(percentage)

          const exitColor = percentage >= 0 ? '#22ab94' : '#f7525f'
          const exitShape = percentage >= 0 ? 'arrowUp' : 'arrowDown'

          const updatedTrade = { ...activeTrade, exitPrice: clickedPrice, exitTime: clickedTime }
          const positionsWithExit = tradePositions.map(t => t.id === activeTradeId ? updatedTrade : t)
          updateMarkers(positionsWithExit)
        }
        setTradePositions(updatedPositions)
        setTradeStage('idle')
        setActiveTradeId(null)
      }
    }

    const element = chartContainerRef.current
    if (element) {
      element.addEventListener('click', handleClick)
      return () => {
        element.removeEventListener('click', handleClick)
      }
    }
  }, [tradeStage, activeTradeId, tradePositions])

  useEffect(() => {
    tradePositionsRef.current = tradePositions
  }, [tradePositions])

  useEffect(() => {
    activeTradeIdRef.current = activeTradeId
  }, [activeTradeId])

  useEffect(() => {
    tradeStageRef.current = tradeStage
  }, [tradeStage])

  const updateMarkers = (positions: TradePosition[]) => {
    const markers: TradeMarker[] = []
    positions.forEach(trade => {
      markers.push({
        time: trade.entryTime,
        position: 'belowBar',
        color: '#22ab94',
        shape: 'arrowUp',
        text: 'ENTRADA',
      })
      if (trade.exitPrice && trade.exitTime) {
        const percentage = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
        const exitColor = percentage >= 0 ? '#22ab94' : '#f7525f'
        const exitShape = percentage >= 0 ? 'arrowUp' : 'arrowDown'
        markers.push({
          time: trade.exitTime,
          position: 'aboveBar',
          color: exitColor,
          shape: exitShape,
          text: `SALIDA (${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%)`,
        })
      }
    })
    markersPluginRef.current?.setMarkers(markers)
  }

  const resetTrade = () => {
    setTradeStage('idle')
    setTradePositions([])
    setActiveTradeId(null)
    setProfitLoss(0)
    markersPluginRef.current?.setMarkers([])
  }

  const resetActiveTrade = () => {
    setTradeStage('idle')
    setActiveTradeId(null)
    setProfitLoss(0)
  }

  const pnlColor = profitLoss >= 0 ? 'text-green-500' : 'text-red-500'
  const pnlBgColor = profitLoss >= 0 ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <h1 className="text-xl font-bold">Bitcoin Trader - 15m</h1>
          <div className="flex items-center gap-4">
           <div className="text-sm">
             <span className="text-gray-400">BTC Price:</span>
             <span className="ml-2 font-mono">${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
           </div>
           {tradeStage !== 'idle' && (
             <button
               onClick={resetActiveTrade}
               className="px-4 py-1 text-sm bg-yellow-600 hover:bg-yellow-700 rounded transition-colors"
             >
               Cancelar Trade Actual
             </button>
           )}
           {tradePositions.length > 0 && (
             <button
               onClick={resetTrade}
               className="px-4 py-1 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
             >
               Resetear Todos
             </button>
           )}
         </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <div ref={chartContainerRef} data-testid="chart-container" className="w-full h-full" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
              <div className="text-lg">Cargando datos...</div>
            </div>
          )}
          {loadingMore && !loading && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 px-4 py-2 rounded-full text-sm">
              Cargando histórico anterior...
            </div>
          )}
        </div>

        <div className="w-64 bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-4">
          <div className="bg-gray-700 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-2">Estado del Trade</h2>
            <div className="text-lg font-bold">
              {tradeStage === 'idle' && 'Esperando entrada...'}
              {tradeStage === 'entry_placed' && 'Colocando salida...'}
            </div>
          </div>

          {tradeStage === 'entry_placed' && activeTradeId && (
            <>
              {(() => {
                const activeTrade = tradePositions.find(t => t.id === activeTradeId)
                if (!activeTrade) return null
                return (
                  <>
                    <div className="bg-yellow-900 border-2 border-yellow-500 rounded-lg p-4">
                      <h3 className="text-xs font-semibold text-yellow-400 mb-2">📍 Trade Activo</h3>
                      <div className="text-lg font-mono">
                        ${activeTrade.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div className="bg-gray-700 rounded-lg p-4">
                      <h3 className="text-xs font-semibold text-gray-400 mb-2">Porcentaje Puntero</h3>
                      <div className={`text-2xl font-mono ${pnlColor}`}>
                        {profitLoss >= 0 ? '+' : ''}{profitLoss.toFixed(2)}%
                      </div>
                      <div className={`h-2 mt-2 rounded-full ${pnlBgColor}`} style={{ width: `${Math.min(Math.abs(profitLoss), 100)}%` }} />
                      <p className="text-xs text-gray-400 mt-2">Mueve el puntero para ver el porcentaje de recorrido</p>
                    </div>
                  </>
                )
              })()}
            </>
          )}

          {tradePositions.length > 0 && (
            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-gray-400 mb-2">Todas las Operaciones ({tradePositions.length})</h3>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {tradePositions.map((trade, index) => {
                  const isCompleted = trade.exitPrice !== undefined
                  const percentage = isCompleted
                    ? ((trade.exitPrice! - trade.entryPrice) / trade.entryPrice) * 100
                    : 0
                  const color = percentage >= 0 ? 'text-green-500' : 'text-red-500'
                  return (
                    <div
                      key={trade.id}
                      className={`text-xs p-2 rounded ${isCompleted ? 'bg-gray-600' : 'bg-blue-900 border border-blue-500'}`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">#${index + 1}</span>
                        <span className={color}>{isCompleted ? (percentage >= 0 ? '+' : '') + percentage.toFixed(2) + '%' : 'En curso...'}</span>
                      </div>
                      <div className="font-mono text-gray-300">
                        E: ${trade.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        {isCompleted && (
                          <span className="ml-2">
                            S: ${trade.exitPrice!.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="bg-gray-700 rounded-lg p-4 mt-auto">
            <h3 className="text-xs font-semibold text-gray-400 mb-2">Instrucciones</h3>
            <ul className="text-xs space-y-1 text-gray-300">
              <li>• Click en gráfico = Marcar entrada</li>
              <li>• Click de nuevo = Marcar salida</li>
              <li>• Puedes tener múltiples operaciones</li>
              <li>• Mueve el puntero para ver % actual</li>
              <li>• Cancelar Trade Actual = Solo el activo</li>
              <li>• Resetear Todos = Borrar todo</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
