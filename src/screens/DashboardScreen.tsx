import { Activity, Boxes, ShoppingBag, TrendingUp } from 'lucide-react';
import { useSession } from '@/context/SessionContext';

export function DashboardScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const firstName = session.profile.full_name?.split(' ')[0] ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Bonjour, ${firstName}` : 'Bonjour 👋'}
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Voici un aperçu de votre ferme.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <PreviewCard
          icon={<Activity className="h-5 w-5" />}
          label="Production du jour"
          hint="à venir"
        />
        <PreviewCard
          icon={<Boxes className="h-5 w-5" />}
          label="Stocks bas"
          hint="à venir"
        />
        <PreviewCard
          icon={<ShoppingBag className="h-5 w-5" />}
          label="Ventes récentes"
          hint="à venir"
        />
        <PreviewCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Marge par lot"
          hint="à venir"
        />
      </div>

      <section className="rounded-2xl bg-white border border-neutral-200 p-5">
        <h2 className="font-semibold mb-1">Pour démarrer</h2>
        <p className="text-sm text-neutral-600">
          Commencez par remplir votre <strong>catalogue</strong> : espèces que vous élevez
          et produits que vous vendez. Les lots, la production et les ventes viendront
          ensuite s'appuyer dessus.
        </p>
      </section>
    </div>
  );
}

function PreviewCard({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-2">
      <div className="h-9 w-9 rounded-xl bg-brand/10 text-brand grid place-items-center">
        {icon}
      </div>
      <div className="text-sm font-medium text-neutral-800">{label}</div>
      <div className="text-xs text-neutral-400">{hint}</div>
    </div>
  );
}
