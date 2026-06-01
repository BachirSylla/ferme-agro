import { useState } from 'react';
import { ShoppingCart, Receipt } from 'lucide-react';
import { SalesPanel } from './SalesPanel';
import { ExpensesPanel } from './ExpensesPanel';

type Tab = 'sales' | 'expenses';

export function FinancesScreen() {
  const [tab, setTab] = useState<Tab>('sales');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Ventes (rentrées) et dépenses (sorties d'argent).
        </p>
      </div>

      <div role="tablist" className="flex bg-neutral-100 rounded-xl p-1 self-start">
        <TabButton
          active={tab === 'sales'}
          onClick={() => setTab('sales')}
          icon={<ShoppingCart className="h-4 w-4" />}
        >
          Ventes
        </TabButton>
        <TabButton
          active={tab === 'expenses'}
          onClick={() => setTab('expenses')}
          icon={<Receipt className="h-4 w-4" />}
        >
          Dépenses
        </TabButton>
      </div>

      {tab === 'sales' ? <SalesPanel /> : <ExpensesPanel />}
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
