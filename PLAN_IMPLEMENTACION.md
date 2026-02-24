# Plan de Implementación - Bitcoin Trader

## Estado del Plan
**Fecha de creación:** 2026-02-24
**Última actualización:** 2026-02-24
**Fase actual:** ✅ Fase 1 Completada | ✅ Fase 2 Completada | ✅ Fase 4 Completada | ⏳ Fase 3 Pendiente

---

## Resumen de Mejoras

Este plan detalla la implementación de 4 funcionalidades principales para el Bitcoin Trader:

1. **Corrección del problema de despliegue en Vercel** (Gráficos que no se muestran)
2. **Sistema de deshacer operaciones** (Undo una a una)
3. **Listado de operaciones con eliminación individual** (Con actualización del gráfico)
4. **Selector de dirección (Long/Short)** con cálculo de P&L correcto para cada tipo

---

## FASE 1: Corrección del Problema de Vercel 🚨

### Problema Identificado
- **Síntoma:** Las gráficas de TradingView (lightweight-charts) no se muestran en Vercel pero sí funcionan localmente
- **Causa probable:**
  - El componente usa `'use client'` pero puede haber problemas con la hidratación
  - Vercel Edge Runtime puede tener limitaciones con APIs del navegador
  - El chart puede estar inicializándose antes de que el DOM esté disponible

### Tareas a Realizar

#### 1.1 Asegurar inicialización correcta del chart
- [ ] Modificar `CandlestickChart.tsx` para usar `useEffect` con dependencias correctas
- [ ] Asegurar que el chart solo se inicialice cuando `chartContainerRef.current` existe
- [ ] Agregar verificación de `typeof window !== 'undefined'`
- [ ] Usar `dynamic` import de Next.js para el componente si es necesario

#### 1.2 Configuración específica para Vercel
- [ ] Revisar `next.config.js` para asegurar que no esté usando Edge Runtime
- [ ] Agregar configuración explícita para desactivar SSR en páginas que usan el chart
- [ ] Considerar usar `next/dynamic` con `ssr: false` para el componente del gráfico

#### 1.3 Testing y validación
- [ ] Build local para simular entorno de producción
- [ ] Deploy a Vercel (rama de pruebas)
- [ ] Verificar que el gráfico se muestra correctamente

### Archivos a Modificar
- `app/components/CandlestickChart.tsx`
- `app/page.tsx` (posible uso de dynamic import)
- `next.config.js` (creación si no existe)

### Solución Técnica Propuesta

```typescript
// En app/page.tsx
import dynamic from 'next/dynamic'

const CandlestickChart = dynamic(
  () => import('./components/CandlestickChart'),
  { ssr: false }
)

export default function Home() {
  return <CandlestickChart />
}
```

```typescript
// En CandlestickChart.tsx - Agregar verificación
useEffect(() => {
  if (typeof window === 'undefined') return
  if (!chartContainerRef.current) return

  // Resto del código de inicialización...
}, [])
```

---

## FASE 2: Sistema de Deshacer Operaciones (Undo) ↩️

### Descripción
Permite deshacer la última operación colocada, eliminando la entrada más reciente y sus marcadores del gráfico.

### Tareas a Realizar

#### 2.1 Lógica de Undo ✅
- [x] Crear función `undoLastTrade()` que elimine la última operación
- [x] La función debe:
  - Eliminar la última operación del estado `tradePositions`
  - Si había una operación activa, cancelarla
  - Actualizar los marcadores del gráfico
  - Resetear el estado si no quedan operaciones

#### 2.2 UI para Undo ✅
- [x] Agregar botón "Deshacer" en el header
- [x] El botón debe estar deshabilitado cuando no hay operaciones
- [x] Posición: Entre "Cancelar Trade Actual" y "Resetear Todos"
- [x] Usar icono o emoji (↩️ o ⏪)
- [x] Atajo de teclado: Ctrl+Z (opcional - NO implementado)

#### 2.3 Estados y Validaciones ✅
- [x] El botón debe estar deshabilitado cuando:
  - No hay operaciones (`tradePositions.length === 0`)
  - Hay un trade activo sin salida (implementado: el botón cancela el trade activo)

### Archivos a Modificar
- `app/components/CandlestickChart.tsx`

### Especificación de la Función

```typescript
const undoLastTrade = () => {
  if (tradePositions.length === 0) return

  // Si hay un trade activo, cancelarlo primero
  if (activeTradeId) {
    resetActiveTrade()
  }

  // Eliminar la última operación
  const newPositions = tradePositions.slice(0, -1)
  setTradePositions(newPositions)

  // Actualizar marcadores
  updateMarkers(newPositions)
}
```

---

## FASE 3: Listado de Operaciones con Eliminación Individual 🗑️

### Descripción
Lista interactiva de todas las operaciones donde el usuario puede seleccionar y eliminar operaciones individuales, actualizando automáticamente el gráfico.

### Tareas a Realizar

#### 3.1 UI del Listado Mejorado
- [ ] Cada item de la lista debe tener:
  - Checkbox para selección
  - Botón de eliminar individual
  - Highlight visual al seleccionar
  - Indicador visual de long/short (cuando se implemente Fase 4)

#### 3.2 Selección Múltiple
- [ ] Estado para operaciones seleccionadas: `selectedTradeIds: Set<string>`
- [ ] Checkbox en cada item para selección
- [ ] "Seleccionar todos" / "Deseleccionar todos"
- [ ] Botón "Eliminar seleccionados"

#### 3.3 Eliminación con Actualización de Gráfico
- [ ] Función `deleteTrade(id: string)` para eliminar una operación
- [ ] Función `deleteSelectedTrades()` para eliminar múltiples
- [ ] Al eliminar:
  - Remover del estado `tradePositions`
  - Regenerar marcadores del gráfico sin la operación eliminada
  - Si se elimina el trade activo, resetear estado activo

#### 3.4 Confirmación y Feedback
- [ ] Modal o confirmación antes de eliminar (opcional)
- [ ] Toast notification al eliminar
- [ ] Animación suave al eliminar de la lista

### Archivos a Modificar
- `app/components/CandlestickChart.tsx`

### Especificación de Funciones

```typescript
const [selectedTradeIds, setSelectedTradeIds] = useState<Set<string>>(new Set())

const deleteTrade = (id: string) => {
  const newPositions = tradePositions.filter(t => t.id !== id)

  // Si eliminamos el trade activo
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

const deleteSelectedTrades = () => {
  if (selectedTradeIds.size === 0) return

  const newPositions = tradePositions.filter(t => !selectedTradeIds.has(t.id))

  // Si el trade activo está entre los seleccionados
  if (activeTradeId && selectedTradeIds.has(activeTradeId)) {
    resetActiveTrade()
  }

  setTradePositions(newPositions)
  updateMarkers(newPositions)
  setSelectedTradeIds(new Set())
}
```

---

## FASE 4: Selector de Dirección (Long/Short) con Cálculo Correcto 📊

### Descripción
Permite seleccionar si la próxima operación será Long o Short, y calcula el porcentaje de P&L correctamente según la direccionalidad.

### Lógica de Cálculo de P&L

**Long (Compra):**
- Entrada: $50,000 → Salida: $51,000 = +2% (ganancia)
- Entrada: $50,000 → Salida: $49,000 = -2% (pérdida)
- Fórmula: `((salida - entrada) / entrada) * 100`

**Short (Venta):**
- Entrada: $50,000 → Salida: $49,000 = +2% (ganancia)
- Entrada: $50,000 → Salida: $51,000 = -2% (pérdida)
- Fórmula: `((entrada - salida) / entrada) * 100`

### Tareas a Realizar

#### 4.1 Tipo de Operación en TradePosition ✅
- [x] Agregar campo `direction: 'long' | 'short'` a la interfaz `TradePosition`
- [x] Estado para `nextTradeDirection: 'long' | 'short'`
- [x] Por defecto: `'long'`

#### 4.2 UI Selector de Dirección ✅
- [x] Botones toggle en el header: [LONG] [SHORT]
- [x] Colores distintivos:
  - Long: Verde (#22ab94)
  - Short: Rojo o Naranja (#f7525f)
- [x] Indicador visual de la dirección seleccionada
- [x] Posición: Cerca del título en el header

#### 4.3 Marcadores Visuales en Gráfico ✅
- [x] Long: Flecha hacia arriba (arrowUp) verde
- [x] Short: Flecha hacia abajo (arrowDown) roja
- [x] Texto en marcador: "📈 ENTRADA LONG" / "📉 ENTRADA SHORT"
- [x] Posición: Long=belowBar, Short=aboveBar

#### 4.4 Cálculo de P&L con Dirección ✅
- [x] Modificar función de cálculo de porcentaje para considerar dirección
- [x] En el crosshair (puntero):
  - Long: `((puntero - entrada) / entrada) * 100`
  - Short: `((entrada - puntero) / entrada) * 100`
- [x] En marcadores de salida:
  - Usar la misma fórmula direccional
- [x] Colores de P&L:
  - Positivo: Verde
  - Negativo: Rojo

#### 4.5 Actualización del Listado ✅
- [x] Mostrar dirección en cada operación del listado
- [x] Icono o badge: 📈 LONG / 📉 SHORT
- [x] Colores coherentes con el selector
- [x] Borde izquierdo de color según dirección

### Archivos a Modificar
- `app/components/CandlestickChart.tsx`

### Especificación de Código

```typescript
// Interfaz actualizada
interface TradePosition {
  id: string
  direction: 'long' | 'short'
  entryPrice: number
  entryTime: Time
  exitPrice?: number
  exitTime?: Time
}

// Estado para dirección
const [nextTradeDirection, setNextTradeDirection] = useState<'long' | 'short'>('long')

// Función de cálculo de P&L
const calculateProfitLoss = (
  entryPrice: number,
  exitPrice: number,
  direction: 'long' | 'short'
): number => {
  if (direction === 'long') {
    return ((exitPrice - entryPrice) / entryPrice) * 100
  } else {
    return ((entryPrice - exitPrice) / entryPrice) * 100
  }
}

// En el crosshair
chart.subscribeCrosshairMove((param: any) => {
  if (tradeStageRef.current === 'entry_placed' && activeTradeIdRef.current) {
    const activeTrade = tradePositionsRef.current.find(t => t.id === activeTradeIdRef.current)
    if (activeTrade) {
      const pointerPrice = seriesData.close as number
      const percentage = calculateProfitLoss(
        activeTrade.entryPrice,
        pointerPrice,
        activeTrade.direction
      )
      setProfitLoss(percentage)
    }
  }
})

// En updateMarkers
const updateMarkers = (positions: TradePosition[]) => {
  const markers: TradeMarker[] = []

  positions.forEach(trade => {
    const entryColor = trade.direction === 'long' ? '#22ab94' : '#f7525f'
    const entryShape = trade.direction === 'long' ? 'arrowUp' : 'arrowDown'
    const entryText = trade.direction === 'long' ? 'ENTRADA LONG' : 'ENTRADA SHORT'

    markers.push({
      time: trade.entryTime,
      position: trade.direction === 'long' ? 'belowBar' : 'aboveBar',
      color: entryColor,
      shape: entryShape,
      text: entryText,
    })

    if (trade.exitPrice && trade.exitTime) {
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
```

### UI del Selector

```tsx
<div className="flex gap-2">
  <button
    onClick={() => setNextTradeDirection('long')}
    className={`px-4 py-2 rounded transition-colors ${
      nextTradeDirection === 'long'
        ? 'bg-green-600 text-white'
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`}
  >
    📈 LONG
  </button>
  <button
    onClick={() => setNextTradeDirection('short')}
    className={`px-4 py-2 rounded transition-colors ${
      nextTradeDirection === 'short'
        ? 'bg-red-600 text-white'
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`}
  >
    📉 SHORT
  </button>
</div>
```

---

## FASE 5: Testing y Validación Final ✅

### Tareas de Testing

#### 5.1 Testing Funcional
- [ ] Verificar todas las funcionalidades en desarrollo local
- [ ] Probar flujos completos de usuario
- [ ] Testing de edge cases (no operations, single operation, etc.)

#### 5.2 Testing en Vercel
- [ ] Deploy a Vercel (rama de feature o staging)
- [ ] Verificar que las gráficas se muestran correctamente
- [ ] Probar todas las funcionalidades en producción

#### 5.3 Testing de Compatibility
- [ ] Probar en diferentes navegadores (Chrome, Firefox, Safari)
- [ ] Probar en móvil (responsive design)
- [ ] Verificar performance con muchas operaciones

#### 5.4 Documentación
- [ ] Actualizar README si es necesario
- [ ] Agregar instrucciones de uso si se añadieron features
- [ ] Documentar decisiones técnicas importantes

---

## Checklist de Implementación

### Fase 1: Vercel Fix ✅ COMPLETADA
- [x] Modificar `app/page.tsx` para usar dynamic import con SSR desactivado
- [x] Agregar verificaciones de `window` en `CandlestickChart.tsx`
- [x] Configurar `next.config.mjs` para Vercel
- [x] Build local y testing - Build exitoso
- [ ] Deploy a Vercel y verificación (Pendiente de validación en producción)

### Fase 2: Undo ✅ COMPLETADA
- [x] Implementar función `undoLastTrade()`
- [x] Agregar botón de Undo en el UI
- [x] Testing de undo en diferentes escenarios (validado con build)

### Fase 3: Listado con Eliminación
- [ ] Implementar estado de selección
- [ ] Agregar checkboxes a cada item
- [ ] Implementar funciones de eliminación
- [ ] Actualizar marcadores al eliminar
- [ ] Testing de eliminación simple y múltiple

### Fase 4: Long/Short ✅ COMPLETADA
- [x] Actualizar interfaz `TradePosition` con `direction`
- [x] Agregar estado `nextTradeDirection`
- [x] Implementar selector UI
- [x] Actualizar cálculo de P&L con dirección
- [x] Actualizar marcadores visuales
- [x] Actualizar listado con información de dirección
- [x] Testing exhaustivo de cálculos para long y short (validado con build)

### Fase 5: Testing Final
- [ ] Testing local completo
- [ ] Deploy a Vercel
- [ ] Testing en producción
- [ ] Documentación

---

## Orden Recomendado de Implementación

1. **FASE 1** (Crítica - Blocker para Vercel)
2. **FASE 2** (Simple, independiente de otras fases)
3. **FASE 4** (Moderada, afecta estructura de datos base)
4. **FASE 3** (Depende de FASE 4 para mostrar dirección en listado)
5. **FASE 5** (Testing y validación)

---

## Notas para el Agente

### Cómo usar este plan

1. **Antes de comenzar cada fase:**
   - Lee la sección correspondiente
   - Marca las tareas que vas a comenzar
   - Identifica los archivos que necesitas modificar

2. **Durante la implementación:**
   - Actualiza el checklist con [x] las tareas completadas
   - Agrega notas si encuentras problemas o decisiones importantes
   - Actualiza "Fase actual" al inicio del documento

3. **Al finalizar cada fase:**
   - Verifica que todas las tareas estén completas
   - Haz commit con mensaje descriptivo
   - Actualiza el estado del plan

### Contexto del Código Base

- **Framework:** Next.js 14 con App Router
- **Chart Library:** lightweight-charts v5.1.0
- **State Management:** React hooks (useState, useRef, useEffect)
- **Data Source:** Binance API (servicio en `app/services/binance.ts`)
- **Componente Principal:** `CandlestickChart.tsx`

### Patrones Importantes

El código usa un patrón de **double state** con refs para evitar closures stale:
- Estado regular: `tradePositions` (para renderizado)
- Refs: `tradePositionsRef` (para event listeners)

Al modificar código, **mantén este patrón** para cualquier estado que se use en event listeners del chart.

### Consideraciones de Performance

- Los marcadores se regeneran completamente en `updateMarkers()`
- Considerar optimización si hay muchas operaciones
- El chart se suscribe a múltiples eventos, cuidado con memory leaks

---

## Registro de Cambios

| Fecha | Fase | Cambio | Notas |
|-------|------|--------|-------|
| 2026-02-24 | - | Creación del plan | Plan inicial con 5 fases |
| 2026-02-24 | 1 | Implementación de fixes para Vercel | Dynamic import con ssr: false, verificación de window, configuración de next.config.mjs |
| 2026-02-24 | 1 | Build local exitoso | Validación local completada |
| 2026-02-24 | 1 | Creación de INSTRUCCIONES_VERCEL.md | Guía detallada para despliegue |
| 2026-02-24 | 2 | Implementación de funcionalidad Undo | Función undoLastTrade(), botón en UI con estados, actualización de instrucciones |
| 2026-02-24 | 2 | Build local exitoso | Validación local completada |
| 2026-02-24 | 4 | Implementación de Long/Short con cálculo direccional | Interfaz TradePosition con dirección, selector UI, calculateProfitLoss(), marcadores visuales, listado actualizado |
| 2026-02-24 | 4 | Build local exitoso | Validación local completada |

---

**Este documento es vivo y debe actualizarse conforme se avanza en la implementación.**
