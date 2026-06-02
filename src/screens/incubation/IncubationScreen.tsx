import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  Egg,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Hourglass,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { dateShortFmt, percentFmt, qtyFmt, todayIso } from '@/lib/format';
import type { Tables } from '@/types/db';

type Batch = Tables<'incubation_batches'>;
type Species = Tables<'species'>;
type Lot = Tables<'lots'>;

const STATUSES = ['en_cours', 'eclos', 'echoue'] as const;
type IncubStatus = (typeof STATUSES)[number];

const STATUS_LABEL: Record<IncubStatus, string> = {
  en_cours: 'En cours',
  eclos: 'Éclos',
  echoue: 'Échec',
};
const STATUS_CLASS: Record<IncubStatus, string> = {
  en_cours: 'bg-amber-100 text-amber-800 border-amber-200',
  eclos: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  echoue: 'bg-red-100 text-red-800 border-red-200',
};
const STATUS_ICON: Record<IncubStatus, React.ComponentType<{ className?: string }>> = {
  en_cours: Hourglass,
  eclos: CheckCircle2,
  echoue: XCircle,
};

// Récupère la durée d'incubation déclarée sur l'espèce (species.attributes JSONB).
// Renvoie null si la clé n'existe pas → l'UI bascule en saisie manuelle de la date.
function getIncubationDays(species: Species | null | undefined): number | null {
  const attrs = species?.attributes;
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
  const v = (attrs as Record<string, unknown>).duree_incubation_jours;
  return typeof v === 'number' && v > 0 ? v : null;
}

function addDaysIso(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Suggestion de code lot pour une éclosion : LOT-{ESPECE}-{YYYYMMDD}.
// L'utilisateur peut éditer.
function suggestLotCode(speciesName: string, hatchDate: string): string {
  const slug = speciesName
    .toLocaleUpperCase('fr')
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '');
  const dateCompact = hatchDate.replaceAll('-', '');
  return `LOT-${slug || 'COUVEE'}-${dateCompact}`;
}

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; batch: Batch }
  | { mode: 'hatch'; batch: Batch };

export function IncubationScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [species, setSpecies] = useState<Species[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [bRes, spRes, lotRes] = await Promise.all([
      supabase
        .from('incubation_batches')
        .select('*')
        .is('deleted_at', null)
        .order('set_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('species')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase.from('lots').select('*').is('deleted_at', null).order('code', { ascending: true }),
    ]);
    if (bRes.error || spRes.error || lotRes.error) {
      setLoadError(
        bRes.error?.message ?? spRes.error?.message ?? lotRes.error?.message ?? 'erreur',
      );
      setBatches([]);
      return;
    }
    setBatches(bRes.data ?? []);
    setSpecies(spRes.data ?? []);
    setLots(lotRes.data ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const speciesById = useMemo(() => new Map(species.map((s) => [s.id, s])), [species]);
  const lotsById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);

  // Retrouve la species liée à une couvée.
  // 1. Priorité absolue : species_id explicite sur la couvée (cas normal depuis 0006).
  // 2. Fallback historique : via source_lot pour les couvées anciennes sans species_id.
  function deriveSpecies(batch: Batch): Species | null {
    if (batch.species_id) {
      return speciesById.get(batch.species_id) ?? null;
    }
    if (batch.source_lot_id) {
      const sourceLot = lotsById.get(batch.source_lot_id);
      if (sourceLot) return speciesById.get(sourceLot.species_id) ?? null;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Incubation</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Couvées en cours, éclosions et création automatique du lot résultant.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {batches === null
            ? 'Chargement…'
            : `${batches.length} couvée${batches.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            disabled={species.length === 0}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Nouvelle couvée
          </button>
        )}
      </div>

      {species.length === 0 && batches !== null && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Créez d'abord une espèce dans le <strong>Catalogue</strong>. Pensez à
            renseigner sa durée d'incubation pour le calcul automatique de la date
            d'éclosion.
          </span>
        </div>
      )}

      {form.mode === 'create' || form.mode === 'edit' ? (
        <BatchForm
          orgId={orgId}
          species={species}
          speciesById={speciesById}
          lots={lots}
          lotsById={lotsById}
          initial={form.mode === 'edit' ? form.batch : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      ) : form.mode === 'hatch' ? (
        <HatchForm
          orgId={orgId}
          batch={form.batch}
          fallbackSpecies={deriveSpecies(form.batch)}
          allSpecies={species}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      ) : null}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les couvées : {loadError}
        </div>
      )}

      {batches === null ? (
        <ListSkeleton />
      ) : batches.length === 0 ? (
        <EmptyState
          disabled={species.length === 0}
          onCreate={() => setForm({ mode: 'create' })}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b) => (
            <BatchCard
              key={b.id}
              batch={b}
              species={deriveSpecies(b)}
              sourceLot={b.source_lot_id ? lotsById.get(b.source_lot_id) ?? null : null}
              resultLot={b.result_lot_id ? lotsById.get(b.result_lot_id) ?? null : null}
              onEdit={() => setForm({ mode: 'edit', batch: b })}
              onHatch={() => setForm({ mode: 'hatch', batch: b })}
              onArchived={() => void refresh()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Carte couvée ────────────────────────────────────────────

function BatchCard({
  batch,
  species,
  sourceLot,
  resultLot,
  onEdit,
  onHatch,
  onArchived,
}: {
  batch: Batch;
  species: Species | null;
  sourceLot: Lot | null;
  resultLot: Lot | null;
  onEdit: () => void;
  onHatch: () => void;
  onArchived: () => void;
}) {
  const status = (STATUSES as readonly string[]).includes(batch.status)
    ? (batch.status as IncubStatus)
    : 'en_cours';
  const StatusIcon = STATUS_ICON[status];

  // Calculs dérivés pour les couvées en cours.
  const todayDate = todayIso();
  const daysLeft = batch.expected_hatch ? daysDiff(todayDate, batch.expected_hatch) : null;
  const isOverdue = status === 'en_cours' && daysLeft !== null && daysLeft < 0;
  const isDueToday = status === 'en_cours' && daysLeft === 0;

  // Taux de réussite pour les couvées écloses (ou échouées).
  const successRate =
    status !== 'en_cours' && batch.eggs_count > 0
      ? ((batch.hatched_count ?? 0) / batch.eggs_count) * 100
      : null;

  return (
    <li className="rounded-2xl bg-white border border-neutral-200 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
            <Egg className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{species?.name ?? 'Espèce inconnue'}</span>
              <StatusBadge status={status} />
            </div>
            <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1 flex-wrap">
              <span>
                <strong className="text-neutral-700">{qtyFmt.format(batch.eggs_count)}</strong> œufs
              </span>
              <span>·</span>
              <span>mis le {dateShortFmt.format(new Date(batch.set_date))}</span>
              {sourceLot && (
                <>
                  <span>·</span>
                  <span className="rounded-md bg-neutral-100 px-1.5 py-0.5">
                    origine {sourceLot.code}
                  </span>
                </>
              )}
            </div>
            {status === 'en_cours' && batch.expected_hatch && (
              <CountdownBadge daysLeft={daysLeft!} expectedHatch={batch.expected_hatch} />
            )}
            {successRate !== null && (
              <div className="text-xs mt-1 flex items-center gap-1 flex-wrap">
                <span className="text-neutral-500">
                  Éclos :{' '}
                  <strong className="text-neutral-700">
                    {qtyFmt.format(batch.hatched_count ?? 0)} / {qtyFmt.format(batch.eggs_count)}
                  </strong>
                </span>
                <span>·</span>
                <span
                  className={
                    status === 'eclos'
                      ? 'text-emerald-700 font-medium'
                      : 'text-red-700 font-medium'
                  }
                >
                  {percentFmt.format(successRate)} % de réussite
                </span>
                {resultLot && (
                  <>
                    <span>·</span>
                    <span className="rounded-md bg-brand/10 text-brand px-1.5 py-0.5">
                      → lot {resultLot.code}
                    </span>
                  </>
                )}
              </div>
            )}
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
          <ArchiveBatch batch={batch} onArchived={onArchived} />
        </div>
      </div>

      {status === 'en_cours' && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={onHatch}
            className={
              'rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 shadow-sm ' +
              (isOverdue || isDueToday
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-brand text-brand-fg hover:opacity-95')
            }
          >
            <StatusIcon className="h-4 w-4" />
            Enregistrer l'éclosion
          </button>
        </div>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: IncubStatus }) {
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

function CountdownBadge({ daysLeft, expectedHatch }: { daysLeft: number; expectedHatch: string }) {
  let label: string;
  let className: string;
  let Icon = Hourglass;
  if (daysLeft > 0) {
    label = `J−${daysLeft} (prévu ${dateShortFmt.format(new Date(expectedHatch))})`;
    className = 'text-neutral-600';
  } else if (daysLeft === 0) {
    label = `Éclosion prévue aujourd'hui`;
    className = 'text-brand font-medium';
    Icon = AlertTriangle;
  } else {
    label = `${-daysLeft} jour${-daysLeft > 1 ? 's' : ''} de retard — à vérifier`;
    className = 'text-red-700 font-medium';
    Icon = AlertTriangle;
  }
  return (
    <div className={`text-xs mt-1 flex items-center gap-1 ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

// ─── Formulaire création / édition ──────────────────────────

function BatchForm({
  orgId,
  species,
  speciesById,
  lots,
  lotsById,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  species: Species[];
  speciesById: Map<string, Species>;
  lots: Lot[];
  lotsById: Map<string, Lot>;
  initial: Batch | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;

  // Espèce initiale : species_id explicite en priorité, sinon fallback via
  // source_lot_id (pour les couvées créées avant la migration 0006).
  const initialSpeciesFallback = initial?.source_lot_id
    ? speciesById.get(lotsById.get(initial.source_lot_id)?.species_id ?? '')
    : null;
  const initialSpeciesId =
    initial?.species_id ?? initialSpeciesFallback?.id ?? species[0]?.id ?? '';

  const [speciesId, setSpeciesId] = useState<string>(initialSpeciesId);
  const [sourceLotId, setSourceLotId] = useState<string>(initial?.source_lot_id ?? '');
  const [setDate, setSetDate] = useState(initial?.set_date ?? todayIso());
  const [eggsCount, setEggsCount] = useState(String(initial?.eggs_count ?? ''));
  const [expectedHatch, setExpectedHatch] = useState<string>(initial?.expected_hatch ?? '');
  const [expectedEdited, setExpectedEdited] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Calcule la date d'éclosion prévue automatiquement quand set_date ou
  // species change, sauf si l'utilisateur a déjà saisi une valeur manuelle.
  const selectedSpecies = speciesId ? speciesById.get(speciesId) ?? null : null;
  const incubDays = getIncubationDays(selectedSpecies);

  useEffect(() => {
    if (expectedEdited) return;
    if (!setDate || !incubDays) return;
    setExpectedHatch(addDaysIso(setDate, incubDays));
  }, [setDate, incubDays, expectedEdited]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const eggs = Number.parseInt(eggsCount, 10);
    if (!Number.isFinite(eggs) || eggs <= 0) {
      setError('Le nombre d\u2019œufs doit être un entier positif.');
      return;
    }
    if (!speciesId) {
      setError('Choisissez une espèce.');
      return;
    }
    if (!expectedHatch) {
      setError(
        "Renseignez la date d'éclosion prévue (l'espèce n'a pas de durée d'incubation déclarée).",
      );
      return;
    }
    setBusy(true);
    // species_id désormais persisté explicitement (0006), avec ou sans source_lot.
    const payload = {
      species_id: speciesId,
      source_lot_id: sourceLotId === '' ? null : sourceLotId,
      set_date: setDate,
      expected_hatch: expectedHatch,
      eggs_count: eggs,
    };
    const { error: dbError } = initial
      ? await supabase.from('incubation_batches').update(payload).eq('id', initial.id)
      : await supabase
          .from('incubation_batches')
          .insert({ ...payload, org_id: orgId, status: 'en_cours' });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', isEdit ? 'Couvée mise à jour.' : 'Couvée enregistrée.');
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <FormHeader title={isEdit ? 'Modifier la couvée' : 'Nouvelle couvée'} onClose={onClose} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Espèce</span>
          <select
            required
            value={speciesId}
            onChange={(e) => {
              setSpeciesId(e.target.value);
              setExpectedEdited(false); // déclenche le recalcul auto
            }}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="" disabled>
              — Choisir une espèce
            </option>
            {species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {getIncubationDays(s) ? ` (${getIncubationDays(s)} j)` : ''}
              </option>
            ))}
          </select>
          {selectedSpecies && !incubDays && (
            <span className="text-xs text-amber-700">
              Pas de durée d'incubation déclarée pour {selectedSpecies.name}. Renseignez-la
              dans le Catalogue, ou saisissez la date d'éclosion à la main ci-dessous.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Lot d'origine <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <select
            value={sourceLotId}
            onChange={(e) => {
              const value = e.target.value;
              setSourceLotId(value);
              // Si on choisit un lot, on aligne l'espèce sur celle du lot.
              if (value) {
                const lot = lotsById.get(value);
                if (lot) {
                  setSpeciesId(lot.species_id);
                  setExpectedEdited(false);
                }
              }
            }}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="">— Aucun (œufs externes)</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Date de mise</span>
          <input
            type="date"
            required
            value={setDate}
            onChange={(e) => {
              setSetDate(e.target.value);
              setExpectedEdited(false);
            }}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Nombre d'œufs</span>
          <input
            type="number"
            required
            min={1}
            step={1}
            inputMode="numeric"
            value={eggsCount}
            onChange={(e) => setEggsCount(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Éclosion prévue
            {incubDays && !expectedEdited && (
              <span className="text-neutral-400 font-normal"> (auto +{incubDays} j)</span>
            )}
          </span>
          <input
            type="date"
            required
            value={expectedHatch}
            onChange={(e) => {
              setExpectedHatch(e.target.value);
              setExpectedEdited(true);
            }}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
      </div>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <FormButtons busy={busy} isEdit={isEdit} onClose={onClose} createLabel="Enregistrer la couvée" />
    </form>
  );
}

// ─── Formulaire éclosion (et création de lot optionnelle) ────

function HatchForm({
  orgId,
  batch,
  fallbackSpecies,
  allSpecies,
  onClose,
  onSaved,
}: {
  orgId: string;
  batch: Batch;
  fallbackSpecies: Species | null; // dérivé du source_lot s'il existe
  allSpecies: Species[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [hatchedCount, setHatchedCount] = useState(String(batch.eggs_count));
  const [hatchDate, setHatchDate] = useState(todayIso());
  const [outcome, setOutcome] = useState<'eclos' | 'echoue'>('eclos');
  const [createLot, setCreateLot] = useState(true);
  // Si la couvée n'a pas de species déductible, l'utilisateur la choisit ici.
  const [speciesId, setSpeciesId] = useState<string>(
    fallbackSpecies?.id ?? allSpecies[0]?.id ?? '',
  );
  const [lotCode, setLotCode] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pré-rempli le code lot dès qu'on connaît espèce + date d'éclosion.
  useEffect(() => {
    const sp = allSpecies.find((s) => s.id === speciesId);
    if (sp) setLotCode((prev) => (prev === '' ? suggestLotCode(sp.name, hatchDate) : prev));
  }, [speciesId, hatchDate, allSpecies]);

  const hatched = Number.parseInt(hatchedCount, 10);
  const willCreateLot = outcome === 'eclos' && createLot && Number.isFinite(hatched) && hatched > 0;
  const successRate = batch.eggs_count > 0 ? (hatched / batch.eggs_count) * 100 : 0;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(hatched) || hatched < 0) {
      setError('Le nombre d\u2019éclos doit être un entier positif.');
      return;
    }
    if (hatched > batch.eggs_count) {
      setError(`Pas plus que ${batch.eggs_count} œufs dans la couvée.`);
      return;
    }
    if (willCreateLot && !speciesId) {
      setError('Choisissez l\u2019espèce pour le nouveau lot.');
      return;
    }
    if (willCreateLot && lotCode.trim() === '') {
      setError('Le code du nouveau lot est requis.');
      return;
    }

    setBusy(true);

    // Étape 1 : créer le lot d'éclosion si demandé. On le fait en premier pour
    // pouvoir le rattacher (result_lot_id) ; si la création du lot échoue, la
    // couvée n'est pas modifiée.
    let resultLotId: string | null = null;
    if (willCreateLot) {
      const { data: newLot, error: lotErr } = await supabase
        .from('lots')
        .insert({
          org_id: orgId,
          species_id: speciesId,
          code: lotCode.trim(),
          start_date: hatchDate,
          initial_count: hatched,
          current_count: hatched,
          status: 'actif',
          notes: `Issu de la couvée ${batch.id.slice(0, 8)} (éclosion ${hatchDate})`,
        })
        .select()
        .single();
      if (lotErr || !newLot) {
        setBusy(false);
        setError(`Échec de la création du lot : ${lotErr?.message ?? 'inconnue'}`);
        return;
      }
      resultLotId = newLot.id;
    }

    // Étape 2 : mettre à jour la couvée (hatched_count, status, result_lot_id).
    const { error: updErr } = await supabase
      .from('incubation_batches')
      .update({
        hatched_count: hatched,
        status: outcome,
        result_lot_id: resultLotId,
      })
      .eq('id', batch.id);

    if (updErr) {
      // Rollback : on archive le lot créé pour ne pas laisser d'orphelin.
      if (resultLotId) {
        await supabase
          .from('lots')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', resultLotId);
      }
      setBusy(false);
      setError(updErr.message);
      return;
    }

    setBusy(false);
    if (willCreateLot) {
      toast.push(
        'success',
        `Éclosion : ${hatched}/${batch.eggs_count} (${percentFmt.format(successRate)} %). Lot « ${lotCode} » créé.`,
      );
    } else {
      toast.push(
        'success',
        `Éclosion enregistrée (${hatched}/${batch.eggs_count}, ${percentFmt.format(successRate)} %).`,
      );
    }
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <FormHeader
        title="Enregistrer l'éclosion"
        subtitle={`Couvée de ${qtyFmt.format(batch.eggs_count)} œufs · mise le ${dateShortFmt.format(new Date(batch.set_date))}`}
        onClose={onClose}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Date d'éclosion</span>
          <input
            type="date"
            required
            value={hatchDate}
            onChange={(e) => setHatchDate(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Issue</span>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as 'eclos' | 'echoue')}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="eclos">Éclosion réussie</option>
            <option value="echoue">Échec / abandon</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Œufs éclos <span className="text-neutral-400 font-normal">/ {qtyFmt.format(batch.eggs_count)}</span>
          </span>
          <input
            type="number"
            required
            min={0}
            max={batch.eggs_count}
            step={1}
            inputMode="numeric"
            value={hatchedCount}
            onChange={(e) => setHatchedCount(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
      </div>

      {Number.isFinite(hatched) && (
        <div className="text-xs text-neutral-600">
          Taux de réussite : <strong>{percentFmt.format(successRate)} %</strong>
        </div>
      )}

      {outcome === 'eclos' && hatched > 0 && (
        <div className="rounded-xl bg-brand/5 border border-brand/20 p-3 flex flex-col gap-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createLot}
              onChange={(e) => setCreateLot(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              Créer un <strong>nouveau lot</strong> avec les {hatched} éclos
            </span>
          </label>
          {createLot && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-neutral-700">Espèce du nouveau lot</span>
                <select
                  value={speciesId}
                  onChange={(e) => setSpeciesId(e.target.value)}
                  disabled={fallbackSpecies !== null}
                  className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand disabled:bg-neutral-50"
                >
                  {allSpecies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-neutral-700">Code du lot</span>
                <input
                  type="text"
                  required={createLot}
                  value={lotCode}
                  onChange={(e) => setLotCode(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
              </label>
            </div>
          )}
          <p className="text-xs text-neutral-500 italic pl-6">
            Les œufs non éclos ne créent <strong>aucune mortalité</strong> de lot — ils
            réduisent seulement le taux de réussite de la couvée.
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <FormButtons busy={busy} isEdit={false} onClose={onClose} createLabel="Enregistrer l'éclosion" />
    </form>
  );
}

// ─── Sous-composants partagés ───────────────────────────────

function FormHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="font-semibold truncate">{title}</h3>
        {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-neutral-500 hover:text-neutral-800 p-1 rounded-md hover:bg-neutral-100"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function FormButtons({
  busy,
  isEdit,
  onClose,
  createLabel,
}: {
  busy: boolean;
  isEdit: boolean;
  onClose: () => void;
  createLabel: string;
}) {
  return (
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
        {isEdit ? 'Mettre à jour' : createLabel}
      </button>
    </div>
  );
}

function ArchiveBatch({ batch, onArchived }: { batch: Batch; onArchived: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('incubation_batches')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', batch.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Couvée archivée.');
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
        title="Archiver cette couvée ?"
        message={
          batch.result_lot_id
            ? "Le lot d'éclosion associé reste actif. La couvée disparaîtra de la liste."
            : "Elle disparaîtra de la liste mais reste dans l'historique en base."
        }
        confirmLabel="Archiver"
        busy={busy}
        onConfirm={() => void archive()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <li key={i} className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-2">
          <div className="h-3 w-1/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-2 w-1/2 bg-neutral-100 rounded animate-pulse" />
          <div className="h-2 w-1/3 bg-neutral-100 rounded animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <Egg className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucune couvée</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          {disabled
            ? 'Créez d\u2019abord une espèce dans le Catalogue.'
            : 'Lancez votre première couvée : espèce, date de mise, nombre d\u2019œufs. La date d\u2019éclosion est calculée automatiquement.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="h-4 w-4" />
        Nouvelle couvée
      </button>
    </div>
  );
}
