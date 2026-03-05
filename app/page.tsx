import dynamic from 'next/dynamic'

// Import dinámico con SSR desactivado para evitar problemas con lightweight-charts en Vercel
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

// const BotPanel = dynamic(() => import('./components/BotPanel'), { ssr: false })

export default function Home() {
  return (
    <>
      <CandlestickChart />
      {/* <BotPanel /> */}
    </>
  )
}
