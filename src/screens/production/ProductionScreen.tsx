import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  ClipboardList,
  Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { Enums, Tables } from '@/types/db';

type Production = Tables<'production_records'>;
type Product = Tables<'products'>;
type Lot = Tables<'lots'>;
type Category = Enums<'production_category'>;

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

const quantityFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function formatDayLabel(day: string): string {
  if (day === todayIso()) return "Aujourd'hui";
  if (day === yesterdayIso()) return 'Hier';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T00:00:00`));
}

type FormValues = {
  day: string;
  product_id: string;
  lot_id: string;
  quantity: string;
  category: Category;
};

const INITIAL_FORM: FormValues = {
  day: todayIso(),
  product_id: '',
  lot_id: '',
  quantity: '',
  category: 'ponte',
};

export function ProductionScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;
  const toast = useToast();

  const [records, setRecords] = useState<Production[] | null>(null);
  const [productsById, setProductsById] = useState<Map<string, Product>>(new Map());
  const [lotsById, setLotsById] = useState<Map<string, Lot>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormValues>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quantityRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [recRes, prRes, lotRes] = await Promise.all([
      supabase
        .from('production_records')
        .select('*')
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('lots')
        .select('*')
        .is('deleted_at', null)
        .eq('status', 'actif')
        .order('code', { ascending: true }),
    ]);
    if (recRes.error || prRes.error || lotRes.error) {
      setLoadError(
        recRes.error?.message ?? prRes.error?.message ?? lotRes.error?.message ?? 'erreur',
      );
      setRecords([]);
      return;
    }
    setRecords(recRes.data);
    setProductsById(new Map(prRes.data.map((p) => [p.id, p])));
    setLotsById(new Map(lotRes.data.map((l) => [l.id, l])));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const products = useMemo(() => Array.from(productsById.values()), [productsById]);
  const lots = useMemo(() => Array.from(lotsById.values()), [lotsById]);

  const isEdit = editingId !== null;

  function startEdit(rec: Production) {
    setEditingId(rec.id);
    setForm({
      day: rec.day,
      product_id: rec.product_id,
      lot_id: rec.lot_id ?? '',
      quantity: String(rec.quantity),
      category: rec.category,
    });
    setFormError(null);
    // Scroll en haut pour montrer le formulaire à l'utilisateur.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm((f) => ({ ...f, quantity: '' }));
    setFormError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!form.product_id) {
      setFormError('Choisissez un produit.');
      return;
    }
    const qty = Number.parseFloat(form.quantity.replace(',', '.'));
    if (!Number.isFinite(qty) || qty < 0) {
      setFormError('La quantité doit être un nombre positif.');
      return;
    }

    setBusy(true);
    const payload = {
      day: form.day,
      product_id: form.product_id,
      lot_id: form.lot_id === '' ? null : form.lot_id,
      quantity: qty,
      category: form.category,
    };
    const { error: dbError } = editingId
      ? await supabase.from('production_records').update(payload).eq('id', editingId)
      : await supabase.from('production_records').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setFormError(dbError.message);
      return;
    }

    if (editingId) {
      toast.push('success', 'Saisie mise à jour.');
      setEditingId(null);
      setForm((f) => ({ ...f, quantity: '' }));
    } else {
      toast.push('success', `Saisie enregistrée (${quantityFmt.format(qty)}).`);
      // Garde product/lot/day/category, vide la quantité, refocus pour enchaîner.
      setForm((f) => ({ ...f, quantity: '' }));
      window.requestAnimationFrame(() => quantityRef.current?.focus());
    }
    void refresh();
  }

  // Groupement de la liste par jour, ordre desc (le map Maps garde l'ordre d'insertion,
  // et records arrive déjà trié par day desc → l'ordre tombe juste).
  const grouped = useMemo(() => {
    if (!records) return null;
    const m = new Map<string, Production[]>();
    for (const r of records) {
      const list = m.get(r.day);
      if (list) list.push(r);
      else m.set(r.day, [r]);
    }
    return m;
  }, [records]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Production</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Saisie quotidienne : ponte, casse, consommation, récolte.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            {isEdit ? (
              <>
                <Pencil className="h-4 w-4 text-neutral-600" />
                Modifier la saisie
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 text-brand" />
                Saisie rapide
              </>
            )}
          </h2>
          {isEdit && (
            <button
              type="button"
              onClick={cancelEdit}
              className="text-sm text-neutral-500 hover:text-neutral-800 flex items-center gap-1"
            >
              <X className="h-4 w-4" />
              Annuler l'édition
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">Date</span>
            <input
              type="date"
              required
              value={form.day}
              onChange={(e) => setForm({ ...form, day: e.target.value })}
              className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">Catégorie</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
              className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            >
              <option value="ponte">Ponte</option>
              <option value="casse">Casse</option>
              <option value="consomme">Consommé</option>
              <option value="recolte">Récolte</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Produit</span>
          <select
            required
            value={form.product_id}
            onChange={(e) => setForm({ ...form, product_id: e.target.value })}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="" disabled>
              — Choisir un produit
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.unit})
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">
              Lot <span className="text-neutral-400 font-normal">(facultatif)</span>
            </span>
            <select
              value={form.lot_id}
              onChange={(e) => setForm({ ...form, lot_id: e.target.value })}
              className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            >
              <option value="">— Sans lot</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-700">Quantité</span>
            <input
              ref={quantityRef}
              type="text"
              required
              inputMode="decimal"
              pattern="[0-9]+([.,][0-9]+)?"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="0"
              className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </label>
        </div>

        {formError && (
          <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
            {formError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          {!isEdit && (
            <span className="text-xs text-neutral-500 hidden sm:inline">
              Astuce : les valeurs restent en place après save pour enchaîner.
            </span>
          )}
          <button
            type="submit"
            disabled={busy || products.length === 0}
            className="ml-auto bg-brand text-brand-fg rounded-lg px-4 py-1.5 text-sm font-medium hover:opacity-95 disabled:opacity-60 flex items-center gap-2"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {isEdit ? 'Mettre à jour' : 'Enregistrer'}
          </button>
        </div>

        {products.length === 0 && records !== null && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Ajoutez un <strong>produit</strong> dans le Catalogue pour pouvoir saisir une
            production.
          </p>
        )}
      </form>

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les saisies : {loadError}
        </div>
      )}

      {grouped === null ? (
        <ListSkeleton />
      ) : grouped.size === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-4">
          {Array.from(grouped.entries()).map(([day, items]) => (
            <DayGroup
              key={day}
              day={day}
              items={items}
              productsById={productsById}
              lotsById={lotsById}
              onEdit={startEdit}
              onArchived={() => void refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DayGroup({
  day,
  items,
  productsById,
  lotsById,
  onEdit,
  onArchived,
}: {
  day: string;
  items: Production[];
  productsById: Map<string, Product>;
  lotsById: Map<string, Lot>;
  onEdit: (rec: Production) => void;
  onArchived: () => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-sm font-semibold text-neutral-700">{formatDayLabel(day)}</h3>
        <span className="text-xs text-neutral-400">
          {items.length} saisie{items.length > 1 ? 's' : ''}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-neutral-200 rounded-2xl bg-white border border-neutral-200 overflow-hidden shadow-sm">
        {items.map((r) => {
          const product = productsById.get(r.product_id);
          const lot = r.lot_id ? lotsById.get(r.lot_id) : null;
          return (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">
                      {product?.name ?? 'Produit inconnu'}
                    </span>
                    <CategoryBadge category={r.category} />
                  </div>
                  <div className="text-xs text-neutral-500 truncate flex items-center gap-1 flex-wrap mt-0.5">
                    <span className="font-medium text-neutral-700">
                      {quantityFmt.format(r.quantity)} {product?.unit ?? ''}
                    </span>
                    <span>·</span>
                    {lot ? (
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5">
                        {lot.code}
                      </span>
                    ) : r.lot_id ? (
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 italic">
                        lot archivé
                      </span>
                    ) : (
                      <span className="italic">sans lot</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onEdit(r)}
                  className="text-sm text-neutral-700 hover:text-neutral-900 px-2 py-1.5 rounded-md hover:bg-neutral-100"
                  aria-label="Éditer"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <ArchiveRecord record={r} onArchived={onArchived} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={
        'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border ' +
        CATEGORY_CLASS[category]
      }
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

function ArchiveRecord({
  record,
  onArchived,
}: {
  record: Production;
  onArchived: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('production_records')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', record.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Saisie archivée.');
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
        title="Archiver cette saisie ?"
        message="Elle n'apparaîtra plus dans la liste, mais reste dans l'historique en base."
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

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <ClipboardList className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucune saisie</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          Utilisez le formulaire ci-dessus pour enregistrer la production du jour.
        </p>
      </div>
    </div>
  );
}
