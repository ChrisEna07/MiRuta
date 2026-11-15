import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Navigation2,
  ListOrdered,
  QrCode,
  History,
  FileSpreadsheet,
  Settings
} from 'lucide-react';
import { db, getTodayShiftId, ensureShiftExists } from './db/database';
import { seedMedellinDemoBatch } from './utils/demoSeeder';
import { DynamicHeader } from './components/DynamicHeader';
import { ProfitabilityMeter } from './components/ProfitabilityMeter';
import { PilotModeView } from './components/PilotModeView';
import { RouteOptimizerView } from './components/RouteOptimizerView';
import { TraceabilityHistoryView } from './components/TraceabilityHistoryView';
import { QuincenaAccountingView } from './components/QuincenaAccountingView';
import { SettingsBackupView } from './components/SettingsBackupView';
import { ScannerModal } from './components/ScannerModal';
import { ScannerTestLabModal } from './components/ScannerTestLabModal';
import { FeedbackProvider } from './components/ui/FeedbackSystem';

type ActiveTab = 'pilot' | 'route' | 'history' | 'quincena' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pilot');
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

      {/* 2. Medidor de Desempeño, Semáforo y Cierre de Jornada */}
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

          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
            >
              <TraceabilityHistoryView highContrastSun={highContrastSun} />
            </motion.div>
          )}

          {activeTab === 'quincena' && (
            <motion.div
              key="quincena"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
            >
              <QuincenaAccountingView highContrastSun={highContrastSun} />
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
            >
              <SettingsBackupView
                highContrastSun={highContrastSun}
                onOpenTestLab={() => setTestLabOpen(true)}
              />
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

      {/* Barra de Navegación Inferior Táctica (6 Accesos: Piloto, Ruta, Escanear, Historial, Quincena, Ajustes) */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-40 border-t backdrop-blur-lg pb-safe ${
          highContrastSun
            ? 'bg-white/95 border-slate-300 text-slate-900'
            : 'bg-slate-900/95 border-slate-800 text-slate-300'
        }`}
      >
        <div className="max-w-lg mx-auto px-2 py-1.5 grid grid-cols-6 items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('pilot')}
            className={`py-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 font-extrabold text-[10px] transition-all ${
              activeTab === 'pilot'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'hover:bg-slate-800/50'
            }`}
          >
            <Navigation2 className="w-4 h-4" />
            <span>Piloto</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('route')}
            className={`py-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 font-extrabold text-[10px] relative transition-all ${
              activeTab === 'route'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'hover:bg-slate-800/50'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            <span>Ruta ({pendingCount})</span>
          </button>

          {/* Botón Central Flotante: Escanear Guía */}
          <div className="flex justify-center -mt-4">
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-green-500 text-slate-950 font-black flex flex-col items-center justify-center shadow-xl shadow-emerald-600/40 border-2 border-emerald-300 active:scale-95 transition-transform"
            >
              <QrCode className="w-5 h-5 stroke-[2.5]" />
              <span className="text-[8px] font-black uppercase leading-none mt-0.5">
                Scan
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 font-extrabold text-[10px] transition-all ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'hover:bg-slate-800/50'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Historial</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quincena')}
            className={`py-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 font-extrabold text-[10px] transition-all ${
              activeTab === 'quincena'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'hover:bg-slate-800/50'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Quincena</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-2 rounded-2xl flex flex-col items-center justify-center gap-0.5 font-extrabold text-[10px] transition-all ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'hover:bg-slate-800/50'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Ajustes</span>
          </button>
        </div>
      </nav>
    </div>
    </FeedbackProvider>
  );
}

export default App;
