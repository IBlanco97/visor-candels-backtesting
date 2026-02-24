# Instrucciones de Despliegue en Vercel

## 🚀 Preparativos Antes del Deploy

La **Fase 1** del plan de implementación ha completado las modificaciones necesarias para solucionar el problema de las gráficas que no se muestran en Vercel.

## Cambios Realizados

### 1. Dynamic Import con SSR Desactivado
**Archivo:** `app/page.tsx`

Se ha implementado un import dinámico para evitar que el componente del gráfico se renderice en el servidor:

```typescript
import dynamic from 'next/dynamic'

const CandlestickChart = dynamic(
  () => import('./components/CandlestickChart'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-lg">Cargando gráfico...</div>
      </div>
    )
  }
)
```

### 2. Verificación de Window
**Archivo:** `app/components/CandlestickChart.tsx`

Se agregó verificación para asegurar que el código solo se ejecute en el navegador:

```typescript
useEffect(() => {
  // Verificar que estamos en el navegador (no en SSR)
  if (typeof window === 'undefined') return
  if (!chartContainerRef.current) return
  // ... resto del código
}, [])
```

### 3. Configuración de Next.js
**Archivo:** `next.config.mjs`

Se ha optimizado la configuración para Vercel:

```javascript
const nextConfig = {
  poweredByHeader: false,
  images: {
    domains: [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};
```

## 📋 Pasos para Desplegar en Vercel

### Opción 1: Desde GitHub (Recomendado)

1. **Hacer commit de los cambios:**
   ```bash
   git add .
   git commit -m "feat: Fix Vercel deployment - Disable SSR for chart component"
   git push
   ```

2. **Conectar repositorio en Vercel:**
   - Ve a [vercel.com](https://vercel.com)
   - Importa tu repositorio de GitHub
   - Vercel detectará automáticamente que es un proyecto Next.js

3. **Configuración del deploy:**
   - **Framework Preset:** Next.js
   - **Build Command:** `npm run build` (detectado automáticamente)
   - **Output Directory:** `.next` (detectado automáticamente)
   - **Install Command:** `npm install` (detectado automáticamente)

4. **Deploy:** Haz clic en "Deploy"

### Opción 2: Desde Vercel CLI

1. **Instalar Vercel CLI (si no está instalada):**
   ```bash
   npm install -g vercel
   ```

2. **Iniciar deploy:**
   ```bash
   vercel
   ```

3. **Seguir las instrucciones en pantalla.**

### Opción 3: Drag & Drop

1. **Hacer build local:**
   ```bash
   npm run build
   ```

2. **Arrastrar la carpeta `.next` a Vercel:**
   - Ve a [vercel.com/new](https://vercel.com/new)
   - Selecciona "Upload" en lugar de conectar un repo
   - Arrastra tu carpeta del proyecto

## ✅ Verificación Post-Deploy

Una vez desplegado, verifica lo siguiente:

1. **La página carga correctamente** - No deberías ver errores de hidratación
2. **El gráfico se muestra** - Las velas japonesas deberían ser visibles
3. **Los datos de BTC se cargan** - Deberías ver los precios actualizados
4. **Las interacciones funcionan:**
   - Click en el gráfico coloca marcadores
   - El puntero muestra precios correctamente
   - El panel lateral muestra información

## 🔍 Troubleshooting

### Si el gráfico todavía no se muestra:

1. **Verificar la consola del navegador:**
   - Abre las DevTools (F12)
   - Busca errores relacionados con `lightweight-charts`
   - Busca errores de hidratación de React

2. **Verificar que el componente no se está renderizando en el servidor:**
   - En la consola de Vercel, verifica los logs del deploy
   - No deberías ver errores relacionados con `window` o `document`

3. **Limpiar caché de Vercel:**
   - Ve a los settings del proyecto en Vercel
   - Elimina el caché de build
   - Haz redeploy

### Si hay errores de build:

1. **Verificar que `next.config.mjs` sea correcto:**
   - No debe tener `output: 'standalone'` (esto causó problemas en nuestro build local)

2. **Verificar las dependencias:**
   - Asegúrate de que `lightweight-charts` esté en las dependencias
   - Ejecuta `npm install` localmente para verificar

## 📊 Estado Actual

- ✅ Código modificado para evitar SSR
- ✅ Build local exitoso
- ✅ Servidor de desarrollo funciona correctamente
- ⏳ Pendiente: Validación en Vercel

## 🎯 Próximos Pasos

Después de validar que el gráfico se muestra correctamente en Vercel:

1. Continuar con **Fase 2**: Sistema de Deshacer Operaciones
2. Luego **Fase 4**: Selector Long/Short
3. Después **Fase 3**: Listado con Eliminación
4. Finalmente **Fase 5**: Testing Completo

---

**Última actualización:** 2026-02-24
**Estado:** Listo para deploy a Vercel
