import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, Pencil, Archive, X, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { Tables } from '@/types/db';

type Species = Tables<'species'>;

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; species: Species };

export function SpeciesPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [items, setItems] = useState<Species[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from('species')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) {
      setLoadError(error.message);
      setItems([]);
      return;
    }
    setItems(data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {items === null
            ? 'Chargement…'
            : `${items.length} espèce${items.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nouvelle espèce
          </button>
        )}
      </div>

      {form.mode !== 'closed' && (
        <SpeciesForm
          orgId={orgId}
          initial={form.mode === 'edit' ? form.species : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les espèces : {loadError}
        </div>
      )}

      {items === null ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          onCreate={() => setForm({ mode: 'create' })}
          actionLabel="Créer une espèce"
          title="Aucune espèce"
          message="Ajoutez les espèces que vous élevez (cailles, canards, poissons…)."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  {s.category && (
                    <div className="text-xs text-neutral-500 truncate">{s.category}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setForm({ mode: 'edit', species: s })}
                  className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100 flex items-center gap-1"
                  aria-label={`Éditer ${s.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <ArchiveSpecies species={s} onArchived={() => void refresh()} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpeciesForm({
  orgId,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  initial: Species | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const payload = {
      name: trimmedName,
      category: trimmedCategory === '' ? null : trimmedCategory,
    };
    const { error: dbError } = initial
      ? await supabase.from('species').update(payload).eq('id', initial.id)
      : await supabase.from('species').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', initial ? 'Espèce mise à jour.' : `Espèce « ${trimmedName} » créée.`);
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{initial ? 'Modifier l\u2019espèce' : 'Nouvelle espèce'}</h3>
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
        <span className="text-sm font-medium text-neutral-700">Nom</span>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cailles, canards, tilapia…"
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">Catégorie <span className="text-neutral-400 font-normal">(facultatif)</span></span>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="volaille, poisson, ruminant…"
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
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
          {initial ? 'Mettre à jour' : 'Créer'}
        </button>
      </div>
    </form>
  );
}

function ArchiveSpecies({
  species,
  onArchived,
}: {
  species: Species;
  onArchived: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('species')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', species.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', `Espèce « ${species.name} » archivée.`);
    setOpen(false);
    onArchived();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-700 hover:text-red-900 px-2 py-1.5 rounded-md hover:bg-red-50 flex items-center gap-1"
        aria-label={`Archiver ${species.name}`}
      >
        <Archive className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        title={`Archiver « ${species.name} » ?`}
        message="Elle n'apparaîtra plus dans la liste. Les données historiques sont conservées."
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
          <div className="h-9 w-9 rounded-xl bg-neutral-200 animate-pulse" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 w-1/3 bg-neutral-200 rounded animate-pulse" />
            <div className="h-2 w-1/4 bg-neutral-100 rounded animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  title,
  message,
  actionLabel,
  onCreate,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <Layers className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="text-sm text-neutral-600 mt-0.5">{message}</p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" />
        {actionLabel}
      </button>
    </div>
  );
}
