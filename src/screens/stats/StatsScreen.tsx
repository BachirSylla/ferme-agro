import { useState } from 'react';
import { TrendingUp, Target, Layers3 } from 'lucide-react';
import { EvolutionPanel } from './EvolutionPanel';
import { GoalsPanel } from './GoalsPanel';
import { MarginsPanel } from './MarginsPanel';

type Tab = 'evolution' | 'margins' | 'goals';

export function StatsScreen() {
  const [tab, setTab] = useState<Tab>('evolution');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Statistiques</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Évolution, marge par lot et objectifs.
        </p>
      </div>

      <div role="tablist" className="flex bg-neutral-100 rounded-xl p-1 self-start flex-wrap">
        <TabButton
          active={tab === 'evolution'}
          onClick={() => setTab('evolution')}
          icon={<TrendingUp className="h-4 w-4" />}
        >
          Évolution
        </TabButton>
        <TabButton
          active={tab === 'margins'}
          onClick={() => setTab('margins')}
          icon={<Layers3 className="h-4 w-4" />}
        >
          Marge par lot
        </TabButton>
        <TabButton
          active={tab === 'goals'}
          onClick={() => setTab('goals')}
          icon={<Target className="h-4 w-4" />}
        >
          Objectifs
        </TabButton>
      </div>

      {tab === 'evolution' ? (
        <EvolutionPanel />
      ) : tab === 'margins' ? (
        <MarginsPanel />
      ) : (
        <GoalsPanel />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ' +
        (active
          ? 'bg-white text-neutral-900 shadow-sm'
          : 'text-neutral-600 hover:text-neutral-900')
      }
    >
      {icon}
      {children}
    </button>
  );
}

// Default export pour le React.lazy() côté AppShell.
export default StatsScreen;
