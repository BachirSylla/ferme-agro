import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, Pencil, Archive, X, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { Tables } from '@/types/db';

type Product = Tables<'products'>;
type Species = Tables<'species'>;

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; product: Product };

const xofFormatter = new Intl.NumberFormat('fr-FR');

export function ProductsPanel() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [products, setProducts] = useState<Product[] | null>(null);
  const [speciesById, setSpeciesById] = useState<Map<string, Species>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [prodRes, spRes] = await Promise.all([
      supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('species')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
    ]);
    if (prodRes.error || spRes.error) {
      setLoadError(prodRes.error?.message ?? spRes.error?.message ?? 'erreur');
      setProducts([]);
      return;
    }
    setProducts(prodRes.data);
    setSpeciesById(new Map(spRes.data.map((s) => [s.id, s])));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const speciesList = Array.from(speciesById.values());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {products === null
            ? 'Chargement…'
            : `${products.length} produit${products.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create' })}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nouveau produit
          </button>
        )}
      </div>

      {form.mode !== 'closed' && (
        <ProductForm
          orgId={orgId}
          species={speciesList}
          initial={form.mode === 'edit' ? form.product : null}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les produits : {loadError}
        </div>
      )}

      {products === null ? (
        <ListSkeleton />
      ) : products.length === 0 ? (
        <EmptyState
          onCreate={() => setForm({ mode: 'create' })}
          actionLabel="Créer un produit"
          title="Aucun produit"
          message="Ajoutez les produits que vous vendez (œufs, miel, lait…). Une espèce est facultative."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
          {products.map((p) => {
            const sp = p.species_id ? speciesById.get(p.species_id) : null;
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-neutral-500 truncate flex items-center gap-1 flex-wrap">
                      {sp ? (
                        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5">{sp.name}</span>
                      ) : (
                        <span className="rounded-md bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5">
                          Sans espèce
                        </span>
                      )}
                      <span>·</span>
                      <span>{p.unit}</span>
                      <span>·</span>
                      <span className="font-medium text-neutral-700">
                        {xofFormatter.format(p.default_price)} FCFA
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setForm({ mode: 'edit', product: p })}
                    className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100 flex items-center gap-1"
                    aria-label={`Éditer ${p.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <ArchiveProduct product={p} onArchived={() => void refresh()} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProductForm({
  orgId,
  species,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  species: Species[];
  initial: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? 'unite');
  const [price, setPrice] = useState<string>(String(initial?.default_price ?? 0));
  const [speciesId, setSpeciesId] = useState<string>(initial?.species_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const priceNumber = Number.parseInt(price, 10);
    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      setError('Le prix doit être un entier positif (FCFA, sans décimales).');
      setBusy(false);
      return;
    }
    const trimmedName = name.trim();
    const payload = {
      name: trimmedName,
      unit: unit.trim() || 'unite',
      default_price: priceNumber,
      species_id: speciesId === '' ? null : speciesId,
    };
    const { error: dbError } = initial
      ? await supabase.from('products').update(payload).eq('id', initial.id)
      : await supabase.from('products').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', initial ? 'Produit mis à jour.' : `Produit « ${trimmedName} » créé.`);
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{initial ? 'Modifier le produit' : 'Nouveau produit'}</h3>
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
          placeholder="Œufs de caille, miel, lait…"
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Unité</span>
          <input
            type="text"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="unité, litre, kg…"
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Prix par défaut</span>
          <div className="relative">
            <input
              type="number"
              required
              min={0}
              step={1}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
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
          Espèce <span className="text-neutral-400 font-normal">(facultatif)</span>
        </span>
        <select
          value={speciesId}
          onChange={(e) => setSpeciesId(e.target.value)}
          className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">— Aucune (produit indépendant, ex. miel)</option>
          {species.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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

function ArchiveProduct({
  product,
  onArchived,
}: {
  product: Product;
  onArchived: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', product.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', `Produit « ${product.name} » archivé.`);
    setOpen(false);
    onArchived();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-700 hover:text-red-900 px-2 py-1.5 rounded-md hover:bg-red-50 flex items-center gap-1"
        aria-label={`Archiver ${product.name}`}
      >
        <Archive className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={open}
        title={`Archiver « ${product.name} » ?`}
        message="Il n'apparaîtra plus dans la liste. Les données historiques sont conservées."
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
            <div className="h-2 w-1/2 bg-neutral-100 rounded animate-pulse" />
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
        <Package className="h-6 w-6" />
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
