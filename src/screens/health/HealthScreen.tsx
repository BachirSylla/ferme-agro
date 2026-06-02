import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  HeartPulse,
  Syringe,
  Pill,
  Skull,
  Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { dateShortFmt, qtyFmt, todayIso, xofFmt } from '@/lib/format';
import type { Enums, Tables } from '@/types/db';

type HealthRecord = Tables<'health_records'>;
type Lot = Tables<'lots'>;
type HealthType = Enums<'health_type'>;

const TYPE_LABEL: Record<HealthType, string> = {
  maladie: 'Maladie',
  traitement: 'Traitement',
  vaccin: 'Vaccin',
  mortalite: 'Mortalité',
};

const TYPE_CLASS: Record<HealthType, string> = {
  maladie: 'bg-red-100 text-red-800 border-red-200',
  traitement: 'bg-sky-100 text-sky-800 border-sky-200',
  vaccin: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  mortalite: 'bg-neutral-200 text-neutral-800 border-neutral-300',
};

const TYPE_ICON: Record<HealthType, React.ComponentType<{ className?: string }>> = {
  maladie: HeartPulse,
  traitement: Pill,
  vaccin: Syringe,
  mortalite: Skull,
};

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; record: HealthRecord };

export function HealthScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [records, setRecords] = useState<HealthRecord[] | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotFilter, setLotFilter] = useState<string>('all');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [recRes, lotRes] = await Promise.all([
      supabase
        .from('health_records')
        .select('*')
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false }),
      // Tous les lots non archivés (y compris vendu/termine) pour pouvoir lire
      // l'historique. Le formulaire restreindra à status='actif'.
      supabase
        .from('lots')
        .select('*')
        .is('deleted_at', null)
        .order('code', { ascending: true }),
    ]);
    if (recRes.error || lotRes.error) {
      setLoadError(recRes.error?.message ?? lotRes.error?.message ?? 'erreur');
      setRecords([]);
      return;
    }
    setRecords(recRes.data ?? []);
    setLots(lotRes.data ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lotsById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);
  const activeLots = useMemo(() => lots.filter((l) => l.status === 'actif'), [lots]);

  const filteredRecords = useMemo(() => {
    if (!records) return null;
    if (lotFilter === 'all') return records;
    return records.filter((r) => r.lot_id === lotFilter);
  }, [records, lotFilter]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Santé</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Maladies, traitements, vaccins, mortalités — par lot.
        </p>
      </div>

      <CashRuleBanner />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <label className="flex flex-col gap-1 sm:max-w-xs flex-1">
          <span className="text-xs font-medium text-neutral-700">Filtrer par lot</span>
          <select
            value={lotFilter}
            onChange={(e) => setLotFilter(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="all">Tous les lots</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} {l.status !== 'actif' ? `(${l.status})` : ''}
              </option>
            ))}
          </select>
        </label>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            disabled={activeLots.length === 0}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5 self-start sm:self-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            Nouvel enregistrement
          </button>
        )}
      </div>

      {activeLots.length === 0 && records !== null && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Aucun lot actif. Créez ou réactivez un lot pour pouvoir saisir un
            enregistrement santé.
          </span>
        </div>
      )}

      {form.mode !== 'closed' && (
        <HealthForm
          orgId={orgId}
          lots={activeLots}
          initial={form.mode === 'edit' ? form.record : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les enregistrements : {loadError}
        </div>
      )}

      {filteredRecords === null ? (
        <ListSkeleton />
      ) : filteredRecords.length === 0 ? (
        <EmptyState
          hasLots={activeLots.length > 0}
          onCreate={() => setForm({ mode: 'create' })}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
          {filteredRecords.map((r) => {
            const lot = lotsById.get(r.lot_id);
            const Icon = TYPE_ICON[r.type];
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeBadge type={r.type} />
                      <span className="text-sm font-medium truncate">
                        {lot?.code ?? 'Lot inconnu'}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1 flex-wrap">
                      <span>{dateShortFmt.format(new Date(r.day))}</span>
                      {r.affected_count > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            {qtyFmt.format(r.affected_count)} animau{r.affected_count > 1 ? 'x' : ''} touché{r.affected_count > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                      {r.cost > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-neutral-700">
                            {xofFmt.format(r.cost)} FCFA
                          </span>
                        </>
                      )}
                    </div>
                    {r.description && (
                      <div className="text-xs text-neutral-600 mt-0.5 truncate italic">
                        « {r.description} »
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setForm({ mode: 'edit', record: r })}
                    className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100"
                    aria-label="Éditer"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <ArchiveRecord record={r} onArchived={() => void refresh()} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Bannière règle anti double-comptage ─────────────────────

function CashRuleBanner() {
  return (
    <div className="text-xs bg-sky-50 border border-sky-200 text-sky-900 rounded-xl px-3 py-2 flex items-start gap-2">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <strong>Santé vs Cash :</strong> le <em>coût</em> ici alimente le coût du
        lot (rapport analytique), pas le bénéfice mensuel. Pour le cash sortant
        (vétérinaire payé, vaccin acheté), saisissez une <strong>dépense</strong>{' '}
        dans Finances ou un <strong>achat</strong> dans Stocks. Une mortalité
        diminue automatiquement l'effectif du lot.
      </div>
    </div>
  );
}

// ─── Form santé ─────────────────────────────────────────────

function HealthForm({
  orgId,
  lots,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  lots: Lot[];
  initial: HealthRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;
  const [lotId, setLotId] = useState(initial?.lot_id ?? lots[0]?.id ?? '');
  const [type, setType] = useState<HealthType>(initial?.type ?? 'vaccin');
  const [day, setDay] = useState(initial?.day ?? todayIso());
  const [affected, setAffected] = useState(String(initial?.affected_count ?? 0));
  const [cost, setCost] = useState(String(initial?.cost ?? 0));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!lotId) {
      setError('Sélectionnez un lot.');
      return;
    }
    const aff = Number.parseFloat(affected.replace(',', '.'));
    const cst = Number.parseInt(cost, 10);
    if (!Number.isFinite(aff) || aff < 0) {
      setError('L\u2019effectif touché doit être un nombre positif.');
      return;
    }
    if (!Number.isFinite(cst) || cst < 0) {
      setError('Le coût doit être un entier positif (FCFA).');
      return;
    }
    setBusy(true);
    const payload = {
      lot_id: lotId,
      day,
      type,
      description: description.trim() === '' ? null : description.trim(),
      affected_count: aff,
      cost: cst,
    };
    const { error: dbError } = initial
      ? await supabase.from('health_records').update(payload).eq('id', initial.id)
      : await supabase.from('health_records').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', isEdit ? 'Enregistrement mis à jour.' : 'Enregistrement enregistré.');
    onSaved();
  }

  const showsEffectifHint = type === 'mortalite';
  const showsCostHint = type === 'vaccin' || type === 'traitement';

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          {isEdit ? 'Modifier l\u2019enregistrement' : 'Nouvel enregistrement'}
        </h3>
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
          <span className="text-sm font-medium text-neutral-700">Lot</span>
          <select
            required
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            {lots.length === 0 && <option value="">— Aucun lot actif</option>}
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as HealthType)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="vaccin">Vaccin</option>
            <option value="traitement">Traitement</option>
            <option value="maladie">Maladie</option>
            <option value="mortalite">Mortalité</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Date</span>
          <input
            type="date"
            required
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Effectif touché</span>
          <input
            type="text"
            required
            inputMode="numeric"
            pattern="[0-9]+"
            value={affected}
            onChange={(e) => setAffected(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Coût</span>
          <div className="relative">
            <input
              type="number"
              required
              min={0}
              step={1}
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 pr-14 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 font-medium">
              FCFA
            </span>
          </div>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">
          Description <span className="text-neutral-400 font-normal">(facultatif)</span>
        </span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Symptômes, produit utilisé, dosage…"
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y"
        />
      </label>

      {showsEffectifHint && (
        <div className="text-xs bg-neutral-100 text-neutral-700 rounded-lg px-3 py-2">
          ☠ L'<strong>effectif actuel</strong> du lot baissera automatiquement de
          l'effectif touché saisi ici (calculé à chaque affichage).
        </div>
      )}
      {showsCostHint && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          💉 Ce coût alimente le coût analytique du lot, <strong>pas</strong> le
          bénéfice mensuel. Pour enregistrer le cash sortant, saisissez aussi une
          dépense (Finances) ou un achat de médicament/vaccin (Stocks).
        </div>
      )}

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
          {isEdit ? 'Mettre à jour' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

function TypeBadge({ type }: { type: HealthType }) {
  return (
    <span
      className={
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border ' +
        TYPE_CLASS[type]
      }
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

function ArchiveRecord({
  record,
  onArchived,
}: {
  record: HealthRecord;
  onArchived: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('health_records')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', record.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Enregistrement archivé.');
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
        title="Archiver cet enregistrement ?"
        message={
          record.type === 'mortalite'
            ? "Archiver une mortalité réintègrera son effectif au lot (calculé dynamiquement)."
            : 'Il disparaîtra de la liste mais reste dans l\u2019historique en base.'
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
  hasLots,
  onCreate,
}: {
  hasLots: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <HeartPulse className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucun enregistrement santé</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          {hasLots
            ? 'Saisissez les traitements, vaccins, maladies et mortalités par lot.'
            : 'Créez d\u2019abord un lot actif (onglet Lots).'}
        </p>
      </div>
      {hasLots && (
        <button
          type="button"
          onClick={onCreate}
          className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nouvel enregistrement
        </button>
      )}
    </div>
  );
}
