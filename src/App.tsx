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
  X,
  Car,
} from 'lucide-react';
import { db, getTodayShiftId, ensureShiftExists, type DeliveryPackage } from './db/database';
import { seedMedellinDemoBatch } from './utils/demoSeeder';
import { DynamicHeader } from './components/DynamicHeader';
import { IMileTodayTasksCard } from './components/IMileTodayTasksCard';
import { ProfitabilityMeter } from './components/ProfitabilityMeter';
import { PilotModeView } from './components/PilotModeView';
import { RouteOptimizerView } from './components/RouteOptimizerView';
import { TraceabilityHistoryView } from './components/TraceabilityHistoryView';
import { QuincenaAccountingView } from './components/QuincenaAccountingView';
import { SettingsBackupView } from './components/SettingsBackupView';
import { TransportDashboardView } from './components/TransportDashboardView';
import { ScannerModal } from './components/ScannerModal';
import { DeliveryCheckoutScanner } from './components/DeliveryCheckoutScanner';
import { ScannerTestLabModal } from './components/ScannerTestLabModal';
import { QuickSearchModal } from './components/QuickSearchModal';
import { PackageDetailsModal } from './components/PackageDetailsModal';
import { FeedbackProvider } from './components/ui/FeedbackSystem';

// Pestañas Estrictamente Aisladas v9.0 (Cero Mezcla de Componentes ni Scroll Infinito)
type ActiveTab = 'pilot' | 'route' | 'quincena' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pilot');
  const [globalSelectedPackage, setGlobalSelectedPackage] = useState<DeliveryPackage | null>(null);
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [checkoutScannerOpen, setCheckoutScannerOpen] = useState<boolean>(false);
  const [testLabOpen, setTestLabOpen] = useState<boolean>(false);
  const [searchModalOpen, setSearchModalOpen] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [highContrastSun, setHighContrastSun] = useState<boolean>(false);
  const [workMode, setWorkMode] = useState<'delivery' | 'transport'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('miruta_work_mode');
      if (saved === 'transport' || saved === 'delivery') return saved;
    }
    return 'delivery';
  });

  const handleWorkModeChange = (mode: 'delivery' | 'transport') => {
    setWorkMode(mode);
    localStorage.setItem('miruta_work_mode', mode);
    if (mode === 'transport' && activeTab === 'route') {
      setActiveTab('pilot');
    }
  };

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
          workMode={workMode}
          onChangeWorkMode={handleWorkModeChange}
        />

        {/* Contenido Principal con Aislamiento Estricto por Vistas (v9.0 / v11.0) */}
        <main className="mt-1">
          <AnimatePresence mode="wait">
            {/* 1. MODO TRANSPORTE: DASHBOARD FINANCIERO Y CONTROL DE JORNADA (v11.0) */}
            {activeTab === 'pilot' && workMode === 'transport' && (
              <motion.div
                key="pilot-transport"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="space-y-3"
              >
                <TransportDashboardView highContrastSun={highContrastSun} />
              </motion.div>
            )}

            {/* 1. MODO MENSAJERÍA: ENTREGA / TAREAS (IMileTodayTasksCard + PilotModeView) */}
            {activeTab === 'pilot' && workMode === 'delivery' && (
              <motion.div
                key="pilot-delivery"
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
                  onOpenCheckoutScanner={() => setCheckoutScannerOpen(true)}
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
                  onSelectPackage={setGlobalSelectedPackage}
                />
              </motion.div>
            )}

            {/* 2. PESTAÑA: MAPA Y RUTA (Solo en modo Mensajería) */}
            {activeTab === 'route' && workMode === 'delivery' && (
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
                  onSelectPackage={setGlobalSelectedPackage}
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
                  onNavigateToTab={(tab) => setActiveTab(tab)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Modal de Búsqueda Reactiva Rápida de Guías (v9.0 / v10.6 / v10.9) */}
        <QuickSearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          setGlobalSelectedPackage={setGlobalSelectedPackage}
          onSelectPackage={(pkg) => {
            setGlobalSelectedPackage(pkg);
            setSearchModalOpen(false);
          }}
          highContrastSun={highContrastSun}
        />

        {/* Ficha Detallada Global de Paquete (Hotfix v10.9) */}
        <PackageDetailsModal
          isOpen={Boolean(globalSelectedPackage)}
          packageData={globalSelectedPackage}
          onClose={() => setGlobalSelectedPackage(null)}
          onPinAsNextStop={async (pkg) => {
            if (pkg.id !== undefined) {
              const allPkgs = await db.packages.toArray();
              const minOrder = allPkgs
                .filter((p) => !p.archivedInHistory && p.status === 'pending')
                .reduce((min, p) => Math.min(min, p.routeOrder || 999), 999);
              await db.packages.update(pkg.id, {
                routeOrder: Math.max(1, minOrder - 1),
              });
            }
          }}
          onRetryNovelty={async (pkg) => {
            if (pkg.id !== undefined) {
              await db.packages.update(pkg.id, {
                status: 'pending',
                issueNote: '',
              });
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

        {/* Modal de Escaneo de Liquidación / Salida Rápida (v10.0) */}
        <DeliveryCheckoutScanner
          isOpen={checkoutScannerOpen}
          onClose={() => setCheckoutScannerOpen(false)}
          highContrastSun={highContrastSun}
        />

        {/* Modal de Laboratorio de Pruebas y Benchmark de Escáner */}
        <ScannerTestLabModal
          isOpen={testLabOpen}
          onClose={() => setTestLabOpen(false)}
          highContrastSun={highContrastSun}
        />

        {/* Barra de Navegación Inferior Fija (Adaptativa Multi-Modo v11.0) */}
        <nav
          className={`fixed bottom-0 inset-x-0 z-40 border-t backdrop-blur-xl pb-safe transition-colors ${
            highContrastSun
              ? 'bg-white/95 border-slate-300 text-slate-900 shadow-2xl'
              : 'bg-slate-950/95 border-slate-800/90 text-slate-300 shadow-2xl'
          }`}
        >
          <div className="max-w-lg mx-auto px-4 py-2 relative">
            <div
              className={`grid items-center ${
                workMode === 'transport' ? 'grid-cols-3' : 'grid-cols-4'
              }`}
            >
              {/* Pestaña 1: Conductor (Transporte) o Entrega (Mensajería) */}
              <button
                type="button"
                onClick={() => setActiveTab('pilot')}
                className={`py-1 px-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  activeTab === 'pilot'
                    ? workMode === 'transport'
                      ? 'text-amber-400 font-black'
                      : 'text-blue-400 font-black'
                    : 'text-slate-400 hover:text-slate-200 font-bold'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-all ${
                    activeTab === 'pilot'
                      ? workMode === 'transport'
                        ? 'bg-amber-500/25 text-amber-400 scale-110 shadow-sm'
                        : 'bg-blue-600/25 text-blue-400 scale-110 shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  {workMode === 'transport' ? (
                    <Car className="w-5 h-5" />
                  ) : (
                    <Send className="w-5 h-5 -rotate-45" />
                  )}
                </div>
                <span className="text-[10px] leading-tight">
                  {workMode === 'transport' ? 'Conductor' : 'Entrega'}
                </span>
              </button>

              {/* Pestaña 2: Mapa y Ruta (Solo visible en modo Mensajería) */}
              {workMode === 'delivery' && (
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
              )}

              {/* Pestaña 3: Finanzas / Quincena */}
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
                <span className="text-[10px] leading-tight">
                  {workMode === 'transport' ? 'Finanzas' : 'Quincena'}
                </span>
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

            {/* Botón Flotante de Búsqueda Rápida de Guía (Solo en modo Mensajería) */}
            {workMode === 'delivery' && (
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
            )}
          </div>
        </nav>
      </div>
    </FeedbackProvider>
  );
}

export default App;
