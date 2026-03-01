'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createChart, CandlestickSeries, ColorType, Time, CandlestickData, createSeriesMarkers, ISeriesMarkersPluginApi } from 'lightweight-charts'
import { fetchBitcoinCandlesticks, fetchCandlesWithCache } from '../services/binance'

type TradeStage = 'idle' | 'waiting_entry' | 'entry_placed'
type TradeDirection = 'long' | 'short'

interface SavedRuler {
  id: string
  anchorPrice: number
  anchorTime: number
  endPrice: number
  endTime: number
}

type RulerDomEntry = { rect: HTMLDivElement | null; anchorDot: HTMLDivElement | null; endDot: HTMLDivElement | null; statsBox: HTMLDivElement | null }

interface TradePosition {
  id: string
  direction: TradeDirection
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
  const [tradePositions, setTradePositions] = useState<TradePosition[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('bitcoin-trader-positions')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [selectedTradeIds, setSelectedTradeIds] = useState<Set<string>>(new Set())
  const [nextTradeDirection, setNextTradeDirection] = useState<TradeDirection>('long')
  const nextTradeDirectionRef = useRef<TradeDirection>('long')
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
  const newestCandleTimeRef = useRef<number | null>(null)
  const hasMoreFutureDataRef = useRef(false)
  const loadingMoreFutureRef = useRef(false)
  const [loadingMoreFuture, setLoadingMoreFuture] = useState(false)
  const savePositionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [dateInput, setDateInput] = useState('')
  const [rulerMode, setRulerMode] = useState(false)
  const rulerModeRef = useRef(false)
  const [rulerAnchor, setRulerAnchor] = useState<{ x: number; y: number; price: number; time: number } | null>(null)
  const [rulerCurrent, setRulerCurrent] = useState<{ x: number; y: number; price: number; time: number } | null>(null)
  const rulerAnchorRef = useRef<{ x: number; y: number; price: number; time: number } | null>(null)
  const rulerCurrentRef = useRef<{ x: number; y: number; price: number; time: number } | null>(null)
  const rulerAnchorLineRef = useRef<any>(null)
  const rulerCurrentLineRef = useRef<any>(null)
  const [savedRulers, setSavedRulers] = useState<SavedRuler[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('bitcoin-trader-rulers') || '[]') } catch { return [] }
  })
  const savedRulersRef = useRef<SavedRuler[]>([])
  const rulerDomRefs = useRef<Map<string, RulerDomEntry>>(new Map())
  const rulerRafId = useRef<number | null>(null)
  const [plotInsets, setPlotInsets] = useState({ right: 65, bottom: 32 })
  const plotInsetsRef = useRef({ right: 65, bottom: 32 })

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
      // Guard against React StrictMode double-invocation: si ya hay datos cargados, no sobreescribir
      if (loadedCandlesRef.current.length > 0) return
      try {
        console.log('Setting loading to true')
        setLoading(true)
        initialLoadCompleteRef.current = false
        const data = await fetchBitcoinCandlesticks('5m', 1000)
        // Segunda comprobación tras el await: otra invocación concurrente o navigateToDate pudo haber cargado datos
        if (loadedCandlesRef.current.length > 0) return
        console.log('Received initial data:', data.length, 'candles')
        candlestickSeries.setData(data)
        loadedCandlesRef.current = data
        setLoadedCandles(data)
        if (data.length > 0) {
          const lastCandle = data[data.length - 1]
          setCurrentPrice(lastCandle.close)
          const firstCandleTime = data[0].time
          oldestCandleTimeRef.current = typeof firstCandleTime === 'number' ? firstCandleTime : 0
          newestCandleTimeRef.current = typeof lastCandle.time === 'number' ? lastCandle.time : 0
          hasMoreFutureDataRef.current = false
          console.log('Oldest candle time:', oldestCandleTimeRef.current, new Date(oldestCandleTimeRef.current * 1000))
        }
        console.log('Setting loading to false')
        setLoading(false)
        initialLoadCompleteRef.current = true
        setInitialLoadDone(true)
        console.log('Initial load complete set to true')
        // Update axis insets once chart has rendered with data
        setTimeout(updatePlotInsets, 0)
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
        const newData = await fetchCandlesWithCache('5m', 1000, endTime)
        console.log('Received new data:', newData.length, 'candles')

        if (newData.length === 0) {
          console.log('No more data available')
          hasMoreHistoricalDataRef.current = false
          setHasMoreHistoricalData(false)
        } else {
          const allData = [...newData, ...loadedCandlesRef.current]
          console.log('Updating series with total:', allData.length, 'candles')
          const visibleRange = chart.timeScale().getVisibleRange()
          candlestickSeries.setData(allData)
          if (visibleRange) chart.timeScale().setVisibleRange(visibleRange)
          loadedCandlesRef.current = allData
          setLoadedCandles(allData)
          const firstCandleTime = newData[0].time
          oldestCandleTimeRef.current = typeof firstCandleTime === 'number' ? firstCandleTime : 0
        }
      } catch (error) {
        console.error('Error loading more historical data:', error)
      } finally {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }

    const loadMoreFutureData = async () => {
      if (loadingMoreFutureRef.current || !hasMoreFutureDataRef.current || !newestCandleTimeRef.current) return

      try {
        loadingMoreFutureRef.current = true
        setLoadingMoreFuture(true)
        const startTime = (newestCandleTimeRef.current * 1000) + 1
        const newData = await fetchCandlesWithCache('5m', 1000, undefined, startTime)

        // Filtrar candles que ya están cargados (el caché puede devolver el último candle ya presente)
        const newestLoaded = newestCandleTimeRef.current!
        const filteredNewData = newData.filter(c => (c.time as number) > newestLoaded)

        if (filteredNewData.length === 0) {
          hasMoreFutureDataRef.current = false
        } else {
          const allData = [...loadedCandlesRef.current, ...filteredNewData]

          // Guardar posición visible antes de añadir datos para que no salte
          const visibleRange = chart.timeScale().getVisibleRange()
          candlestickSeries.setData(allData)
          if (visibleRange) {
            chart.timeScale().setVisibleRange(visibleRange)
          }

          loadedCandlesRef.current = allData
          setLoadedCandles(allData)
          const lastCandleTime = filteredNewData[filteredNewData.length - 1].time
          newestCandleTimeRef.current = typeof lastCandleTime === 'number' ? lastCandleTime : 0

          if (newData.length < 1000) {
            hasMoreFutureDataRef.current = false
          }
        }
      } catch (error) {
        console.error('Error al cargar datos futuros:', error)
      } finally {
        loadingMoreFutureRef.current = false
        setLoadingMoreFuture(false)
      }
    }

    loadData()

    const loadMoreHistoricalDataRef = { current: loadMoreHistoricalData }
    const loadMoreFutureDataRef = { current: loadMoreFutureData }

    // RAF loop: update saved ruler DOM positions at 60fps via direct style mutation (no React re-renders)
    const drawRulerPositions = () => {
      if (savedRulersRef.current.length > 0) {
        const ts = chart.timeScale()
        const containerW = chartContainerRef.current?.clientWidth ?? 900
        const plotW = containerW - plotInsetsRef.current.right
        for (const ruler of savedRulersRef.current) {
          const entry = rulerDomRefs.current.get(ruler.id)
          if (!entry) continue
          const ax = ts.timeToCoordinate(ruler.anchorTime as Time) ?? -9999
          const ay = candlestickSeries.priceToCoordinate(ruler.anchorPrice) ?? -9999
          const ex = ts.timeToCoordinate(ruler.endTime as Time) ?? -9999
          const ey = candlestickSeries.priceToCoordinate(ruler.endPrice) ?? -9999
          const rLeft = Math.min(ax, ex)
          const rTop = Math.min(ay, ey)
          const rWidth = Math.abs(ex - ax)
          const rHeight = Math.abs(ey - ay)
          const statsX = rLeft + rWidth + 6 > plotW - 180 ? rLeft - 178 : rLeft + rWidth + 6
          if (entry.rect) {
            entry.rect.style.left = `${rLeft}px`
            entry.rect.style.top = `${rTop}px`
            entry.rect.style.width = `${rWidth}px`
            entry.rect.style.height = `${rHeight}px`
          }
          if (entry.anchorDot) { entry.anchorDot.style.left = `${ax - 4}px`; entry.anchorDot.style.top = `${ay - 4}px` }
          if (entry.endDot)    { entry.endDot.style.left    = `${ex - 4}px`; entry.endDot.style.top    = `${ey - 4}px` }
          if (entry.statsBox)  { entry.statsBox.style.left  = `${statsX}px`; entry.statsBox.style.top  = `${rTop}px` }
        }
      }
      rulerRafId.current = requestAnimationFrame(drawRulerPositions)
    }
    rulerRafId.current = requestAnimationFrame(drawRulerPositions)

    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleLogicalRangeChange((range: any) => {
      if (range && range.from !== null && range.to !== null) {
        const isAtBeginning = range.from <= 10
        const isAtEnd = range.to >= loadedCandlesRef.current.length - 10

        if (isAtBeginning && initialLoadCompleteRef.current && !loadingMoreRef.current && hasMoreHistoricalDataRef.current) {
          loadMoreHistoricalDataRef.current()
        }

        if (isAtEnd && initialLoadCompleteRef.current && !loadingMoreFutureRef.current && hasMoreFutureDataRef.current) {
          loadMoreFutureDataRef.current()
        }

        // Guardar posición visible con debounce para no saturar localStorage
        if (savePositionTimeoutRef.current) clearTimeout(savePositionTimeoutRef.current)
        savePositionTimeoutRef.current = setTimeout(() => {
          const timeRange = chart.timeScale().getVisibleRange()
          if (timeRange) {
            const from = timeRange.from as number
            const to = timeRange.to as number
            localStorage.setItem('bitcoin-trader-chart-position', JSON.stringify({
              from,
              to,
              centerTime: Math.floor((from + to) / 2),
            }))
          }
        }, 500)

      }
    })

    const updatePlotInsets = () => {
      try {
        const right = chart.priceScale('right').width()
        const bottom = (chart.timeScale() as any).height?.() ?? 32
        if (right > 0 && (right !== plotInsetsRef.current.right || bottom !== plotInsetsRef.current.bottom)) {
          plotInsetsRef.current = { right, bottom }
          setPlotInsets({ right, bottom })
        }
      } catch { /* ignore if API not available */ }
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
        updatePlotInsets()
      }
    }

    window.addEventListener('resize', handleResize)
    handleResize()

    // Ruler tool: mouse move listener to track current position
    const chartEl = chartContainerRef.current!
    const handleRulerMove = (e: MouseEvent) => {
      if (!rulerModeRef.current || !rulerAnchorRef.current) return
      const rect = chartEl.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const time = timeScale.coordinateToTime(x)
      const price = candlestickSeries.coordinateToPrice(y)
      if (time !== null && price !== null) {
        const cur = { x, y, price, time: time as number }
        setRulerCurrent(cur)
        rulerCurrentRef.current = cur
        // Update current price line on the axis
        const isAbove = price >= rulerAnchorRef.current.price
        const lineColor = isAbove ? 'rgba(34,171,148,0.9)' : 'rgba(247,82,95,0.9)'
        if (rulerCurrentLineRef.current) {
          rulerCurrentLineRef.current.applyOptions({ price, color: lineColor })
        } else {
          rulerCurrentLineRef.current = candlestickSeries.createPriceLine({
            price,
            color: lineColor,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '',
          })
        }
      }
    }
    chartEl.addEventListener('mousemove', handleRulerMove)

    chart.subscribeCrosshairMove((param: any) => {
      if (param.point && param.seriesData.size > 0) {
        const seriesData = param.seriesData.get(candlestickSeries)
        if (seriesData && 'close' in seriesData) {
          if (tradeStageRef.current === 'entry_placed' && activeTradeIdRef.current) {
            const activeTrade = tradePositionsRef.current.find(t => t.id === activeTradeIdRef.current)
            if (activeTrade) {
              const pointerPrice = seriesData.close as number
              // Usar cálculo direccional para el puntero
              const percentage = calculateProfitLoss(
                activeTrade.entryPrice,
                pointerPrice,
                activeTrade.direction
              )
              setProfitLoss(percentage)
            }
          }
        }
      }
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      chartEl.removeEventListener('mousemove', handleRulerMove)
      if (rulerRafId.current) cancelAnimationFrame(rulerRafId.current)
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

      // Ruler tool intercepts all clicks when active
      if (rulerModeRef.current) {
        const time = chart.timeScale().coordinateToTime(x)
        const price = candlestickSeries.coordinateToPrice(y)
        if (time === null || price === null) return
        if (!rulerAnchorRef.current) {
          const anchor = { x, y, price, time: time as number }
          setRulerAnchor(anchor)
          rulerAnchorRef.current = anchor
          // Pin anchor price on the axis (neutral cyan)
          rulerAnchorLineRef.current = candlestickSeries.createPriceLine({
            price,
            color: 'rgba(100,200,255,0.85)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '',
          })
        } else {
          // Second click: save the ruler and clear active state for a new measurement
          if (rulerCurrentRef.current) {
            const newRuler: SavedRuler = {
              id: Date.now().toString(),
              anchorPrice: rulerAnchorRef.current.price,
              anchorTime: rulerAnchorRef.current.time,
              endPrice: rulerCurrentRef.current.price,
              endTime: rulerCurrentRef.current.time,
            }
            setSavedRulers(prev => [...prev, newRuler])
          }
          // Remove active price lines
          if (rulerAnchorLineRef.current) {
            candlestickSeries.removePriceLine(rulerAnchorLineRef.current)
            rulerAnchorLineRef.current = null
          }
          if (rulerCurrentLineRef.current) {
            candlestickSeries.removePriceLine(rulerCurrentLineRef.current)
            rulerCurrentLineRef.current = null
          }
          setRulerAnchor(null)
          setRulerCurrent(null)
          rulerAnchorRef.current = null
          rulerCurrentRef.current = null
        }
        return
      }

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

      if (tradeStage === 'waiting_entry') {
        const newId = Date.now().toString()
        const newPosition: TradePosition = {
          id: newId,
          direction: nextTradeDirectionRef.current,
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
          // Usar cálculo direccional para la salida
          const percentage = calculateProfitLoss(
            activeTrade.entryPrice,
            clickedPrice,
            activeTrade.direction
          )
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
        setNextTradeDirection('long') // reset para que ningún botón quede activo visualmente
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
    localStorage.setItem('bitcoin-trader-positions', JSON.stringify(tradePositions))
  }, [tradePositions])

  useEffect(() => {
    nextTradeDirectionRef.current = nextTradeDirection
  }, [nextTradeDirection])

  useEffect(() => {
    activeTradeIdRef.current = activeTradeId
  }, [activeTradeId])

  useEffect(() => {
    tradeStageRef.current = tradeStage
  }, [tradeStage])

  useEffect(() => {
    rulerModeRef.current = rulerMode
    if (!rulerMode) {
      if (seriesRef.current) {
        if (rulerAnchorLineRef.current) {
          seriesRef.current.removePriceLine(rulerAnchorLineRef.current)
          rulerAnchorLineRef.current = null
        }
        if (rulerCurrentLineRef.current) {
          seriesRef.current.removePriceLine(rulerCurrentLineRef.current)
          rulerCurrentLineRef.current = null
        }
      }
      setRulerAnchor(null)
      setRulerCurrent(null)
      rulerAnchorRef.current = null
    }
  }, [rulerMode])

  useEffect(() => {
    rulerAnchorRef.current = rulerAnchor
  }, [rulerAnchor])

  useEffect(() => {
    savedRulersRef.current = savedRulers
    localStorage.setItem('bitcoin-trader-rulers', JSON.stringify(savedRulers))
  }, [savedRulers])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rulerModeRef.current) setRulerMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Restaurar marcadores del gráfico tras cualquier carga (inicial o navegación a fecha)
  useEffect(() => {
    if (!loading && tradePositionsRef.current.length > 0) {
      updateMarkers(tradePositionsRef.current)
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restaurar posición del gráfico la primera vez que los datos iniciales están listos
  useEffect(() => {
    if (!initialLoadDone) return

    try {
      const stored = localStorage.getItem('bitcoin-trader-chart-position')
      if (!stored) return

      const { from, to, centerTime } = JSON.parse(stored)
      const loadedData = loadedCandlesRef.current
      if (loadedData.length === 0) return

      const dataStart = loadedData[0].time as number

      if (from >= dataStart) {
        // La posición guardada está dentro del rango cargado: solo hacemos scroll
        chartRef.current?.timeScale().setVisibleRange({ from: from as Time, to: to as Time })
      } else {
        // La posición guardada es más antigua que los datos cargados: navegamos a esa fecha
        navigateToDate(new Date(centerTime * 1000))
      }
    } catch {
      // Si hay error leyendo la posición guardada, simplemente ignorar
    }
  }, [initialLoadDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMarkers = (positions: TradePosition[]) => {
    const markers: TradeMarker[] = []
    positions.forEach(trade => {
      // Configuración según dirección
      const entryColor = trade.direction === 'long' ? '#22ab94' : '#f7525f'
      const entryShape = trade.direction === 'long' ? 'arrowUp' : 'arrowDown'
      const entryText = trade.direction === 'long' ? '📈 ENTRADA LONG' : '📉 ENTRADA SHORT'
      const entryPosition = trade.direction === 'long' ? 'belowBar' : 'aboveBar'

      markers.push({
        time: trade.entryTime,
        position: entryPosition,
        color: entryColor,
        shape: entryShape,
        text: entryText,
      })

      if (trade.exitPrice && trade.exitTime) {
        // Usar la función de cálculo direccional
        const percentage = calculateProfitLoss(
          trade.entryPrice,
          trade.exitPrice,
          trade.direction
        )
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

  // Función de cálculo de P&L con direccionalidad
  const calculateProfitLoss = (
    entryPrice: number,
    exitPrice: number,
    direction: TradeDirection
  ): number => {
    if (direction === 'long') {
      return ((exitPrice - entryPrice) / entryPrice) * 100
    } else {
      // Para short: ganamos cuando el precio baja
      return ((entryPrice - exitPrice) / entryPrice) * 100
    }
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
    setNextTradeDirection('long')
  }

  const undoLastTrade = () => {
    // No hacer nada si no hay operaciones
    if (tradePositions.length === 0) return

    // Si hay un trade activo (sin salida), cancelarlo primero
    if (activeTradeId) {
      resetActiveTrade()
      return
    }

    // Eliminar la última operación completada
    const newPositions = tradePositions.slice(0, -1)
    setTradePositions(newPositions)

    // Actualizar marcadores del gráfico
    updateMarkers(newPositions)
  }

  const deleteTrade = (id: string) => {
    const newPositions = tradePositions.filter(t => t.id !== id)

    // Si eliminamos el trade activo, resetear
    if (activeTradeId === id) {
      resetActiveTrade()
    }

    setTradePositions(newPositions)
    updateMarkers(newPositions)

    // Remover de selección si estaba seleccionado
    const newSelected = new Set(selectedTradeIds)
    newSelected.delete(id)
    setSelectedTradeIds(newSelected)
  }

  const toggleTradeSelection = (id: string) => {
    const newSelected = new Set(selectedTradeIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedTradeIds(newSelected)
  }

  const deleteSelectedTrades = () => {
    if (selectedTradeIds.size === 0) return

    const newPositions = tradePositions.filter(t => !selectedTradeIds.has(t.id))

    // Si el trade activo está entre los seleccionados, resetear
    if (activeTradeId && selectedTradeIds.has(activeTradeId)) {
      resetActiveTrade()
    }

    setTradePositions(newPositions)
    updateMarkers(newPositions)
    setSelectedTradeIds(new Set())
  }

  const selectAllTrades = () => {
    const allIds = new Set(tradePositions.map(t => t.id))
    setSelectedTradeIds(allIds)
  }

  const deselectAllTrades = () => {
    setSelectedTradeIds(new Set())
  }

  const navigateToDate = async (targetDate: Date) => {
    if (!chartRef.current || !seriesRef.current) return

    setLoading(true)
    initialLoadCompleteRef.current = false

    // endTime = target + 250 velas de 5min hacia adelante para que la fecha quede centrada
    const targetMs = targetDate.getTime()
    const endTimeMs = targetMs + 250 * 5 * 60 * 1000

    try {
      const data = await fetchCandlesWithCache('5m', 1000, endTimeMs)

      if (data.length === 0) {
        setLoading(false)
        return
      }

      seriesRef.current.setData(data)
      loadedCandlesRef.current = data
      setLoadedCandles(data)

      const firstCandleTime = data[0].time
      oldestCandleTimeRef.current = typeof firstCandleTime === 'number' ? firstCandleTime : 0

      const lastCandleTime = data[data.length - 1].time
      newestCandleTimeRef.current = typeof lastCandleTime === 'number' ? lastCandleTime : 0

      hasMoreHistoricalDataRef.current = true
      setHasMoreHistoricalData(true)
      hasMoreFutureDataRef.current = true

      // Centrar la vista: 50 velas antes y 150 velas después del target
      const targetUnix = Math.floor(targetMs / 1000)
      chartRef.current.timeScale().setVisibleRange({
        from: (targetUnix - 50 * 5 * 60) as Time,
        to: (targetUnix + 150 * 5 * 60) as Time,
      })

      setLoading(false)
      initialLoadCompleteRef.current = true
    } catch (error) {
      console.error('Error al navegar a la fecha:', error)
      setLoading(false)
    }
  }

  const deleteRuler = (id: string) => {
    setSavedRulers(prev => prev.filter(r => r.id !== id))
    rulerDomRefs.current.delete(id)
  }
  const deleteAllRulers = () => {
    setSavedRulers([])
    rulerDomRefs.current.clear()
  }

  const countCandlesInRange = (t1: number, t2: number): number => {
    const lo = Math.min(t1, t2)
    const hi = Math.max(t1, t2)
    return loadedCandlesRef.current.filter(c => {
      const t = c.time as number
      return t >= lo && t <= hi
    }).length
  }

  const formatTimeDiff = (secs: number): string => {
    const abs = Math.abs(secs)
    const m = Math.floor(abs / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    if (h > 0) return `${h}h ${m % 60}m`
    return `${m}m`
  }

  const pnlColor = profitLoss >= 0 ? 'text-green-500' : 'text-red-500'
  const pnlBgColor = profitLoss >= 0 ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Bitcoin Trader - 5m</h1>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (activeTradeId) resetActiveTrade()
                setNextTradeDirection('long')
                setTradeStage('waiting_entry')
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                tradeStage === 'waiting_entry' && nextTradeDirection === 'long'
                  ? 'bg-green-500 text-white font-semibold ring-2 ring-green-300 animate-pulse'
                  : tradeStage === 'entry_placed' && nextTradeDirection === 'long'
                  ? 'bg-green-700 text-white font-semibold'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              📈 LONG
            </button>
            <button
              onClick={() => {
                if (activeTradeId) resetActiveTrade()
                setNextTradeDirection('short')
                setTradeStage('waiting_entry')
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                tradeStage === 'waiting_entry' && nextTradeDirection === 'short'
                  ? 'bg-red-500 text-white font-semibold ring-2 ring-red-300 animate-pulse'
                  : tradeStage === 'entry_placed' && nextTradeDirection === 'short'
                  ? 'bg-red-700 text-white font-semibold'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              📉 SHORT
            </button>
          </div>
          <button
              onClick={() => {
                setRulerMode(prev => !prev)
                if (tradeStage !== 'idle') resetActiveTrade()
              }}
              className={`px-3 py-1 text-sm rounded transition-colors flex items-center gap-1.5 ${
                rulerMode
                  ? 'bg-cyan-600 text-white font-semibold ring-2 ring-cyan-400'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title="Herramienta de regla (Esc para salir)"
            >
              📏 Regla{savedRulers.length > 0 && (
                <span className="bg-cyan-800 text-cyan-200 text-xs px-1.5 py-0.5 rounded-full leading-none">
                  {savedRulers.length}
                </span>
              )}
            </button>
            {savedRulers.length > 0 && (
              <button
                onClick={deleteAllRulers}
                className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-red-900 hover:text-red-300 transition-colors"
                title="Borrar todas las reglas"
              >
                🗑️ Reglas
              </button>
            )}
          <div className="flex items-center gap-2 border-l border-gray-600 pl-4">
            <span className="text-xs text-gray-400 whitespace-nowrap">Ir a fecha:</span>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="bg-gray-700 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => {
                if (!dateInput) return
                navigateToDate(new Date(dateInput + 'T12:00:00'))
              }}
              disabled={!dateInput || loading}
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap"
            >
              Ir →
            </button>
          </div>
        </div>
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
               {tradeStage === 'waiting_entry' ? 'Cancelar' : 'Cancelar Trade Actual'}
             </button>
           )}
           {tradePositions.length > 0 && (
             <button
               onClick={undoLastTrade}
               disabled={activeTradeId !== null}
               className={`px-4 py-1 text-sm rounded transition-colors ${
                 activeTradeId !== null
                   ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                   : 'bg-blue-600 hover:bg-blue-700'
               }`}
               title={activeTradeId !== null ? 'Cancela el trade activo primero' : 'Deshacer última operación'}
             >
               ↩️ Deshacer
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
           <Link
             href="/trades"
             className="px-4 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors border border-gray-600 flex items-center gap-1"
           >
             📋 Ver operaciones
             {tradePositions.length > 0 && (
               <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">
                 {tradePositions.length}
               </span>
             )}
           </Link>
         </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={chartContainerRef}
            data-testid="chart-container"
            className={`w-full h-full${rulerMode ? ' cursor-crosshair' : ''}`}
          />

          {/* Saved rulers — positions updated at 60fps via RAF (no React re-renders during scroll) */}
          {savedRulers.map(ruler => {
            const priceDiff = ruler.endPrice - ruler.anchorPrice
            const pricePct = (priceDiff / ruler.anchorPrice) * 100
            const candleCount = countCandlesInRange(ruler.anchorTime, ruler.endTime)
            const duration = formatTimeDiff(ruler.endTime - ruler.anchorTime)
            const isUp = priceDiff >= 0
            const accentColor = isUp ? '#22ab94' : '#f7525f'
            const fillColor = isUp ? 'rgba(34,171,148,0.07)' : 'rgba(247,82,95,0.07)'
            const textCls = isUp ? 'text-emerald-400' : 'text-red-400'
            const setRef = (key: keyof RulerDomEntry) => (el: HTMLDivElement | null) => {
              const prev = rulerDomRefs.current.get(ruler.id) ?? { rect: null, anchorDot: null, endDot: null, statsBox: null }
              rulerDomRefs.current.set(ruler.id, { ...prev, [key]: el })
            }
            return (
              <div key={ruler.id} className="absolute overflow-hidden" style={{ top: 0, left: 0, right: `${plotInsets.right}px`, bottom: `${plotInsets.bottom}px`, zIndex: 4, pointerEvents: 'none' }}>
                {/* RAF sets left/top/width/height — initial values just need to exist */}
                <div ref={setRef('rect')} className="absolute" style={{ border: `1.5px solid ${accentColor}`, background: fillColor }} />
                <div ref={setRef('anchorDot')} className="absolute w-2 h-2 rounded-full border border-gray-900" style={{ background: accentColor }} />
                <div ref={setRef('endDot')} className="absolute w-2 h-2 rounded-full border border-gray-900" style={{ background: accentColor }} />
                <div
                  ref={setRef('statsBox')}
                  className="absolute rounded border border-gray-600 text-xs font-mono shadow-lg"
                  style={{ minWidth: '170px', background: 'rgba(15,17,24,0.97)', zIndex: 10, pointerEvents: 'auto' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between px-2.5 pt-2 pb-1.5 gap-2">
                    <div>
                      <div className={`text-sm font-bold leading-tight ${textCls}`}>
                        {priceDiff >= 0 ? '+' : ''}{priceDiff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      </div>
                      <div className={`leading-tight ${textCls}`}>{pricePct >= 0 ? '+' : ''}{pricePct.toFixed(3)}%</div>
                      <div className="border-t border-gray-700 mt-1.5 pt-1 text-gray-300 leading-tight">{candleCount} vela{candleCount !== 1 ? 's' : ''}</div>
                      <div className="text-blue-300 leading-tight">{duration}</div>
                    </div>
                    <button
                      onClick={() => deleteRuler(ruler.id)}
                      className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none mt-0.5 flex-shrink-0"
                      title="Eliminar regla"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Active ruler overlay — rendered above the chart canvas, pointer-events disabled */}
          {rulerMode && rulerAnchor && (() => {
            const priceDiff = rulerCurrent ? rulerCurrent.price - rulerAnchor.price : 0
            const pricePct = rulerAnchor.price !== 0 ? (priceDiff / rulerAnchor.price) * 100 : 0
            const timeDiff = rulerCurrent ? rulerCurrent.time - rulerAnchor.time : 0
            const candleCount = rulerCurrent ? countCandlesInRange(rulerAnchor.time, rulerCurrent.time) : 0
            const duration = formatTimeDiff(timeDiff)
            const isUp = priceDiff >= 0
            const accentColor = isUp ? '#22ab94' : '#f7525f'
            const fillColor = isUp ? 'rgba(34,171,148,0.08)' : 'rgba(247,82,95,0.08)'
            const textCls = isUp ? 'text-emerald-400' : 'text-red-400'

            const rLeft = rulerCurrent ? Math.min(rulerAnchor.x, rulerCurrent.x) : rulerAnchor.x
            const rTop = rulerCurrent ? Math.min(rulerAnchor.y, rulerCurrent.y) : rulerAnchor.y
            const rWidth = rulerCurrent ? Math.abs(rulerCurrent.x - rulerAnchor.x) : 0
            const rHeight = rulerCurrent ? Math.abs(rulerCurrent.y - rulerAnchor.y) : 0

            // Stats box: prefer right side of cursor, flip if near edge (use plot width, not full container)
            const plotWidth = (chartContainerRef.current?.clientWidth ?? 800) - plotInsets.right
            const boxX = rulerCurrent
              ? (rulerCurrent.x > plotWidth - 190
                ? rulerCurrent.x - 176
                : rulerCurrent.x + 14)
              : rulerAnchor.x + 14
            const boxY = rulerCurrent
              ? (rulerCurrent.y > (chartContainerRef.current?.clientHeight ?? 600) - 110
                ? rulerCurrent.y - 96
                : rulerCurrent.y + 10)
              : rulerAnchor.y + 10

            return (
              <div className="absolute overflow-hidden pointer-events-none" style={{ top: 0, left: 0, right: `${plotInsets.right}px`, bottom: `${plotInsets.bottom}px`, zIndex: 5 }}>
                {/* Anchor dot */}
                <div
                  className="absolute w-2.5 h-2.5 rounded-full border-2 border-gray-900"
                  style={{ left: rulerAnchor.x - 5, top: rulerAnchor.y - 5, background: accentColor }}
                />

                {rulerCurrent && (
                  <>
                    {/* Measurement rectangle */}
                    <div
                      className="absolute"
                      style={{
                        left: rLeft,
                        top: rTop,
                        width: rWidth,
                        height: rHeight,
                        border: `1.5px solid ${accentColor}`,
                        background: fillColor,
                      }}
                    />

                    {/* Current point dot */}
                    <div
                      className="absolute w-2.5 h-2.5 rounded-full border-2 border-gray-900"
                      style={{ left: rulerCurrent.x - 5, top: rulerCurrent.y - 5, background: accentColor }}
                    />

                    {/* Stats info box */}
                    <div
                      className="absolute rounded border border-gray-600 px-2.5 py-2 text-xs font-mono shadow-lg"
                      style={{
                        left: boxX,
                        top: boxY,
                        minWidth: '164px',
                        background: 'rgba(15,17,24,0.97)',
                        zIndex: 10,
                      }}
                    >
                      <div className={`text-sm font-bold leading-tight ${textCls}`}>
                        {priceDiff >= 0 ? '+' : ''}
                        {priceDiff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                      </div>
                      <div className={`leading-tight ${textCls}`}>
                        {pricePct >= 0 ? '+' : ''}{pricePct.toFixed(3)}%
                      </div>
                      <div className="border-t border-gray-700 mt-1.5 pt-1.5 text-gray-300 leading-tight">
                        {candleCount} vela{candleCount !== 1 ? 's' : ''}
                      </div>
                      <div className="text-blue-300 leading-tight">{duration}</div>
                    </div>
                  </>
                )}

                {/* Hint when anchor is set but mouse hasn't moved yet */}
                {!rulerCurrent && (
                  <div
                    className="absolute text-xs text-cyan-300 bg-gray-900 bg-opacity-80 px-2 py-1 rounded border border-cyan-800"
                    style={{ left: rulerAnchor.x + 10, top: rulerAnchor.y - 24 }}
                  >
                    Mueve el mouse para medir
                  </div>
                )}
              </div>
            )
          })()}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
              <div className="text-lg">Cargando datos...</div>
            </div>
          )}
          {loadingMore && !loading && (
            <div className="absolute top-4 left-4 bg-blue-600 px-4 py-2 rounded-full text-sm">
              ← Cargando histórico anterior...
            </div>
          )}
          {loadingMoreFuture && !loading && (
            <div className="absolute top-4 right-4 bg-green-600 px-4 py-2 rounded-full text-sm">
              Cargando datos siguientes... →
            </div>
          )}
        </div>

        <div className="w-64 bg-gray-800 border-l border-gray-700 p-4 flex flex-col gap-4">
          <div className="bg-gray-700 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-2">Estado del Trade</h2>
            <div className="text-lg font-bold">
              {tradeStage === 'idle' && <span className="text-gray-400 text-sm">Pulsa LONG o SHORT para empezar</span>}
              {tradeStage === 'waiting_entry' && (
                <span className={nextTradeDirection === 'long' ? 'text-green-400' : 'text-red-400'}>
                  Clic para marcar entrada {nextTradeDirection === 'long' ? '📈 LONG' : '📉 SHORT'}
                </span>
              )}
              {tradeStage === 'entry_placed' && 'Clic para marcar salida...'}
            </div>
          </div>

          {tradeStage === 'entry_placed' && activeTradeId && (
            <>
              {(() => {
                const activeTrade = tradePositions.find(t => t.id === activeTradeId)
                if (!activeTrade) return null
                const isLong = activeTrade.direction === 'long'
                const directionColor = isLong ? 'border-green-500 bg-green-900' : 'border-red-500 bg-red-900'
                const directionText = isLong ? '📈 LONG' : '📉 SHORT'
                return (
                  <>
                    <div className={`${directionColor} border-2 rounded-lg p-4`}>
                      <h3 className="text-xs font-semibold text-yellow-400 mb-2">📍 Trade Activo - {directionText}</h3>
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
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-semibold text-gray-400">Todas las Operaciones ({tradePositions.length})</h3>
                <div className="flex gap-1">
                  <button
                    onClick={selectAllTrades}
                    className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded transition-colors"
                    title="Seleccionar todas"
                  >
                    ☑️ Todos
                  </button>
                  <button
                    onClick={deselectAllTrades}
                    className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded transition-colors"
                    title="Deseleccionar todas"
                  >
                    🔲 Ninguno
                  </button>
                </div>
              </div>

              {selectedTradeIds.size > 0 && (
                <button
                  onClick={deleteSelectedTrades}
                  className="w-full mb-2 px-3 py-2 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors font-semibold"
                >
                  🗑️ Eliminar {selectedTradeIds.size} seleccionada{selectedTradeIds.size > 1 ? 's' : ''}
                </button>
              )}

              <div className="max-h-64 overflow-y-auto space-y-2">
                {tradePositions.map((trade, index) => {
                  const isCompleted = trade.exitPrice !== undefined
                  const isLong = trade.direction === 'long'
                  const isSelected = selectedTradeIds.has(trade.id)
                  // Usar cálculo direccional para el porcentaje
                  const percentage = isCompleted
                    ? calculateProfitLoss(trade.entryPrice, trade.exitPrice!, trade.direction)
                    : 0
                  const color = percentage >= 0 ? 'text-green-500' : 'text-red-500'
                  const directionBadge = isLong ? '📈' : '📉'
                  const directionBorder = isLong ? 'border-l-green-500' : 'border-l-red-500'
                  return (
                    <div
                      key={trade.id}
                      className={`text-xs p-2 rounded border-l-4 ${directionBorder} ${
                        isSelected ? 'bg-blue-800 ring-2 ring-blue-400' : isCompleted ? 'bg-gray-600' : 'bg-blue-900 border border-blue-500'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTradeSelection(trade.id)}
                          className="mt-1 w-4 h-4 rounded cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">#${index + 1} {directionBadge} {isLong ? 'LONG' : 'SHORT'}</span>
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
                        <button
                          onClick={() => deleteTrade(trade.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900 rounded p-1 transition-colors"
                          title="Eliminar esta operación"
                        >
                          ✕
                        </button>
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
              <li>1. Pulsa <strong>LONG</strong> o <strong>SHORT</strong></li>
              <li>2. Clic en el gráfico = Entrada</li>
              <li>3. Clic de nuevo = Salida</li>
              <li className="pt-1 border-t border-gray-600 font-semibold text-cyan-400">📏 Regla</li>
              <li>• Activa con el botón Regla</li>
              <li>• 1er clic = ancla el punto</li>
              <li>• Mueve el mouse = rectángulo vivo</li>
              <li>• 2do clic = nueva medición</li>
              <li>• Esc = desactivar regla</li>
              <li className="pt-1 border-t border-gray-600">• Navega sin trades hasta pulsar botón</li>
              <li>• Mueve el puntero para ver % actual</li>
              <li>• ✕ para eliminar individual</li>
              <li>• Deshacer = Elimina última operación</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
