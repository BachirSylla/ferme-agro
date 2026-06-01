import { useState } from 'react';
import { LayoutDashboard, BookOpen, Layers3, ClipboardList, Wallet, LogOut } from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { DashboardScreen } from './DashboardScreen';
import { CatalogueScreen } from './catalogue/CatalogueScreen';
import { LotsScreen } from './lots/LotsScreen';
import { ProductionScreen } from './production/ProductionScreen';
import { FinancesScreen } from './finances/FinancesScreen';
import type { View } from './navigation';

export function AppShell() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;

  const { profile, organization, signOut } = session;
  const userLabel = profile.full_name ?? session.session.user.email ?? 'utilisateur';
  const [view, setView] = useState<View>('dashboard');

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
          <DashboardScreen onNavigate={setView} />
        ) : view === 'catalogue' ? (
          <CatalogueScreen />
        ) : view === 'lots' ? (
          <LotsScreen />
        ) : view === 'production' ? (
          <ProductionScreen />
        ) : (
          <FinancesScreen />
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur border-t border-neutral-200 safe-bottom">
        <div className="max-w-3xl mx-auto flex">
          <NavTab
            active={view === 'dashboard'}
            onClick={() => setView('dashboard')}
            icon={<LayoutDashboard className="h-5 w-5" />}
            label="Accueil"
          />
          <NavTab
            active={view === 'catalogue'}
            onClick={() => setView('catalogue')}
            icon={<BookOpen className="h-5 w-5" />}
            label="Catalogue"
          />
          <NavTab
            active={view === 'lots'}
            onClick={() => setView('lots')}
            icon={<Layers3 className="h-5 w-5" />}
            label="Lots"
          />
          <NavTab
            active={view === 'production'}
            onClick={() => setView('production')}
            icon={<ClipboardList className="h-5 w-5" />}
            label="Production"
          />
          <NavTab
            active={view === 'finances'}
            onClick={() => setView('finances')}
            icon={<Wallet className="h-5 w-5" />}
            label="Finances"
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
        'flex-1 py-2.5 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors ' +
        (active
          ? 'text-brand'
          : 'text-neutral-500 hover:text-neutral-800')
      }
      aria-current={active ? 'page' : undefined}
    >
      <span
        className={
          'rounded-lg px-3 py-1 transition-colors ' +
          (active ? 'bg-brand/10' : '')
        }
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
