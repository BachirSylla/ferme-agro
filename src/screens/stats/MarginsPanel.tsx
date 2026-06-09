import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { Layers3, Info, TrendingUp, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { abbreviateXof, formatFCFA } from '@/lib/format';
import type { Enums, Views } from '@/types/db';

type LotOverview = Views<'v_lot_overview'>;
type LotStatus = Enums<'lot_status'>;

const COLOR_POSITIVE = '#059669'; // emerald-600
const COLOR_NEGATIVE = '#dc2626'; // red-600
const COLOR_NEUTRAL = '#9ca3af'; // neutral-400

type Filter = 'actif' | 'all';

type LotRow = {
  lot_id: string;
  code: string;
  status: LotStatus;
  revenu: number;
  cout: number;
  marge: number;
};

type TooltipContentProps = {
  active?: boolean;
  payload?: Array<{ payload?: LotRow }>;
};

export function MarginsPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;

  const [lots, setLots] = useState<LotOverview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('actif');

  const refresh = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from('v_lot_overview')
      .select('*')
      .order('code', { ascending: true });
    if (error) {
      setLoadError(error.message);
      setLots([]);
      return;
    }
    setLots(data ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Filtrage + normalisation en LotRow (les colonnes de la vue sont toutes
  // nullables côté types ; on défaut à 0 / 'actif' / '—').
  const rows = useMemo<LotRow[] | null>(() => {
    if (!lots) return null;
    const all: LotRow[] = lots
      .filter((l) => l.lot_id !== null && l.code !== null)
      .map((l) => ({
        lot_id: l.lot_id as string,
        code: l.code as string,
        status: (l.status as LotStatus) ?? 'actif',
        revenu: l.revenu_rattache ?? 0,
        cout: l.cout_total ?? 0,
        marge: l.marge ?? -(l.cout_total ?? 0),
      }));
    return filter === 'actif' ? all.filter((r) => r.status === 'actif') : all;
  }, [lots, filter]);

  const aggregate = useMemo(() => {
    if (!rows) return null;
    const revenu = rows.reduce((s, r) => s + r.revenu, 0);
    const cout = rows.reduce((s, r) => s + r.cout, 0);
    const marge = rows.reduce((s, r) => s + r.marge, 0);
    const withRevenue = rows.filter((r) => r.revenu > 0).length;
    return { revenu, cout, marge, withRevenue, count: rows.length };
  }, [rows]);

  // Données graphique triées par marge desc — plus parlant qu'alphabétique.
  const chartData = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => b.marge - a.marge);
  }, [rows]);

  const chartHeight = Math.max(160, chartData.length * 36 + 40);

  return (
    <div className="flex flex-col gap-5">
      {/* ─── Bandeau d'explication anti-double-comptage ─── */}
      <div className="text-xs bg-sky-50 border border-sky-200 text-sky-900 rounded-xl px-3 py-2 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <strong>Vue analytique.</strong> Seules les ventes <em>rattachées</em>
          à un lot (champ « Lot d'origine » dans le formulaire de vente)
          comptent dans le revenu et la marge ci-dessous. C'est une analyse
          par lot, pas le bénéfice global de la ferme.
        </div>
      </div>

      {/* ─── Filtre statut ─── */}
      <div role="tablist" className="flex bg-neutral-100 rounded-xl p-1 self-start">
        <FilterButton active={filter === 'actif'} onClick={() => setFilter('actif')}>
          Lots actifs
        </FilterButton>
        <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
          Tous les lots
        </FilterButton>
      </div>

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger : {loadError}
        </div>
      )}

      {rows === null ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <EmptyLots />
      ) : (
        <>
          {/* ─── Agrégats (KPIs) ─── */}
          {aggregate && (
            <div className="grid grid-cols-3 gap-3">
              <AggregateCard
                label="Revenus rattachés"
                value={aggregate.revenu}
                icon={<ArrowDownRight className="h-4 w-4" />}
                tone="neutral"
              />
              <AggregateCard
                label="Coûts cumulés"
                value={aggregate.cout}
                icon={<ArrowUpRight className="h-4 w-4" />}
                tone="neutral"
              />
              <AggregateCard
                label="Marge analytique"
                value={aggregate.marge}
                icon={<TrendingUp className="h-4 w-4" />}
                tone={aggregate.marge > 0 ? 'positive' : aggregate.marge < 0 ? 'negative' : 'neutral'}
              />
            </div>
          )}
          {aggregate && (
            <p className="text-xs text-neutral-500 -mt-2 px-1">
              {aggregate.withRevenue} lot{aggregate.withRevenue > 1 ? 's' : ''} sur{' '}
              {aggregate.count} ont au moins une vente rattachée.
            </p>
          )}

          {/* ─── Bar chart horizontal ─── */}
          <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
                <Layers3 className="h-4 w-4" />
              </span>
              <h2 className="font-semibold text-neutral-800">Marge par lot</h2>
            </div>
            <p className="text-xs text-neutral-500 -mt-1">
              Tri par marge décroissante. Couleur verte si positive, rouge si négative.
            </p>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid stroke="#e5e7eb" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  stroke="#9ca3af"
                  tickFormatter={(v: number) => abbreviateXof(v)}
                />
                <YAxis
                  dataKey="code"
                  type="category"
                  tick={{ fontSize: 11, fill: '#374151' }}
                  stroke="#9ca3af"
                  width={120}
                />
                <Tooltip content={<MarginTooltip />} cursor={{ fill: '#f3f4f6' }} />
                <Bar dataKey="marge" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.lot_id}
                      fill={
                        entry.marge > 0
                          ? COLOR_POSITIVE
                          : entry.marge < 0
                            ? COLOR_NEGATIVE
                            : COLOR_NEUTRAL
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>

          {/* ─── Table détaillée ─── */}
          <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-2">
            <h2 className="font-semibold text-neutral-800">Détail par lot</h2>
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
                    <th className="py-2 px-2 font-medium">Code</th>
                    <th className="py-2 px-2 font-medium">Statut</th>
                    <th className="py-2 px-2 font-medium text-right">Revenu</th>
                    <th className="py-2 px-2 font-medium text-right">Coût</th>
                    <th className="py-2 px-2 font-medium text-right">Marge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {chartData.map((r) => (
                    <tr key={r.lot_id}>
                      <td className="py-2 px-2 font-medium truncate max-w-[160px]">{r.code}</td>
                      <td className="py-2 px-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {r.revenu === 0 ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          formatFCFA(r.revenu)
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-neutral-700">
                        {formatFCFA(r.cout)}
                      </td>
                      <td
                        className={
                          'py-2 px-2 text-right tabular-nums font-medium ' +
                          (r.marge > 0
                            ? 'text-emerald-700'
                            : r.marge < 0
                              ? 'text-red-700'
                              : 'text-neutral-700')
                        }
                      >
                        {formatFCFA(r.marge)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' +
        (active ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900')
      }
    >
      {children}
    </button>
  );
}

function AggregateCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'neutral' | 'positive' | 'negative';
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-red-700'
        : 'text-neutral-900';
  return (
    <div className="rounded-2xl bg-white border border-neutral-200 p-3 shadow-sm flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-sm sm:text-base font-semibold tabular-nums leading-tight ${valueClass}`}>
        {formatFCFA(value)}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<LotStatus, string> = {
  actif: 'Actif',
  vendu: 'Vendu',
  termine: 'Terminé',
};
const STATUS_CLASS: Record<LotStatus, string> = {
  actif: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  vendu: 'bg-blue-100 text-blue-800 border-blue-200',
  termine: 'bg-neutral-100 text-neutral-700 border-neutral-200',
};

function StatusBadge({ status }: { status: LotStatus }) {
  return (
    <span
      className={
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border ' +
        STATUS_CLASS[status]
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function MarginTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const lot = payload[0].payload;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-2 shadow-md text-xs min-w-[170px]">
      <div className="font-semibold mb-1 truncate">{lot.code}</div>
      <div className="flex justify-between gap-3">
        <span className="text-neutral-600">Revenu rattaché</span>
        <span className="font-medium tabular-nums">{formatFCFA(lot.revenu)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-neutral-600">Coût total</span>
        <span className="font-medium tabular-nums">{formatFCFA(lot.cout)}</span>
      </div>
      <div className="flex justify-between gap-3 pt-1 mt-1 border-t border-neutral-100">
        <span className="text-neutral-600">Marge</span>
        <span
          className={
            'font-semibold tabular-nums ' +
            (lot.marge > 0
              ? 'text-emerald-700'
              : lot.marge < 0
                ? 'text-red-700'
                : 'text-neutral-900')
          }
        >
          {formatFCFA(lot.marge)}
        </span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl bg-white border border-neutral-200 p-3 shadow-sm">
            <div className="h-3 w-2/3 bg-neutral-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-1/2 bg-neutral-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="h-40 bg-neutral-100 rounded-2xl animate-pulse" />
    </div>
  );
}

function EmptyLots() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <Layers3 className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucun lot</div>
        <p className="text-sm text-neutral-600 mt-0.5 max-w-sm">
          Créez un lot dans l'onglet <strong>Lots</strong>, puis rattachez vos
          ventes au lot dans le formulaire de vente pour voir la marge
          analytique apparaître ici.
        </p>
      </div>
    </div>
  );
}
