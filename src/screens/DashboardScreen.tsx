import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart,
  TrendingUp,
  ClipboardList,
  Layers3,
  ChevronRight,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import {
  PAYMENT_CLASS,
  PAYMENT_LABEL,
  dateShortFmt,
  qtyFmt,
  todayIso,
  xofFmt,
} from '@/lib/format';
import type { Enums, Tables, Views } from '@/types/db';
import type { View } from './navigation';

type FinancialSummary = Views<'v_financial_summary'>;
type LotOverview = Views<'v_lot_overview'>;
type Sale = Tables<'sales'>;
type Production = Tables<'production_records'>;
type Category = Enums<'production_category'>;
type PaymentMethod = Enums<'payment_method'>;

const CATEGORY_LABEL: Record<Category, string> = {
  ponte: 'Ponte',
  casse: 'Casse',
  consomme: 'Consommé',
  recolte: 'Récolte',
};
const CATEGORY_CLASS: Record<Category, string> = {
  ponte: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  casse: 'bg-red-100 text-red-800 border-red-200',
  consomme: 'bg-amber-100 text-amber-800 border-amber-200',
  recolte: 'bg-blue-100 text-blue-800 border-blue-200',
};

function firstOfMonthIso(): string {
  const today = todayIso();
  return `${today.slice(0, 7)}-01`; // 'YYYY-MM-01'
}

function currentMonthLabel(): string {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date());
}

type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function DashboardScreen({ onNavigate }: { onNavigate: (view: View) => void }) {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const firstName = session.profile.full_name?.split(' ')[0] ?? null;
  const orgName = session.organization.name;

  const [summary, setSummary] = useState<LoadState<FinancialSummary | null>>({ status: 'loading' });
  const [production, setProduction] = useState<LoadState<Production[]>>({ status: 'loading' });
  const [lots, setLots] = useState<LoadState<LotOverview[]>>({ status: 'loading' });
  const [sales, setSales] = useState<LoadState<Sale[]>>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const today = todayIso();
    const month = firstOfMonthIso();

    // Les 4 requêtes sont indépendantes → parallèle.
    const [sumRes, prodRes, lotRes, salesRes] = await Promise.all([
      supabase
        .from('v_financial_summary')
        .select('*')
        .eq('mois', month)
        .maybeSingle(),
      supabase
        .from('production_records')
        .select('*')
        .eq('day', today)
        .is('deleted_at', null),
      supabase
        .from('v_lot_overview')
        .select('*')
        .eq('status', 'actif')
        .order('cout_total', { ascending: false, nullsFirst: false })
        .limit(5),
      supabase
        .from('sales')
        .select('*')
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    setSummary(
      sumRes.error
        ? { status: 'error', message: sumRes.error.message }
        : { status: 'ready', data: sumRes.data ?? null },
    );
    setProduction(
      prodRes.error
        ? { status: 'error', message: prodRes.error.message }
        : { status: 'ready', data: prodRes.data ?? [] },
    );
    setLots(
      lotRes.error
        ? { status: 'error', message: lotRes.error.message }
        : { status: 'ready', data: lotRes.data ?? [] },
    );
    setSales(
      salesRes.error
        ? { status: 'error', message: salesRes.error.message }
        : { status: 'ready', data: salesRes.data ?? [] },
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ─── KPI mois courant ──────────────────────────────────────
  // Le user voit revenus/depenses/benefice de SA ferme uniquement
  // (sécurité via RLS + security_invoker sur la vue). Pas de fallback magique :
  // si la ligne du mois n'existe pas, on affiche 0.
  const revenus = summary.status === 'ready' && summary.data ? summary.data.revenus ?? 0 : 0;
  const depenses = summary.status === 'ready' && summary.data ? summary.data.depenses ?? 0 : 0;
  const benefice = summary.status === 'ready' && summary.data ? summary.data.benefice ?? 0 : 0;
  const summaryLoading = summary.status === 'loading';

  return (
    <div className="flex flex-col gap-5">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Bonjour, ${firstName}` : 'Bonjour 👋'}
        </h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Tableau de bord de <span className="font-medium text-neutral-700">{orgName}</span>
        </p>
      </div>

      {/* KPI mois courant */}
      <section>
        <SectionHeader title={`Ce mois (${currentMonthLabel()})`} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            label="Revenus"
            value={revenus}
            tone="neutral"
            icon={<ArrowDownRight className="h-4 w-4" />}
            loading={summaryLoading}
            onClick={() => onNavigate('finances')}
          />
          <KpiCard
            label="Dépenses"
            value={depenses}
            tone="neutral"
            icon={<ArrowUpRight className="h-4 w-4" />}
            loading={summaryLoading}
            onClick={() => onNavigate('finances')}
          />
          <KpiCard
            label="Bénéfice"
            value={benefice}
            tone={benefice > 0 ? 'positive' : benefice < 0 ? 'negative' : 'neutral'}
            icon={<TrendingUp className="h-4 w-4" />}
            loading={summaryLoading}
            onClick={() => onNavigate('finances')}
          />
        </div>
        {summary.status === 'ready' && !summary.data && (
          <p className="text-xs text-neutral-400 mt-2 px-1">
            Pas encore d'activité ce mois — saisissez une vente ou une dépense pour démarrer.
          </p>
        )}
        {summary.status === 'error' && (
          <ErrorLine message={summary.message} />
        )}
      </section>

      {/* Production du jour */}
      <ProductionTodayCard
        state={production}
        onClick={() => onNavigate('production')}
      />

      {/* Marge par lot + Ventes récentes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <LotsCard state={lots} onClick={() => onNavigate('lots')} />
        <RecentSalesCard state={sales} onClick={() => onNavigate('finances')} />
      </div>
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold text-neutral-700 mb-2 px-1">{title}</h2>;
}

function KpiCard({
  label,
  value,
  tone,
  icon,
  loading,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'positive' | 'negative';
  icon: React.ReactNode;
  loading: boolean;
  onClick: () => void;
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-red-700'
        : 'text-neutral-900';
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl bg-white border border-neutral-200 p-4 hover:bg-neutral-50 hover:border-neutral-300 transition-colors shadow-sm"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
        {icon}
        {label}
      </div>
      {loading ? (
        <div className="h-7 w-24 bg-neutral-200 rounded animate-pulse mt-2" />
      ) : (
        <div className={`text-2xl font-semibold tracking-tight mt-1 ${valueClass}`}>
          {xofFmt.format(value)}
          <span className="text-sm font-medium text-neutral-400 ml-1">FCFA</span>
        </div>
      )}
    </button>
  );
}

function CardLink({
  title,
  icon,
  onClick,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl bg-white border border-neutral-200 hover:border-neutral-300 transition-colors shadow-sm overflow-hidden group flex flex-col"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
          <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
            {icon}
          </span>
          {title}
        </div>
        <ChevronRight className="h-4 w-4 text-neutral-400 group-hover:text-neutral-600 transition-colors" />
      </div>
      <div className="px-4 pb-4">{children}</div>
    </button>
  );
}

// ─── Production du jour ─────────────────────────────────────

function ProductionTodayCard({
  state,
  onClick,
}: {
  state: LoadState<Production[]>;
  onClick: () => void;
}) {
  // Groupement par catégorie pour éviter d'additionner des unités incomparables
  // (ex. œufs vs litres de récolte).
  const byCategory = useMemo(() => {
    if (state.status !== 'ready') return null;
    const m = new Map<Category, { qty: number; count: number }>();
    for (const r of state.data) {
      const cur = m.get(r.category) ?? { qty: 0, count: 0 };
      cur.qty += r.quantity;
      cur.count += 1;
      m.set(r.category, cur);
    }
    return m;
  }, [state]);

  return (
    <CardLink
      title="Production du jour"
      icon={<ClipboardList className="h-4 w-4" />}
      onClick={onClick}
    >
      {state.status === 'loading' ? (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-1/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-neutral-200 rounded animate-pulse" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorLine message={state.message} />
      ) : state.data.length === 0 ? (
        <p className="text-sm text-neutral-500">Aucune saisie aujourd'hui.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-700">
            <span className="font-semibold">{state.data.length}</span> saisie
            {state.data.length > 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {byCategory &&
              Array.from(byCategory.entries()).map(([cat, agg]) => (
                <span
                  key={cat}
                  className={
                    'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md border ' +
                    CATEGORY_CLASS[cat]
                  }
                >
                  {CATEGORY_LABEL[cat]} · {qtyFmt.format(agg.qty)}
                </span>
              ))}
          </div>
        </div>
      )}
    </CardLink>
  );
}

// ─── Marge / coûts par lot ──────────────────────────────────

function LotsCard({
  state,
  onClick,
}: {
  state: LoadState<LotOverview[]>;
  onClick: () => void;
}) {
  return (
    <CardLink title="Marge par lot" icon={<Layers3 className="h-4 w-4" />} onClick={onClick}>
      {state.status === 'loading' ? (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-2/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-neutral-200 rounded animate-pulse" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorLine message={state.message} />
      ) : state.data.length === 0 ? (
        <p className="text-sm text-neutral-500">Aucun lot actif.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.data.map((l) => (
            <li
              key={l.lot_id ?? l.code ?? Math.random()}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="font-medium truncate">{l.code ?? '—'}</span>
              <span className="text-xs text-neutral-500 whitespace-nowrap">
                {qtyFmt.format(l.total_produit ?? 0)} produit · {xofFmt.format(l.cout_total ?? 0)}{' '}
                FCFA
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* La marge en FCFA n'est pas calculable depuis v_lot_overview seule :
          les ventes ne portent pas de lot_id. À ajouter quand le lien existera
          (vue dédiée ou champ sale_items.lot_id). En attendant on montre coût + production. */}
    </CardLink>
  );
}

// ─── Ventes récentes ────────────────────────────────────────

function RecentSalesCard({
  state,
  onClick,
}: {
  state: LoadState<Sale[]>;
  onClick: () => void;
}) {
  return (
    <CardLink
      title="Ventes récentes"
      icon={<ShoppingCart className="h-4 w-4" />}
      onClick={onClick}
    >
      {state.status === 'loading' ? (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-2/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-neutral-200 rounded animate-pulse" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorLine message={state.message} />
      ) : state.data.length === 0 ? (
        <p className="text-sm text-neutral-500">Aucune vente enregistrée.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-xs text-neutral-500 whitespace-nowrap">
                {dateShortFmt.format(new Date(s.day))}
              </span>
              <span className="font-medium truncate">{xofFmt.format(s.total)} FCFA</span>
              <PaymentBadge method={s.payment_method} />
            </li>
          ))}
        </ul>
      )}
    </CardLink>
  );
}

function PaymentBadge({ method }: { method: PaymentMethod }) {
  return (
    <span
      className={
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ' +
        PAYMENT_CLASS[method]
      }
    >
      {PAYMENT_LABEL[method]}
    </span>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1 mt-1">
      Erreur : {message}
    </p>
  );
}

// Note négoce vs ferme (cf. CLAUDE.md) :
// - v_financial_summary.depenses = total cash en sortie (table expenses).
//   Inclut donc les achats de marchandise (miel), pas les coûts d'intrants
//   valorisés via stock_movements.
// - v_lot_overview.cout_total combine depenses_directes (expenses imputées au lot),
//   cout_intrants (stock_movements) et cout_sante. C'est un coût par lot pour la
//   marge analytique, à ne pas additionner avec le total cash mensuel.
