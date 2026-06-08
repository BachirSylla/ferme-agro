import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  Target,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  firstOfMonthIso,
  lastOfMonthIso,
  percentFmt,
  qtyFmt,
  formatFCFA,
} from '@/lib/format';
import type { Tables } from '@/types/db';

type Goal = Tables<'goals'>;

// Métriques effectivement calculables au MVP. Toute autre métrique est listée
// dans le formulaire mais marquée disabled — pas de saisie tant qu'on ne sait
// pas la mesurer (cf. CLAUDE.md, P3 santé/objectifs pour le reste).
const SUPPORTED_METRICS = [
  'production_oeufs',
  'revenus',
  'benefice',
  'taux_mortalite',
  'taux_eclosion',
] as const;
type SupportedMetric = (typeof SUPPORTED_METRICS)[number];

const METRIC_LABEL: Record<SupportedMetric, string> = {
  production_oeufs: 'Production d\u2019œufs (ponte)',
  revenus: 'Revenus',
  benefice: 'Bénéfice',
  taux_mortalite: 'Taux de mortalité',
  taux_eclosion: 'Taux d\u2019éclosion',
};

const METRIC_UNIT: Record<SupportedMetric, 'xof' | 'count' | 'percent'> = {
  production_oeufs: 'count',
  revenus: 'xof',
  benefice: 'xof',
  taux_mortalite: 'percent',
  taux_eclosion: 'percent',
};

// Métriques inversées : la cible est un MAXIMUM à ne pas dépasser, pas un
// objectif à atteindre. Le statut est inversé : sous la cible = bon.
const INVERTED_METRICS: SupportedMetric[] = ['taux_mortalite'];

// La projection linéaire (prorata temporis) suppose un flux régulier. Elle est
// valide pour la ponte (rythme journalier ~stable) mais trompeuse pour les
// métriques financières cumulées et pour les taux instantanés.
const SUPPORTS_LINEAR_PROJECTION: Record<SupportedMetric, boolean> = {
  production_oeufs: true,
  revenus: false,
  benefice: false,
  taux_mortalite: false,
  taux_eclosion: false,
};

const FUTURE_METRICS: { key: string; label: string }[] = [
  { key: 'marge_par_lot', label: 'Marge par lot' },
];

const SUPPORTED_PERIODS = ['mensuel'] as const;
type SupportedPeriod = (typeof SUPPORTED_PERIODS)[number];

const PERIOD_LABEL: Record<SupportedPeriod, string> = {
  mensuel: 'Mensuel',
};

function formatValue(metric: SupportedMetric, value: number): string {
  const unit = METRIC_UNIT[metric];
  if (unit === 'xof') return formatFCFA(value);
  if (unit === 'percent') return `${percentFmt.format(value)} %`;
  return qtyFmt.format(value);
}

// Renvoie les bornes [start, end] (dates YYYY-MM-DD) de la période actuelle
// pour cet objectif, en respectant les start_date/end_date saisis si présents.
function periodBoundsForGoal(goal: Goal): { start: string; end: string } | null {
  if (goal.start_date && goal.end_date) {
    return { start: goal.start_date, end: goal.end_date };
  }
  if (goal.period === 'mensuel') {
    const start = goal.start_date ?? firstOfMonthIso();
    const monthStart = `${start.slice(0, 7)}-01`;
    const end = goal.end_date ?? lastOfMonthIso(monthStart);
    return { start: monthStart, end };
  }
  // Périodes non supportées au MVP : trimestriel, annuel, etc.
  return null;
}

// Calcule la valeur courante de la métrique sur la période donnée.
async function fetchMetricActual(
  metric: SupportedMetric,
  start: string,
  end: string,
): Promise<number | null> {
  if (metric === 'production_oeufs') {
    const { data, error } = await supabase
      .from('production_records')
      .select('quantity')
      .eq('category', 'ponte')
      .gte('day', start)
      .lte('day', end)
      .is('deleted_at', null);
    if (error) return null;
    return (data ?? []).reduce((acc, r) => acc + r.quantity, 0);
  }
  if (metric === 'taux_eclosion') {
    // Taux d'éclosion = SUM(hatched_count) / SUM(eggs_count) × 100
    // sur les couvées TERMINÉES (eclos ou echoue) dont la set_date est dans la période.
    const { data, error } = await supabase
      .from('incubation_batches')
      .select('eggs_count, hatched_count')
      .gte('set_date', start)
      .lte('set_date', end)
      .in('status', ['eclos', 'echoue'])
      .is('deleted_at', null);
    if (error) return null;
    const totalEggs = (data ?? []).reduce((s, r) => s + r.eggs_count, 0);
    const totalHatched = (data ?? []).reduce((s, r) => s + (r.hatched_count ?? 0), 0);
    if (totalEggs === 0) return 0;
    return (totalHatched / totalEggs) * 100;
  }
  if (metric === 'taux_mortalite') {
    // Taux = SUM(mortalité sur la période) / SUM(initial_count des lots actifs) × 100.
    // Périmètre = lots actuellement non archivés (proxy raisonnable pour le MVP ;
    // une future itération pourra restreindre aux lots ayant été actifs durant la période).
    const [mortRes, lotsRes] = await Promise.all([
      supabase
        .from('health_records')
        .select('affected_count')
        .eq('type', 'mortalite')
        .gte('day', start)
        .lte('day', end)
        .is('deleted_at', null),
      supabase
        .from('lots')
        .select('initial_count')
        .is('deleted_at', null),
    ]);
    if (mortRes.error || lotsRes.error) return null;
    const mort = (mortRes.data ?? []).reduce((acc, r) => acc + r.affected_count, 0);
    const totalInitial = (lotsRes.data ?? []).reduce((acc, l) => acc + l.initial_count, 0);
    if (totalInitial === 0) return 0;
    return (mort / totalInitial) * 100;
  }
  // revenus / benefice : on agrège v_financial_summary sur le range de mois.
  // Le RLS + security_invoker des vues isole déjà la ferme.
  const startMonth = `${start.slice(0, 7)}-01`;
  const endMonth = `${end.slice(0, 7)}-01`;
  const { data, error } = await supabase
    .from('v_financial_summary')
    .select('revenus, benefice')
    .gte('mois', startMonth)
    .lte('mois', endMonth);
  if (error) return null;
  return (data ?? []).reduce((acc, r) => acc + ((metric === 'revenus' ? r.revenus : r.benefice) ?? 0), 0);
}

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; goal: Goal };

export function GoalsPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [actuals, setActuals] = useState<Map<string, number | null>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    setActuals(new Map());
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setGoals([]);
      return;
    }
    setGoals(data ?? []);

    // Calcule les valeurs actuelles en parallèle.
    const entries = await Promise.all(
      (data ?? []).map(async (g) => {
        const bounds = periodBoundsForGoal(g);
        if (!bounds || !(SUPPORTED_METRICS as readonly string[]).includes(g.metric)) {
          return [g.id, null] as const;
        }
        const val = await fetchMetricActual(g.metric as SupportedMetric, bounds.start, bounds.end);
        return [g.id, val] as const;
      }),
    );
    setActuals(new Map(entries));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {goals === null
            ? 'Chargement…'
            : `${goals.length} objectif${goals.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nouvel objectif
          </button>
        )}
      </div>

      {form.mode !== 'closed' && (
        <GoalForm
          orgId={orgId}
          initial={form.mode === 'edit' ? form.goal : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les objectifs : {loadError}
        </div>
      )}

      {goals === null ? (
        <Skeleton />
      ) : goals.length === 0 ? (
        <EmptyState onCreate={() => setForm({ mode: 'create' })} />
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              actual={actuals.get(g.id) ?? null}
              loadingActual={!actuals.has(g.id)}
              onEdit={() => setForm({ mode: 'edit', goal: g })}
              onArchived={() => void refresh()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Carte d'objectif avec progression ───────────────────────

function GoalCard({
  goal,
  actual,
  loadingActual,
  onEdit,
  onArchived,
}: {
  goal: Goal;
  actual: number | null;
  loadingActual: boolean;
  onEdit: () => void;
  onArchived: () => void;
}) {
  const bounds = periodBoundsForGoal(goal);
  const isSupportedMetric = (SUPPORTED_METRICS as readonly string[]).includes(goal.metric);
  const isSupportedPeriod = bounds !== null;
  const supported = isSupportedMetric && isSupportedPeriod;

  const metricLabel = isSupportedMetric
    ? METRIC_LABEL[goal.metric as SupportedMetric]
    : goal.metric;
  const periodLabel = goal.period
    ? PERIOD_LABEL[goal.period as SupportedPeriod] ?? goal.period
    : '—';

  return (
    <li className="rounded-2xl bg-white border border-neutral-200 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4 pb-2">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
            <Target className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{metricLabel}</div>
            <div className="text-xs text-neutral-500 truncate">
              Cible{isSupportedMetric && INVERTED_METRICS.includes(goal.metric as SupportedMetric) ? ' MAX' : ''} :{' '}
              {formatValue(
                isSupportedMetric ? (goal.metric as SupportedMetric) : 'revenus',
                Number(goal.target_value),
              )}{' '}
              · {periodLabel}
              {bounds && (
                <>
                  {' '}
                  · du {bounds.start} au {bounds.end}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100"
            aria-label="Éditer"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <ArchiveGoal goal={goal} onArchived={onArchived} />
        </div>
      </div>

      <div className="px-4 pb-4">
        {!supported ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {!isSupportedMetric
              ? 'Cette métrique sera mesurable quand son module sera livré (santé, incubation…).'
              : 'Période non supportée pour l\u2019instant (seul le mensuel est calculé).'}
          </p>
        ) : loadingActual ? (
          <div className="h-12 bg-neutral-100 rounded-md animate-pulse" />
        ) : actual === null ? (
          <p className="text-sm text-red-700">Impossible de calculer la progression.</p>
        ) : (
          <Progression
            metric={goal.metric as SupportedMetric}
            target={Number(goal.target_value)}
            actual={actual}
            start={bounds.start}
            end={bounds.end}
          />
        )}
      </div>
    </li>
  );
}

// ─── Progression : barre + statut + projection ───────────────

function Progression({
  metric,
  target,
  actual,
  start,
  end,
}: {
  metric: SupportedMetric;
  target: number;
  actual: number;
  start: string;
  end: string;
}) {
  const totalDays = daysBetween(start, end) + 1;
  const today = new Date();
  const todayIsoDate = today.toISOString().slice(0, 10);
  const isPast = todayIsoDate > end;
  const isFuture = todayIsoDate < start;

  // Jours écoulés sur la période : 0 avant le début, totalDays après la fin.
  const elapsed = isFuture
    ? 0
    : isPast
      ? totalDays
      : daysBetween(start, todayIsoDate) + 1;

  const progressPct = target === 0 ? 0 : (actual / target) * 100;
  const expectedPct = (elapsed / totalDays) * 100;
  const isInverted = INVERTED_METRICS.includes(metric);

  // Statut.
  // - Métrique normale (cible à atteindre) : >100 % atteint ; ≥ attendu en bonne voie ; ...
  // - Métrique inversée (cible MAX à ne pas dépasser) : ≤ cible OK ; entre 80–100 % à risque ; >100 % dépassé.
  let status: 'achieved' | 'on_track' | 'at_risk' | 'behind';
  if (isInverted) {
    if (progressPct > 100) status = 'behind'; // au-dessus du max → dépassé
    else if (progressPct > 80) status = 'at_risk'; // proche du max
    else status = 'on_track'; // bien sous le max
  } else {
    if (progressPct >= 100) status = 'achieved';
    else if (isFuture) status = 'on_track';
    else if (progressPct >= expectedPct) status = 'on_track';
    else if (progressPct >= expectedPct - 15) status = 'at_risk';
    else status = 'behind';
  }

  const FORWARD_PALETTE = {
    achieved: { bar: 'bg-emerald-500', label: 'Atteint', text: 'text-emerald-700', icon: CheckCircle2 },
    on_track: { bar: 'bg-emerald-500', label: 'En bonne voie', text: 'text-emerald-700', icon: CheckCircle2 },
    at_risk: { bar: 'bg-amber-500', label: 'À risque', text: 'text-amber-700', icon: AlertTriangle },
    behind: { bar: 'bg-red-500', label: 'En retard', text: 'text-red-700', icon: TrendingDown },
  } as const;
  const INVERTED_PALETTE = {
    achieved: FORWARD_PALETTE.on_track, // jamais utilisé pour les inversées
    on_track: { bar: 'bg-emerald-500', label: 'Sous le seuil', text: 'text-emerald-700', icon: CheckCircle2 },
    at_risk: { bar: 'bg-amber-500', label: 'Proche du seuil', text: 'text-amber-700', icon: AlertTriangle },
    behind: { bar: 'bg-red-500', label: 'Seuil dépassé', text: 'text-red-700', icon: TrendingDown },
  } as const;
  const palette = (isInverted ? INVERTED_PALETTE : FORWARD_PALETTE)[status];
  const StatusIcon = palette.icon;

  // Projection linéaire : valeur extrapolée à la fin de la période au rythme actuel.
  // Pertinente seulement si la métrique est un flux régulier (cf. SUPPORTS_LINEAR_PROJECTION)
  // ET si la période est en cours avec au moins 1 jour écoulé.
  const supportsProjection = SUPPORTS_LINEAR_PROJECTION[metric];
  const periodInProgress = !isPast && !isFuture && elapsed >= 1;
  const showProjection = supportsProjection && periodInProgress;
  const projection = showProjection ? (actual / elapsed) * totalDays : null;

  const fillPct = Math.max(0, Math.min(100, progressPct));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-xs text-neutral-500">Réalisé</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatValue(metric, actual)}
            <span className="text-sm font-normal text-neutral-400">
              {' '}
              / {formatValue(metric, target)}
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium ${palette.text}`}>
          <StatusIcon className="h-4 w-4" />
          {palette.label} · {progressPct.toFixed(0)} %
        </div>
      </div>

      <div className="relative h-2.5 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${palette.bar} transition-[width] duration-500`}
          style={{ width: `${fillPct}%` }}
        />
        {!isPast && !isFuture && (
          <div
            className="absolute top-0 bottom-0 w-px bg-neutral-500/50"
            style={{ left: `${Math.min(100, expectedPct)}%` }}
            aria-hidden
            title="Progression attendue"
          />
        )}
      </div>

      {showProjection && projection !== null && (
        <p className="text-xs text-neutral-500">
          Au rythme actuel : estimé à <span className="font-medium text-neutral-700">{formatValue(metric, Math.round(projection))}</span>{' '}
          en fin de période ({elapsed}/{totalDays} j). <span className="italic">Estimation linéaire.</span>
        </p>
      )}
      {!supportsProjection && periodInProgress && (
        <p className="text-xs text-neutral-500 italic">
          Projection non affichée : trop sensible aux mouvements ponctuels
          (gros achat, vente importante…) qui faussent une extrapolation
          linéaire en début de période.
        </p>
      )}
      {isPast && (
        <p className="text-xs text-neutral-500">Période terminée — pas de projection.</p>
      )}
      {isFuture && (
        <p className="text-xs text-neutral-500">Période à venir — pas encore de réalisé.</p>
      )}
    </div>
  );
}

function daysBetween(startIso: string, endIso: string): number {
  const a = new Date(`${startIso}T00:00:00`);
  const b = new Date(`${endIso}T00:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

// ─── Formulaire de création / édition ────────────────────────

function GoalForm({
  orgId,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  initial: Goal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;
  const initialMetric =
    initial && (SUPPORTED_METRICS as readonly string[]).includes(initial.metric)
      ? (initial.metric as SupportedMetric)
      : 'production_oeufs';

  const [metric, setMetric] = useState<SupportedMetric>(initialMetric);
  const [target, setTarget] = useState(String(initial?.target_value ?? 0));
  const [period, setPeriod] = useState<SupportedPeriod>(
    (initial?.period as SupportedPeriod) === 'mensuel' || !initial?.period
      ? 'mensuel'
      : 'mensuel',
  );
  const [startDate, setStartDate] = useState(initial?.start_date ?? '');
  const [endDate, setEndDate] = useState(initial?.end_date ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const targetNum = Number.parseFloat(target.replace(',', '.'));
    if (!Number.isFinite(targetNum)) {
      setError('La cible doit être un nombre.');
      return;
    }
    setBusy(true);
    const payload = {
      metric,
      target_value: targetNum,
      period,
      start_date: startDate === '' ? null : startDate,
      end_date: endDate === '' ? null : endDate,
    };
    const { error: dbError } = initial
      ? await supabase.from('goals').update(payload).eq('id', initial.id)
      : await supabase.from('goals').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', isEdit ? 'Objectif mis à jour.' : 'Objectif fixé.');
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? 'Modifier l\u2019objectif' : 'Nouvel objectif'}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-800 p-1 rounded-md hover:bg-neutral-100"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">Métrique</span>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as SupportedMetric)}
          className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <optgroup label="Disponibles">
            {SUPPORTED_METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABEL[m]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Bientôt disponibles">
            {FUTURE_METRICS.map((m) => (
              <option key={m.key} value={m.key} disabled>
                {m.label} — bientôt
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Cible{INVERTED_METRICS.includes(metric) ? ' MAX' : ''}{' '}
            {METRIC_UNIT[metric] === 'xof' ? '(FCFA)' : METRIC_UNIT[metric] === 'percent' ? '(%)' : ''}
          </span>
          <input
            type="text"
            required
            inputMode={METRIC_UNIT[metric] === 'xof' ? 'numeric' : 'decimal'}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Période</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as SupportedPeriod)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="mensuel">Mensuel</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Début <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Fin <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
      </div>
      <p className="text-xs text-neutral-500 -mt-1">
        Sans dates précisées, la période courante (mois en cours) est utilisée.
      </p>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded-lg text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy}
          className="bg-brand text-brand-fg rounded-lg px-4 py-1.5 text-sm font-medium hover:opacity-95 disabled:opacity-60 flex items-center gap-2"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? 'Mettre à jour' : 'Fixer l\u2019objectif'}
        </button>
      </div>
    </form>
  );
}

// ─── Archivage ───────────────────────────────────────────────

function ArchiveGoal({ goal, onArchived }: { goal: Goal; onArchived: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('goals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', goal.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Objectif archivé.');
    setOpen(false);
    onArchived();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-700 hover:text-red-900 px-2 py-1.5 rounded-md hover:bg-red-50"
        aria-label="Archiver"
      >
        <Archive className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        title="Archiver cet objectif ?"
        message="Il n'apparaîtra plus dans la liste mais reste dans l'historique en base."
        confirmLabel="Archiver"
        busy={busy}
        onConfirm={() => void archive()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function Skeleton() {
  return (
    <ul className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <li key={i} className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-2">
          <div className="h-3 w-1/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-2 w-1/2 bg-neutral-100 rounded animate-pulse" />
          <div className="h-2.5 w-full bg-neutral-100 rounded animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <Target className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Pas d'objectif</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          Fixez un premier objectif (production, revenus, bénéfice) pour suivre votre
          progression mois après mois.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" />
        Nouvel objectif
      </button>
    </div>
  );
}
