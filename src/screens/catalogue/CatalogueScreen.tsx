import { useState } from 'react';
import { Layers, Package } from 'lucide-react';
import { SpeciesPanel } from './SpeciesPanel';
import { ProductsPanel } from './ProductsPanel';

type Tab = 'species' | 'products';

export function CatalogueScreen() {
  const [tab, setTab] = useState<Tab>('species');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Les espèces que vous élevez et les produits que vous vendez.
        </p>
      </div>

      <div role="tablist" className="flex bg-neutral-100 rounded-xl p-1 self-start">
        <TabButton
          active={tab === 'species'}
          onClick={() => setTab('species')}
          icon={<Layers className="h-4 w-4" />}
        >
          Espèces
        </TabButton>
        <TabButton
          active={tab === 'products'}
          onClick={() => setTab('products')}
          icon={<Package className="h-4 w-4" />}
        >
          Produits
        </TabButton>
      </div>

      {tab === 'species' ? <SpeciesPanel /> : <ProductsPanel />}
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
