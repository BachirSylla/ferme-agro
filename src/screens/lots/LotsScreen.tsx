import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Pencil, Archive, X, Layers3, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { Enums, Tables } from '@/types/db';

type Lot = Tables<'lots'>;
type Species = Tables<'species'>;
type LotStatus = Enums<'lot_status'>;

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; lot: Lot };

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

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LotsScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [lots, setLots] = useState<Lot[] | null>(null);
  const [speciesById, setSpeciesById] = useState<Map<string, Species>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [lotsRes, spRes] = await Promise.all([
      supabase
        .from('lots')
        .select('*')
        .is('deleted_at', null)
        .order('start_date', { ascending: false })
        .order('code', { ascending: true }),
      supabase
        .from('species')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
    ]);
    if (lotsRes.error || spRes.error) {
      setLoadError(lotsRes.error?.message ?? spRes.error?.message ?? 'erreur');
      setLots([]);
      return;
    }
    setLots(lotsRes.data);
    setSpeciesById(new Map(spRes.data.map((s) => [s.id, s])));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const speciesList = useMemo(() => Array.from(speciesById.values()), [speciesById]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lots</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          L'unité opérationnelle de l'élevage. Chaque lot appartient à une espèce.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {lots === null
            ? 'Chargement…'
            : `${lots.length} lot${lots.length > 1 ? 's' : ''} actif${lots.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            disabled={speciesList.length === 0}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Nouveau lot
          </button>
        )}
      </div>

      {speciesList.length === 0 && lots !== null && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Créez d'abord une espèce dans le <strong>Catalogue</strong> : un lot doit obligatoirement
            être rattaché à une espèce.
          </span>
        </div>
      )}

      {form.mode !== 'closed' && (
        <LotForm
          orgId={orgId}
          species={speciesList}
          initial={form.mode === 'edit' ? form.lot : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les lots : {loadError}
        </div>
      )}

      {lots === null ? (
        <ListSkeleton />
      ) : lots.length === 0 ? (
        <EmptyState
          disabled={speciesList.length === 0}
          onCreate={() => setForm({ mode: 'create' })}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
          {lots.map((l) => {
            const sp = speciesById.get(l.species_id);
            return (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                    <Layers3 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{l.code}</span>
                      <StatusBadge status={l.status} />
                    </div>
                    <div className="text-xs text-neutral-500 truncate flex items-center gap-1 flex-wrap mt-0.5">
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5">
                        {sp?.name ?? 'Espèce inconnue'}
                      </span>
                      <span>·</span>
                      <span className="font-medium text-neutral-700">
                        {l.current_count}
                        <span className="text-neutral-400"> / {l.initial_count}</span>
                      </span>
                      <span>·</span>
                      <span>{dateFmt.format(new Date(l.start_date))}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setForm({ mode: 'edit', lot: l })}
                    className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100 flex items-center gap-1"
                    aria-label={`Éditer ${l.code}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <ArchiveLot lot={l} onArchived={() => void refresh()} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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

function LotForm({
  orgId,
  species,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  species: Species[];
  initial: Lot | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;

  const [code, setCode] = useState(initial?.code ?? '');
  const [speciesId, setSpeciesId] = useState(initial?.species_id ?? species[0]?.id ?? '');
  const [startDate, setStartDate] = useState(initial?.start_date ?? todayIso());
  const [initialCount, setInitialCount] = useState(String(initial?.initial_count ?? 0));
  const [currentCount, setCurrentCount] = useState(String(initial?.current_count ?? 0));
  const [status, setStatus] = useState<LotStatus>(initial?.status ?? 'actif');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const initialNum = Number.parseInt(initialCount, 10);
    const currentNum = isEdit
      ? Number.parseInt(currentCount, 10)
      : initialNum; // à la création, current = initial
    if (Number.isNaN(initialNum) || initialNum < 0) {
      setError('L\u2019effectif initial doit être un entier positif.');
      setBusy(false);
      return;
    }
    if (isEdit && (Number.isNaN(currentNum) || currentNum < 0)) {
      setError('L\u2019effectif actuel doit être un entier positif.');
      setBusy(false);
      return;
    }
    if (!speciesId) {
      setError('L\u2019espèce est requise.');
      setBusy(false);
      return;
    }

    const trimmedCode = code.trim();
    const trimmedNotes = notes.trim();
    const payload = {
      code: trimmedCode,
      species_id: speciesId,
      start_date: startDate,
      initial_count: initialNum,
      current_count: currentNum,
      status,
      notes: trimmedNotes === '' ? null : trimmedNotes,
    };

    const { error: dbError } = initial
      ? await supabase.from('lots').update(payload).eq('id', initial.id)
      : await supabase.from('lots').insert({ ...payload, org_id: orgId });

    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', initial ? 'Lot mis à jour.' : `Lot « ${trimmedCode} » créé.`);
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{isEdit ? 'Modifier le lot' : 'Nouveau lot'}</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-800 p-1 rounded-md hover:bg-neutral-100"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Code</span>
          <input
            type="text"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="LOT-CAILLES-001"
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Espèce</span>
          <select
            required
            value={speciesId}
            onChange={(e) => setSpeciesId(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="" disabled>
              — Choisir une espèce
            </option>
            {species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Date de début</span>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Statut</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LotStatus)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="actif">Actif</option>
            <option value="vendu">Vendu</option>
            <option value="termine">Terminé</option>
          </select>
        </label>
      </div>

      <div className={isEdit ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Effectif initial</span>
          <input
            type="number"
            required
            min={0}
            step={1}
            inputMode="numeric"
            value={initialCount}
            onChange={(e) => setInitialCount(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          {!isEdit && (
            <span className="text-xs text-neutral-500">
              L'effectif actuel sera initialisé à cette valeur (éditable ensuite).
            </span>
          )}
        </label>
        {isEdit && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">Effectif actuel</span>
            <input
              type="number"
              required
              min={0}
              step={1}
              inputMode="numeric"
              value={currentCount}
              onChange={(e) => setCurrentCount(e.target.value)}
              className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">
          Notes <span className="text-neutral-400 font-normal">(facultatif)</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Origine, race, conditions particulières…"
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y"
        />
      </label>

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
          {isEdit ? 'Mettre à jour' : 'Créer'}
        </button>
      </div>
    </form>
  );
}

function ArchiveLot({ lot, onArchived }: { lot: Lot; onArchived: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('lots')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', lot.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', `Lot « ${lot.code} » archivé.`);
    setOpen(false);
    onArchived();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-700 hover:text-red-900 px-2 py-1.5 rounded-md hover:bg-red-50 flex items-center gap-1"
        aria-label={`Archiver ${lot.code}`}
      >
        <Archive className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        title={`Archiver « ${lot.code} » ?`}
        message="Il n'apparaîtra plus dans la liste active. La production, ventes et dépenses associées restent en base."
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
    <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 p-3">
          <div className="h-10 w-10 rounded-xl bg-neutral-200 animate-pulse" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 w-1/3 bg-neutral-200 rounded animate-pulse" />
            <div className="h-2 w-1/2 bg-neutral-100 rounded animate-pulse" />
          </div>
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
        <Layers3 className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucun lot</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          {disabled
            ? 'Créez d\u2019abord une espèce dans le Catalogue.'
            : 'Démarrez l\u2019élevage en créant votre premier lot (ex. 200 cailles arrivées aujourd\u2019hui).'}
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="h-4 w-4" />
        Créer un lot
      </button>
    </div>
  );
}
