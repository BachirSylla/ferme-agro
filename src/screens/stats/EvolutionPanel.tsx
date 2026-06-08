import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { ChevronLeft, ChevronRight, LineChart as LineIcon, BarChart3, FileDown, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import {
  abbreviateXof,
  addMonthsIso,
  firstOfMonthIso,
  lastOfMonthIso,
  monthLongLabel,
  monthShortLabel,
  qtyFmt,
  formatFCFA,
  formatNumberFr,
} from '@/lib/format';
import type { Enums, Views } from '@/types/db';

// Type local pour le contenu de Tooltip — recharts 3.x n'expose plus
// TooltipProps avec les champs payload/label, mais le runtime les fournit.
type TooltipContentProps = {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    dataKey?: string | number;
  }>;
  label?: string | number;
};

type Summary = Views<'v_financial_summary'>;
type Category = Enums<'production_category'>;
type ProductionRow = { day: string; quantity: number; category: Category };

type Mode = 'range12' | 'range6' | 'navigate';

const CATEGORY_LABEL: Record<Category, string> = {
  ponte: 'Ponte',
  casse: 'Casse',
  consomme: 'Consommé',
  recolte: 'Récolte',
};
const CATEGORY_COLOR: Record<Category, string> = {
  ponte: '#059669',
  casse: '#dc2626',
  consomme: '#d97706',
  recolte: '#2563eb',
};

const COLOR_REVENUS = '#059669';
const COLOR_DEPENSES = '#dc2626';
const COLOR_BENEFICE = '#0284c7';

const CHART_HEIGHT = 250;

type FinPoint = {
  label: string;
  mois: string;
  revenus: number;
  depenses: number;
  benefice: number;
};

type ProdPoint = {
  label: string;
  Ponte: number;
  Casse: number;
  Consommé: number;
  Récolte: number;
};

export function EvolutionPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('range12');
  const [cursor, setCursor] = useState<string>(firstOfMonthIso());
  const [exporting, setExporting] = useState(false);

  // Mois exporté : si on est en "Mois précis", c'est le cursor sélectionné ;
  // sinon (range), on prend le mois en cours pour ne pas surprendre l'utilisateur.
  const exportMonth = mode === 'navigate' ? cursor : firstOfMonthIso();

  async function onExportPdf() {
    if (session.status !== 'authenticated') return;
    setExporting(true);
    try {
      // Import dynamique : le bundle jsPDF + autoTable n'arrive qu'au premier
      // clic, dans son propre chunk Vite.
      const { generateMonthlyReport } = await import('@/lib/pdf/generateMonthlyReport');
      await generateMonthlyReport({
        organization: session.organization,
        monthIso: exportMonth,
      });
      toast.push('success', 'Rapport téléchargé.');
    } catch (err) {
      toast.push(
        'error',
        `Échec de l'export : ${err instanceof Error ? err.message : 'inconnu'}`,
      );
    } finally {
      setExporting(false);
    }
  }

  const months = useMemo<string[]>(() => {
    if (mode === 'navigate') return [cursor];
    const count = mode === 'range12' ? 12 : 6;
    const end = firstOfMonthIso();
    return Array.from({ length: count }, (_, i) => addMonthsIso(end, -(count - 1 - i)));
  }, [mode, cursor]);

  const startDay = months[0];
  const endDay = lastOfMonthIso(months[months.length - 1]);
  const isSingleMonth = mode === 'navigate';

  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [productions, setProductions] = useState<ProductionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    setSummaries(null);
    setProductions(null);
    const [sumRes, prodRes] = await Promise.all([
      supabase
        .from('v_financial_summary')
        .select('*')
        .in('mois', months)
        .order('mois', { ascending: true }),
      supabase
        .from('production_records')
        .select('day, quantity, category')
        .gte('day', startDay)
        .lte('day', endDay)
        .is('deleted_at', null),
    ]);
    if (sumRes.error) {
      setError(sumRes.error.message);
      return;
    }
    if (prodRes.error) {
      setError(prodRes.error.message);
      return;
    }
    setSummaries(sumRes.data ?? []);
    setProductions((prodRes.data ?? []) as ProductionRow[]);
  }, [months, startDay, endDay]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const finData = useMemo<FinPoint[]>(() => {
    return months.map((m) => {
      const row = summaries?.find((s) => s.mois === m);
      return {
        label: monthShortLabel(m),
        mois: m,
        revenus: row?.revenus ?? 0,
        depenses: row?.depenses ?? 0,
        benefice: row?.benefice ?? 0,
      };
    });
  }, [months, summaries]);

  const prodData = useMemo<ProdPoint[]>(() => {
    const empty = (): ProdPoint => ({
      label: '',
      Ponte: 0,
      Casse: 0,
      Consommé: 0,
      Récolte: 0,
    });
    const labelFromCategory = (c: Category): keyof Omit<ProdPoint, 'label'> =>
      CATEGORY_LABEL[c] as keyof Omit<ProdPoint, 'label'>;

    if (isSingleMonth) {
      const [y, m] = months[0].split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      const byDay = new Map<string, ProdPoint>();
      for (let i = 1; i <= daysInMonth; i++) {
        const day = `${months[0].slice(0, 7)}-${String(i).padStart(2, '0')}`;
        const point = empty();
        point.label = String(i);
        byDay.set(day, point);
      }
      for (const p of productions ?? []) {
        const point = byDay.get(p.day);
        if (point) point[labelFromCategory(p.category)] += p.quantity;
      }
      return Array.from(byDay.values());
    }
    const byMonth = new Map<string, ProdPoint>();
    for (const m of months) {
      const point = empty();
      point.label = monthShortLabel(m);
      byMonth.set(m, point);
    }
    for (const p of productions ?? []) {
      const month = `${p.day.slice(0, 7)}-01`;
      const point = byMonth.get(month);
      if (point) point[labelFromCategory(p.category)] += p.quantity;
    }
    return Array.from(byMonth.values());
  }, [months, productions, isSingleMonth]);

  const tableRows = useMemo(() => {
    return months
      .map((m) => {
        const sum = summaries?.find((s) => s.mois === m);
        const prodTotal = (productions ?? [])
          .filter((p) => p.day.slice(0, 7) === m.slice(0, 7))
          .reduce((acc, p) => acc + p.quantity, 0);
        return {
          mois: m,
          label: monthLongLabel(m),
          revenus: sum?.revenus ?? 0,
          depenses: sum?.depenses ?? 0,
          benefice: sum?.benefice ?? 0,
          production: prodTotal,
        };
      })
      .reverse();
  }, [months, summaries, productions]);

  const loading = summaries === null || productions === null;
  const hasData = !loading && (summaries.length > 0 || (productions && productions.length > 0));

  return (
    <div className="flex flex-col gap-5">
      <PeriodSelector mode={mode} setMode={setMode} cursor={cursor} setCursor={setCursor} />

      <div className="flex">
        <button
          type="button"
          onClick={() => void onExportPdf()}
          disabled={exporting}
          className="ml-auto text-sm bg-brand text-brand-fg rounded-lg px-3 py-1.5 font-medium hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {exporting ? 'Génération du PDF…' : `Exporter ${monthLongLabel(exportMonth)} en PDF`}
          </span>
          <span className="sm:hidden">
            {exporting ? 'Génération…' : 'Exporter PDF'}
          </span>
        </button>
      </div>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Erreur : {error}
        </div>
      )}

      <ChartCard title="Évolution financière" icon={<LineIcon className="h-4 w-4" />}>
        {loading ? (
          <ChartSkeleton />
        ) : !hasData ? (
          <EmptyChart message="Les courbes se rempliront au fil de vos saisies." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={finData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                stroke="#9ca3af"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                stroke="#9ca3af"
                tickFormatter={(v: number) => abbreviateXof(v)}
                width={48}
              />
              <Tooltip content={<FinancialTooltip />} cursor={{ stroke: '#d1d5db' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line type="monotone" dataKey="revenus" name="Revenus" stroke={COLOR_REVENUS} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="depenses" name="Dépenses" stroke={COLOR_DEPENSES} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="benefice" name="Bénéfice" stroke={COLOR_BENEFICE} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title={isSingleMonth ? 'Production par jour' : 'Production par mois'}
        icon={<BarChart3 className="h-4 w-4" />}
        hint="Quantités saisies par catégorie. Les unités varient selon le produit."
      >
        {loading ? (
          <ChartSkeleton />
        ) : !hasData ? (
          <EmptyChart message="Saisissez votre première production pour voir les barres apparaître." />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={prodData} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                stroke="#9ca3af"
                interval={isSingleMonth ? 2 : 0}
              />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#9ca3af" width={40} />
              <Tooltip content={<ProductionTooltip />} cursor={{ fill: '#f3f4f6' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Bar dataKey="Ponte" fill={CATEGORY_COLOR.ponte} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Casse" fill={CATEGORY_COLOR.casse} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Consommé" fill={CATEGORY_COLOR.consomme} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Récolte" fill={CATEGORY_COLOR.recolte} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Récapitulatif mensuel" icon={null}>
        {loading ? <TableSkeleton /> : <MonthlyTable rows={tableRows} />}
      </ChartCard>
    </div>
  );
}

function PeriodSelector({
  mode,
  setMode,
  cursor,
  setCursor,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  cursor: string;
  setCursor: (c: string) => void;
}) {
  const nowMonth = firstOfMonthIso();
  const canGoForward = cursor < nowMonth;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="tablist" className="flex bg-neutral-100 rounded-xl p-1 self-start">
        <ModeTab active={mode === 'range12'} onClick={() => setMode('range12')}>12 mois</ModeTab>
        <ModeTab active={mode === 'range6'} onClick={() => setMode('range6')}>6 mois</ModeTab>
        <ModeTab active={mode === 'navigate'} onClick={() => setMode('navigate')}>Mois précis</ModeTab>
      </div>
      {mode === 'navigate' && (
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setCursor(addMonthsIso(cursor, -1))}
            className="p-1.5 rounded-md text-neutral-600 hover:bg-neutral-100"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium min-w-[100px] text-center capitalize">
            {monthLongLabel(cursor)}
          </span>
          <button
            type="button"
            onClick={() => canGoForward && setCursor(addMonthsIso(cursor, 1))}
            disabled={!canGoForward}
            className="p-1.5 rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Mois suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function ChartCard({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon && (
          <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
            {icon}
          </span>
        )}
        <h2 className="font-semibold text-neutral-800">{title}</h2>
      </div>
      {hint && <p className="text-xs text-neutral-500 -mt-1">{hint}</p>}
      {children}
    </section>
  );
}

function FinancialTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-2 shadow-md text-xs min-w-[140px]">
      <div className="font-semibold mb-1 capitalize">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? '#999' }} />
            <span className="text-neutral-600">{p.name}</span>
          </div>
          <span className="font-medium text-neutral-900">
            {formatFCFA(Number(p.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProductionTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-2 shadow-md text-xs min-w-[120px]">
      <div className="font-semibold mb-1">{label}</div>
      {payload.map((p) => {
        const v = Number(p.value ?? 0);
        if (v === 0) return null;
        return (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? '#999' }} />
              <span className="text-neutral-600">{p.name}</span>
            </div>
            <span className="font-medium text-neutral-900">{qtyFmt.format(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MonthlyTable({
  rows,
}: {
  rows: { mois: string; label: string; revenus: number; depenses: number; benefice: number; production: number }[];
}) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
            <th className="py-2 px-2 font-medium">Mois</th>
            <th className="py-2 px-2 font-medium text-right">Revenus</th>
            <th className="py-2 px-2 font-medium text-right">Dépenses</th>
            <th className="py-2 px-2 font-medium text-right">Bénéfice</th>
            <th className="py-2 px-2 font-medium text-right">Production</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.mois}>
              <td className="py-2 px-2 capitalize whitespace-nowrap">{r.label}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatNumberFr(r.revenus)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatNumberFr(r.depenses)}</td>
              <td
                className={
                  'py-2 px-2 text-right tabular-nums font-medium ' +
                  (r.benefice > 0 ? 'text-emerald-700' : r.benefice < 0 ? 'text-red-700' : 'text-neutral-700')
                }
              >
                {formatNumberFr(r.benefice)}
              </td>
              <td className="py-2 px-2 text-right tabular-nums text-neutral-700">{qtyFmt.format(r.production)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="w-full bg-neutral-100 rounded animate-pulse" style={{ height: CHART_HEIGHT }} />;
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-6 bg-neutral-100 rounded animate-pulse" />
      ))}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div
      style={{ height: CHART_HEIGHT }}
      className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 grid place-items-center p-6 text-center"
    >
      <p className="text-sm text-neutral-500 max-w-sm">{message}</p>
    </div>
  );
}
