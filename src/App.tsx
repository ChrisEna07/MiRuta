import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Send,
  MapPin,
  Grid,
  Search,
  History,
  FileSpreadsheet,
  Settings,
  Sparkles,
} from 'lucide-react';
import { db, getTodayShiftId, ensureShiftExists } from './db/database';
import { seedMedellinDemoBatch } from './utils/demoSeeder';
import { DynamicHeader } from './components/DynamicHeader';
import { IMileTodayTasksCard } from './components/IMileTodayTasksCard';
import { ProfitabilityMeter } from './components/ProfitabilityMeter';
import { PilotModeView } from './components/PilotModeView';
import { RouteOptimizerView } from './components/RouteOptimizerView';
import { TraceabilityHistoryView } from './components/TraceabilityHistoryView';
import { QuincenaAccountingView } from './components/QuincenaAccountingView';
import { SettingsBackupView } from './components/SettingsBackupView';
import { ScannerModal } from './components/ScannerModal';
import { ScannerTestLabModal } from './components/ScannerTestLabModal';
import { FeedbackProvider } from './components/ui/FeedbackSystem';

type ActiveTab = 'pilot' | 'route' | 'more';
type MoreSubTab = 'history' | 'quincena' | 'settings' | 'menu';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pilot');
  const [moreSubTab, setMoreSubTab] = useState<MoreSubTab>('menu');
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [testLabOpen, setTestLabOpen] = useState<boolean>(false);
  const [highContrastSun, setHighContrastSun] = useState<boolean>(false);

  const todayShiftId = getTodayShiftId();

  useEffect(() => {
    const initApp = async () => {
      await ensureShiftExists(todayShiftId);
      const alreadySeeded = localStorage.getItem('miruta_initial_seed_v2');
      if (!alreadySeeded) {
        await seedMedellinDemoBatch();
        localStorage.setItem('miruta_initial_seed_v2', 'true');
      }
    };
    initApp();
  }, [todayShiftId]);

  const todayPackages =
    useLiveQuery(
      () => db.packages.where('shiftId').equals(todayShiftId).toArray(),
      [todayShiftId]
    ) || [];

  const todayShift = useLiveQuery(
    () => db.shifts.get(todayShiftId),
    [todayShiftId]
  );

  const pendingCount = todayPackages.filter(
    (p) => !p.archivedInHistory && (p.status === 'pending' || p.status === 'in_progress')
  ).length;

  return (
    <FeedbackProvider>
      <div
        className={`min-h-[100dvh] w-full pb-36 transition-colors touch-pan-y ${
          highContrastSun
            ? 'bg-slate-100 text-slate-950'
            : 'bg-slate-950 text-slate-50'
        }`}
      >
      {/* 1. Header Dinámico MiRuta by Christian Romero */}
      <DynamicHeader
        highContrastSun={highContrastSun}
        onToggleContrast={() => setHighContrastSun((prev) => !prev)}
      />

      {/* 2. Tarjeta Superior Oficial iMile: Tareas de Hoy, Barra de Progreso y Operaciones Rápidas */}
      <IMileTodayTasksCard
        packages={todayPackages}
        highContrastSun={highContrastSun}
        onOpenScanner={() => setScannerOpen(true)}
        onOpenIssueScanner={() => setScannerOpen(true)}
        onOpenSearch={() => setActiveTab('route')}
        onSelectFilter={(filter) => {
          if (filter === 'all' || filter === 'pending') {
            setActiveTab('pilot');
          } else {
            setActiveTab('route');
          }
        }}
      />

      {/* 3. Medidor de Desempeño, Semáforo y Cierre de Jornada */}
      <ProfitabilityMeter
        packages={todayPackages}
        shift={todayShift}
        highContrastSun={highContrastSun}
      />

      {/* Contenido Principal con Transiciones Fluidas Framer Motion */}
      <main className="mt-1">
        <AnimatePresence mode="wait">
          {activeTab === 'pilot' && (
            <motion.div
              key="pilot"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
            >
              <PilotModeView
                packages={todayPackages}
                highContrastSun={highContrastSun}
                onOpenScanner={() => setScannerOpen(true)}
              />
            </motion.div>
          )}

          {activeTab === 'route' && (
            <motion.div
              key="route"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
            >
              <RouteOptimizerView
                packages={todayPackages}
                highContrastSun={highContrastSun}
                onOpenScanner={() => setScannerOpen(true)}
              />
            </motion.div>
          )}

          {activeTab === 'more' && (
            <motion.div
              key="more"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="max-w-lg mx-auto px-4 py-2 space-y-3"
            >
              {/* Barra de Sub-Navegación para "Más" */}
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-900 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setMoreSubTab('history')}
                  className={`py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                    moreSubTab === 'history'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Historial</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMoreSubTab('quincena')}
                  className={`py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                    moreSubTab === 'quincena'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Quincena</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMoreSubTab('settings')}
                  className={`py-2 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors ${
                    moreSubTab === 'settings'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Ajustes</span>
                </button>
              </div>

              {moreSubTab === 'history' && (
                <TraceabilityHistoryView highContrastSun={highContrastSun} />
              )}
              {moreSubTab === 'quincena' && (
                <QuincenaAccountingView highContrastSun={highContrastSun} />
              )}
              {moreSubTab === 'settings' && (
                <SettingsBackupView
                  highContrastSun={highContrastSun}
                  onOpenTestLab={() => setTestLabOpen(true)}
                />
              )}
              {moreSubTab === 'menu' && (
                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setMoreSubTab('history')}
                    className="w-full p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between text-left hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400">
                        <History className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-sm text-white">Historial y Trazabilidad</p>
                        <p className="text-xs text-slate-400">Auditoría completa de paquetes entregados</p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMoreSubTab('quincena')}
                    className="w-full p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between text-left hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-sm text-white">Liquidación Quincena & Sr. Juan</p>
                        <p className="text-xs text-slate-400">Auditoría de ingresos vs. deducciones</p>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMoreSubTab('settings')}
                    className="w-full p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between text-left hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-sm text-white">Ajustes & Backups Bóveda</p>
                        <p className="text-xs text-slate-400">Restauración, borrar datos y Supabase</p>
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal de Escaneo Inteligente */}
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onOpenTestLab={() => setTestLabOpen(true)}
        highContrastSun={highContrastSun}
      />

      {/* Modal de Laboratorio de Pruebas y Benchmark de Escáner */}
      <ScannerTestLabModal
        isOpen={testLabOpen}
        onClose={() => setTestLabOpen(false)}
        highContrastSun={highContrastSun}
      />

      {/* Barra de Navegación Inferior Estilo iMile Real (3 Pestañas: Entrega, Mapa, Más + Búsqueda Rápida) */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-40 border-t backdrop-blur-xl pb-safe transition-colors ${
          highContrastSun
            ? 'bg-white/95 border-slate-300 text-slate-900 shadow-2xl'
            : 'bg-slate-950/95 border-slate-800/90 text-slate-300 shadow-2xl'
        }`}
      >
        <div className="max-w-lg mx-auto px-4 py-2 relative">
          <div className="grid grid-cols-3 items-center">
            {/* Pestaña 1: Entrega (Avión de papel / Ruta activa) */}
            <button
              type="button"
              onClick={() => setActiveTab('pilot')}
              className={`py-1.5 px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all ${
                activeTab === 'pilot'
                  ? 'text-blue-500 font-black'
                  : 'text-slate-400 hover:text-slate-200 font-bold'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  activeTab === 'pilot'
                    ? 'bg-blue-600/20 text-blue-400 scale-110'
                    : 'text-slate-400'
                }`}
              >
                <Send className="w-5 h-5 -rotate-45" />
              </div>
              <span className="text-[11px] leading-tight">Entrega</span>
            </button>

            {/* Pestaña 2: Mapa / Ruta (Pin de ubicación / Lista de Paradas) */}
            <button
              type="button"
              onClick={() => setActiveTab('route')}
              className={`py-1.5 px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all ${
                activeTab === 'route'
                  ? 'text-blue-500 font-black'
                  : 'text-slate-400 hover:text-slate-200 font-bold'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  activeTab === 'route'
                    ? 'bg-blue-600/20 text-blue-400 scale-110'
                    : 'text-slate-400'
                }`}
              >
                <MapPin className="w-5 h-5" />
              </div>
              <span className="text-[11px] leading-tight">
                Mapa ({pendingCount})
              </span>
            </button>

            {/* Pestaña 3: Más (Grid / Ajustes, Historial, Quincena) */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('more');
                setMoreSubTab('menu');
              }}
              className={`py-1.5 px-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all ${
                activeTab === 'more'
                  ? 'text-blue-500 font-black'
                  : 'text-slate-400 hover:text-slate-200 font-bold'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  activeTab === 'more'
                    ? 'bg-blue-600/20 text-blue-400 scale-110'
                    : 'text-slate-400'
                }`}
              >
                <Grid className="w-5 h-5" />
              </div>
              <span className="text-[11px] leading-tight">Más</span>
            </button>
          </div>

          {/* Botón Flotante Rápido de Búsqueda de Entrega estilo iMile */}
          <div className="absolute right-4 -top-12 sm:-top-14">
            <button
              type="button"
              onClick={() => {
                setActiveTab('route');
              }}
              title="Búsqueda de Entrega"
              className="px-3.5 py-2 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-white font-black text-xs flex items-center gap-1.5 shadow-xl active:scale-95 transition-transform"
            >
              <Search className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Buscar</span>
              <span className="font-mono text-emerald-400 font-black">#Guía</span>
            </button>
          </div>
        </div>
      </nav>
    </div>
    </FeedbackProvider>
  );
}

export default App;
