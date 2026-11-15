import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Send,
  MapPin,
  Search,
  FileSpreadsheet,
  Settings,
  History,
  X
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
import { QuickSearchModal } from './components/QuickSearchModal';
import { FeedbackProvider } from './components/ui/FeedbackSystem';

// Pestañas Estrictamente Aisladas v9.0 (Cero Mezcla de Componentes ni Scroll Infinito)
type ActiveTab = 'pilot' | 'route' | 'quincena' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pilot');
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [testLabOpen, setTestLabOpen] = useState<boolean>(false);
  const [searchModalOpen, setSearchModalOpen] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [highContrastSun, setHighContrastSun] = useState<boolean>(false);

  const todayShiftId = getTodayShiftId();

  useEffect(() => {
    const initApp = async () => {
      await ensureShiftExists(todayShiftId);
      // Rehidratación inmediata (v9.5): Garantiza que paquetes activos no archivados permanezcan visibles
      const allPkgs = await db.packages.toArray();
      const unarchivedActive = allPkgs.filter(
        (p) => !p.archivedInHistory && (p.status === 'pending' || p.status === 'in_progress' || p.status === 'issue')
      );
      for (const pkg of unarchivedActive) {
        if (pkg.shiftId !== todayShiftId && pkg.id !== undefined) {
          await db.packages.update(pkg.id, { shiftId: todayShiftId });
        }
      }

      const alreadySeeded = localStorage.getItem('miruta_initial_seed_v2');
      if (!alreadySeeded && allPkgs.length === 0) {
        await seedMedellinDemoBatch();
        localStorage.setItem('miruta_initial_seed_v2', 'true');
      }
    };
    initApp();
  }, [todayShiftId]);

  const todayPackages =
    useLiveQuery(async () => {
      const all = await db.packages.toArray();
      return all.filter(
        (p) => !p.archivedInHistory || p.shiftId === todayShiftId
      );
    }, [todayShiftId]) || [];

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
        className={`min-h-[100dvh] w-full pb-32 transition-colors touch-pan-y ${
          highContrastSun
            ? 'bg-slate-100 text-slate-950'
            : 'bg-slate-950 text-slate-50'
        }`}
      >
        {/* Header Dinámico MiRuta by Christian Romero */}
        <DynamicHeader
          highContrastSun={highContrastSun}
          onToggleContrast={() => setHighContrastSun((prev) => !prev)}
        />

        {/* Contenido Principal con Aislamiento Estricto por Vistas (v9.0) */}
        <main className="mt-1">
          <AnimatePresence mode="wait">
            {/* 1. PESTAÑA: ENTREGA / TAREAS (IMileTodayTasksCard + PilotModeView) */}
            {activeTab === 'pilot' && (
              <motion.div
                key="pilot"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="space-y-3"
              >
                {/* Tareas de Hoy estilo iMile + Operaciones Rápidas */}
                <IMileTodayTasksCard
                  packages={todayPackages}
                  highContrastSun={highContrastSun}
                  onOpenScanner={() => setScannerOpen(true)}
                  onOpenIssueScanner={() => setScannerOpen(true)}
                  onOpenSearch={() => setSearchModalOpen(true)}
                  onSelectFilter={(filter) => {
                    if (filter === 'all' || filter === 'pending') {
                      setActiveTab('pilot');
                    } else {
                      setActiveTab('route');
                    }
                  }}
                />

                {/* Modo Piloto: Cronómetro de Jornada, Pausas, Parada Actual con Waze y Badges */}
                <PilotModeView
                  packages={todayPackages}
                  highContrastSun={highContrastSun}
                  onOpenScanner={() => setScannerOpen(true)}
                />
              </motion.div>
            )}

            {/* 2. PESTAÑA: MAPA Y RUTA (RouteOptimizerView) */}
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

            {/* 3. PESTAÑA: QUINCENA & DESEMPEÑO (ProfitabilityMeter + QuincenaAccountingView) */}
            {activeTab === 'quincena' && (
              <motion.div
                key="quincena"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="space-y-3.5"
              >
                {/* Semáforo de Desempeño, Ritmo paq/h y Meta $600k COP */}
                <ProfitabilityMeter
                  packages={todayPackages}
                  shift={todayShift}
                  highContrastSun={highContrastSun}
                />

                {/* Auditoría y Liquidación Quincenal para Christian y PDF Sr. Juan */}
                <QuincenaAccountingView highContrastSun={highContrastSun} />
              </motion.div>
            )}

            {/* 4. PESTAÑA: AJUSTES & BÓVEDA (SettingsBackupView) */}
            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="space-y-3"
              >
                {/* Botón rápido para ver Historial de Trazabilidad */}
                <div className="max-w-lg mx-auto px-4 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowHistoryModal(true)}
                    className="w-full p-3.5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-between text-left transition-all active:scale-[0.99] cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                        <History className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-sm text-white">Historial y Trazabilidad</p>
                        <p className="text-xs text-slate-400">Consultar entregas anteriores y fechas pasadas</p>
                      </div>
                    </div>
                  </button>
                </div>

                <SettingsBackupView
                  highContrastSun={highContrastSun}
                  onOpenTestLab={() => setTestLabOpen(true)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Modal de Búsqueda Reactiva Rápida de Guías (v9.0) */}
        <QuickSearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          onSelectPackage={(pkg) => {
            if (pkg.status === 'pending' || pkg.status === 'in_progress') {
              setActiveTab('pilot');
            } else {
              setActiveTab('route');
            }
          }}
          highContrastSun={highContrastSun}
        />

        {/* Modal de Historial de Trazabilidad */}
        {showHistoryModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 touch-scroll-y">
            <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700 p-4 max-h-[90dvh] overflow-y-auto space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-400" />
                  <span>Historial de Trazabilidad</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <TraceabilityHistoryView highContrastSun={highContrastSun} />
            </div>
          </div>
        )}

        {/* Modal de Escaneo Inteligente */}
        <ScannerModal
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onOpenTestLab={() => setTestLabOpen(true)}
          onNavigateToRoute={() => {
            setScannerOpen(false);
            setActiveTab('route');
          }}
          highContrastSun={highContrastSun}
        />

        {/* Modal de Laboratorio de Pruebas y Benchmark de Escáner */}
        <ScannerTestLabModal
          isOpen={testLabOpen}
          onClose={() => setTestLabOpen(false)}
          highContrastSun={highContrastSun}
        />

        {/* Barra de Navegación Inferior Fija v9.0 (4 Pestañas Aisladas + Botón Buscar) */}
        <nav
          className={`fixed bottom-0 inset-x-0 z-40 border-t backdrop-blur-xl pb-safe transition-colors ${
            highContrastSun
              ? 'bg-white/95 border-slate-300 text-slate-900 shadow-2xl'
              : 'bg-slate-950/95 border-slate-800/90 text-slate-300 shadow-2xl'
          }`}
        >
          <div className="max-w-lg mx-auto px-4 py-2 relative">
            <div className="grid grid-cols-4 items-center">
              {/* Pestaña 1: Entrega / Piloto */}
              <button
                type="button"
                onClick={() => setActiveTab('pilot')}
                className={`py-1 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  activeTab === 'pilot'
                    ? 'text-blue-400 font-black'
                    : 'text-slate-400 hover:text-slate-200 font-bold'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-all ${
                    activeTab === 'pilot'
                      ? 'bg-blue-600/25 text-blue-400 scale-110 shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  <Send className="w-5 h-5 -rotate-45" />
                </div>
                <span className="text-[10px] leading-tight">Entrega</span>
              </button>

              {/* Pestaña 2: Mapa y Ruta */}
              <button
                type="button"
                onClick={() => setActiveTab('route')}
                className={`py-1 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  activeTab === 'route'
                    ? 'text-blue-400 font-black'
                    : 'text-slate-400 hover:text-slate-200 font-bold'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-all ${
                    activeTab === 'route'
                      ? 'bg-blue-600/25 text-blue-400 scale-110 shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  <MapPin className="w-5 h-5" />
                </div>
                <span className="text-[10px] leading-tight">
                  Ruta {pendingCount > 0 ? `(${pendingCount})` : ''}
                </span>
              </button>

              {/* Pestaña 3: Quincena & Desempeño */}
              <button
                type="button"
                onClick={() => setActiveTab('quincena')}
                className={`py-1 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  activeTab === 'quincena'
                    ? 'text-blue-400 font-black'
                    : 'text-slate-400 hover:text-slate-200 font-bold'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-all ${
                    activeTab === 'quincena'
                      ? 'bg-blue-600/25 text-blue-400 scale-110 shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <span className="text-[10px] leading-tight">Quincena</span>
              </button>

              {/* Pestaña 4: Ajustes */}
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`py-1 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  activeTab === 'settings'
                    ? 'text-blue-400 font-black'
                    : 'text-slate-400 hover:text-slate-200 font-bold'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-all ${
                    activeTab === 'settings'
                      ? 'bg-blue-600/25 text-blue-400 scale-110 shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  <Settings className="w-5 h-5" />
                </div>
                <span className="text-[10px] leading-tight">Ajustes</span>
              </button>
            </div>

            {/* Botón Flotante de Búsqueda Rápida de Guía (#4) */}
            <div className="absolute right-4 -top-12 sm:-top-13">
              <button
                type="button"
                onClick={() => setSearchModalOpen(true)}
                title="Búsqueda Rápida de Guías"
                className="px-3.5 py-2 rounded-2xl bg-slate-900/95 hover:bg-slate-800 border border-amber-500/50 text-white font-black text-xs flex items-center gap-1.5 shadow-xl active:scale-95 transition-transform cursor-pointer"
              >
                <Search className="w-4 h-4 text-amber-400" />
                <span>Buscar</span>
                <span className="font-mono text-amber-400 font-black">#Guía</span>
              </button>
            </div>
          </div>
        </nav>
      </div>
    </FeedbackProvider>
  );
}

export default App;
