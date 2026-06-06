import { lazy, Suspense, useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Layers3,
  ClipboardList,
  Boxes,
  Wallet,
  BarChart3,
  HeartPulse,
  Egg,
  Palette,
  MoreHorizontal,
  LogOut,
  Loader2,
} from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { DashboardScreen } from './DashboardScreen';
import { CatalogueScreen } from './catalogue/CatalogueScreen';
import { LotsScreen } from './lots/LotsScreen';
import { ProductionScreen } from './production/ProductionScreen';
import { StocksScreen } from './stocks/StocksScreen';
import { FinancesScreen } from './finances/FinancesScreen';
import { HealthScreen } from './health/HealthScreen';
import { IncubationScreen } from './incubation/IncubationScreen';
import { PersonnalisationScreen } from './settings/PersonnalisationScreen';
import type { View } from './navigation';

// Lazy : StatsScreen embarque recharts (~lourd). Sortir cette dépendance du
// chunk initial garde l'app de saisie quotidienne légère ; ne charge qu'au
// clic sur l'onglet Stats.
const StatsScreen = lazy(() => import('./stats/StatsScreen'));

// Vues "primaires" en bottom-nav (5) vs vues dans le menu "Plus" (5).
// Le choix : opérations quotidiennes en bas, configuration/pilotage dans Plus.
const PLUS_VIEWS: View[] = ['catalogue', 'health', 'incubation', 'stats', 'settings'];

export function AppShell() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;

  const { profile, organization, signOut } = session;
  const userLabel = profile.full_name ?? session.session.user.email ?? 'utilisateur';
  const [view, setView] = useState<View>('dashboard');
  const [plusOpen, setPlusOpen] = useState(false);
  const isPlusView = PLUS_VIEWS.includes(view);

  function navigate(v: View) {
    setView(v);
    setPlusOpen(false);
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-brand text-brand-fg safe-top">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {organization.logo_url ? (
              <img
                src={organization.logo_url}
                alt=""
                className="h-10 w-10 rounded-xl object-cover bg-white/10"
              />
            ) : (
              <div className="h-10 w-10 rounded-xl bg-white/15 grid place-items-center font-bold text-lg">
                {organization.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">{organization.name}</div>
              <div className="text-xs opacity-80 leading-tight truncate">
                {organization.slogan ?? userLabel}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 active:bg-white/25 px-3 py-1.5 rounded-lg shrink-0 transition-colors"
            aria-label="Déconnexion"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-5 max-w-3xl mx-auto w-full pb-28">
        {view === 'dashboard' ? (
          <DashboardScreen onNavigate={navigate} />
        ) : view === 'catalogue' ? (
          <CatalogueScreen />
        ) : view === 'lots' ? (
          <LotsScreen />
        ) : view === 'production' ? (
          <ProductionScreen />
        ) : view === 'stocks' ? (
          <StocksScreen />
        ) : view === 'finances' ? (
          <FinancesScreen />
        ) : view === 'health' ? (
          <HealthScreen />
        ) : view === 'incubation' ? (
          <IncubationScreen />
        ) : view === 'settings' ? (
          <PersonnalisationScreen />
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12 text-neutral-500 gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Chargement des statistiques…</span>
              </div>
            }
          >
            <StatsScreen />
          </Suspense>
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur border-t border-neutral-200 safe-bottom">
        {/* Popover du menu Plus, ancrée au-dessus de la nav. */}
        {plusOpen && (
          <>
            <button
              type="button"
              onClick={() => setPlusOpen(false)}
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Fermer le menu"
            />
            <div className="absolute bottom-full right-2 mb-2 z-40 bg-white rounded-2xl border border-neutral-200 shadow-lg overflow-hidden min-w-[200px]">
              <PlusMenuItem
                icon={<BookOpen className="h-4 w-4" />}
                label="Catalogue"
                active={view === 'catalogue'}
                onClick={() => navigate('catalogue')}
              />
              <PlusMenuItem
                icon={<HeartPulse className="h-4 w-4" />}
                label="Santé"
                active={view === 'health'}
                onClick={() => navigate('health')}
              />
              <PlusMenuItem
                icon={<Egg className="h-4 w-4" />}
                label="Incubation"
                active={view === 'incubation'}
                onClick={() => navigate('incubation')}
              />
              <PlusMenuItem
                icon={<BarChart3 className="h-4 w-4" />}
                label="Statistiques"
                active={view === 'stats'}
                onClick={() => navigate('stats')}
              />
              <PlusMenuItem
                icon={<Palette className="h-4 w-4" />}
                label="Personnalisation"
                active={view === 'settings'}
                onClick={() => navigate('settings')}
              />
            </div>
          </>
        )}

        <div className="max-w-3xl mx-auto flex relative">
          <NavTab
            active={view === 'dashboard'}
            onClick={() => navigate('dashboard')}
            icon={<LayoutDashboard className="h-5 w-5" />}
            label="Accueil"
          />
          <NavTab
            active={view === 'lots'}
            onClick={() => navigate('lots')}
            icon={<Layers3 className="h-5 w-5" />}
            label="Lots"
          />
          <NavTab
            active={view === 'production'}
            onClick={() => navigate('production')}
            icon={<ClipboardList className="h-5 w-5" />}
            label="Production"
          />
          <NavTab
            active={view === 'stocks'}
            onClick={() => navigate('stocks')}
            icon={<Boxes className="h-5 w-5" />}
            label="Stocks"
          />
          <NavTab
            active={view === 'finances'}
            onClick={() => navigate('finances')}
            icon={<Wallet className="h-5 w-5" />}
            label="Finances"
          />
          <NavTab
            active={isPlusView || plusOpen}
            onClick={() => setPlusOpen((v) => !v)}
            icon={<MoreHorizontal className="h-5 w-5" />}
            label="Plus"
          />
        </div>
      </nav>
    </div>
  );
}

function NavTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex-1 py-2 flex flex-col items-center gap-0.5 text-[10px] sm:text-xs font-medium leading-tight whitespace-nowrap transition-colors min-w-0 ' +
        (active ? 'text-brand' : 'text-neutral-500 hover:text-neutral-800')
      }
      aria-current={active ? 'page' : undefined}
      aria-label={label}
    >
      <span
        className={
          'rounded-lg px-2 py-1 transition-colors ' + (active ? 'bg-brand/10' : '')
        }
      >
        {icon}
      </span>
      {/* En dessous de 380px (iPhone SE), on cache le label : icônes seules
          + aria-label sur le bouton pour l'accessibilité. */}
      <span className="hidden min-[380px]:inline">{label}</span>
    </button>
  );
}

function PlusMenuItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ' +
        (active
          ? 'bg-brand/10 text-brand'
          : 'text-neutral-700 hover:bg-neutral-50')
      }
    >
      {icon}
      {label}
    </button>
  );
}
