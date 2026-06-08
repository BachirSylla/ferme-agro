import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { dateShortFmt, formatFCFA, formatNumberFr, qtyFmt, todayIso } from '@/lib/format';
import type { Enums, Tables } from '@/types/db';

type StockItem = Tables<'stock_items'>;
type StockMovement = Tables<'stock_movements'>;
type Lot = Tables<'lots'>;
type StockType = Enums<'stock_type'>;
type PaymentMethod = Enums<'payment_method'>;

const TYPE_LABEL: Record<StockType, string> = {
  aliment: 'Aliment',
  medicament: 'Médicament',
  emballage: 'Emballage',
  produit_fini: 'Produit fini',
};
const TYPE_CLASS: Record<StockType, string> = {
  aliment: 'bg-amber-100 text-amber-800 border-amber-200',
  medicament: 'bg-violet-100 text-violet-800 border-violet-200',
  emballage: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  produit_fini: 'bg-sky-100 text-sky-800 border-sky-200',
};

// Catégorie d'expense suggérée à l'achat selon le type d'article. L'utilisateur
// peut toujours surcharger dans le formulaire.
const DEFAULT_EXPENSE_CATEGORY: Record<StockType, string> = {
  aliment: 'aliment',
  medicament: 'médicament',
  emballage: 'emballage',
  produit_fini: 'achat marchandise',
};

type FormState =
  | { mode: 'closed' }
  | { mode: 'create_item' }
  | { mode: 'edit_item'; item: StockItem }
  | { mode: 'purchase'; item: StockItem }
  | { mode: 'sortie'; item: StockItem };

type ItemStats = { stock: number; avgCost: number };

// Dérive stock courant et coût moyen unitaire à partir des mouvements non archivés.
// Convention CLAUDE.md : stock_items.quantity n'est PAS la vérité — on calcule.
function deriveStats(movements: StockMovement[]): ItemStats {
  let entreeQty = 0;
  let entreeCost = 0;
  let sortieQty = 0;
  for (const m of movements) {
    if (m.direction === 'entree') {
      entreeQty += m.quantity;
      entreeCost += m.cost;
    } else {
      sortieQty += m.quantity;
    }
  }
  return {
    stock: entreeQty - sortieQty,
    avgCost: entreeQty > 0 ? entreeCost / entreeQty : 0,
  };
}

export function StocksScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const orgId = session.organization.id;

  const [items, setItems] = useState<StockItem[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [activeLots, setActiveLots] = useState<Lot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoadError(null);
    const [itemsRes, mvRes, lotsRes] = await Promise.all([
      supabase
        .from('stock_items')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('stock_movements')
        .select('*')
        .is('deleted_at', null)
        .order('day', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('lots')
        .select('*')
        .is('deleted_at', null)
        .eq('status', 'actif')
        .order('code', { ascending: true }),
    ]);
    if (itemsRes.error || mvRes.error || lotsRes.error) {
      setLoadError(
        itemsRes.error?.message ?? mvRes.error?.message ?? lotsRes.error?.message ?? 'erreur',
      );
      setItems([]);
      setMovements([]);
      return;
    }
    setItems(itemsRes.data ?? []);
    setMovements(mvRes.data ?? []);
    setActiveLots(lotsRes.data ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const movementsByItem = useMemo(() => {
    const m = new Map<string, StockMovement[]>();
    for (const mv of movements ?? []) {
      const arr = m.get(mv.stock_item_id);
      if (arr) arr.push(mv);
      else m.set(mv.stock_item_id, [mv]);
    }
    return m;
  }, [movements]);

  const lotsById = useMemo(() => new Map(activeLots.map((l) => [l.id, l])), [activeLots]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stocks</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Intrants, médicaments, emballages, produits finis — quantités et coût par lot.
        </p>
      </div>

      <CashRuleBanner />

      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {items === null
            ? 'Chargement…'
            : `${items.length} article${items.length > 1 ? 's' : ''}`}
        </div>
        {form.mode === 'closed' && (
          <button
            type="button"
            onClick={() => setForm({ mode: 'create_item' })}
            className="bg-brand text-brand-fg rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nouvel article
          </button>
        )}
      </div>

      {form.mode !== 'closed' && (
        <FormPanel
          orgId={orgId}
          form={form}
          lots={activeLots}
          movements={movements ?? []}
          onClose={() => setForm({ mode: 'closed' })}
          onSaved={() => {
            setForm({ mode: 'closed' });
            void refresh();
          }}
        />
      )}

      {loadError && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          Impossible de charger les stocks : {loadError}
        </div>
      )}

      {items === null ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState onCreate={() => setForm({ mode: 'create_item' })} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const mvs = movementsByItem.get(item.id) ?? [];
            const stats = deriveStats(mvs);
            const lowStock =
              item.reorder_threshold > 0 && stats.stock <= item.reorder_threshold;
            const isExpanded = expanded.has(item.id);
            return (
              <ItemCard
                key={item.id}
                item={item}
                stats={stats}
                lowStock={lowStock}
                movements={mvs}
                lotsById={lotsById}
                isExpanded={isExpanded}
                onToggle={() => toggleExpanded(item.id)}
                onEdit={() => setForm({ mode: 'edit_item', item })}
                onPurchase={() => setForm({ mode: 'purchase', item })}
                onSortie={() => setForm({ mode: 'sortie', item })}
                onChanged={() => void refresh()}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Bannière règle Stocks vs Cash (anti double-comptage) ────

function CashRuleBanner() {
  return (
    <div className="text-xs bg-sky-50 border border-sky-200 text-sky-900 rounded-xl px-3 py-2 flex items-start gap-2">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <strong>Stocks vs Cash :</strong> un achat crée 1 entrée de stock <em>et</em> 1 dépense (cash sortant).
        Une sortie vers un lot ne crée <strong>aucune dépense</strong> (le cash est déjà sorti à l'achat),
        elle alimente seulement le coût du lot.
      </div>
    </div>
  );
}

// ─── Carte d'article ────────────────────────────────────────

function ItemCard({
  item,
  stats,
  lowStock,
  movements,
  lotsById,
  isExpanded,
  onToggle,
  onEdit,
  onPurchase,
  onSortie,
  onChanged,
}: {
  item: StockItem;
  stats: ItemStats;
  lowStock: boolean;
  movements: StockMovement[];
  lotsById: Map<string, Lot>;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPurchase: () => void;
  onSortie: () => void;
  onChanged: () => void;
}) {
  return (
    <li className="rounded-2xl bg-white border border-neutral-200 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand grid place-items-center shrink-0">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{item.name}</span>
              <TypeBadge type={item.type} />
              {lowStock && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md border bg-red-100 text-red-800 border-red-200">
                  <AlertTriangle className="h-3 w-3" />
                  Stock bas
                </span>
              )}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1 flex-wrap">
              <span className="font-medium text-neutral-700">
                {qtyFmt.format(stats.stock)} {item.unit}
              </span>
              {item.reorder_threshold > 0 && (
                <>
                  <span>·</span>
                  <span>seuil {qtyFmt.format(item.reorder_threshold)} {item.unit}</span>
                </>
              )}
              {stats.avgCost > 0 && (
                <>
                  <span>·</span>
                  <span>coût moyen ~{formatNumberFr(Math.round(stats.avgCost))} FCFA/{item.unit}</span>
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
            aria-label={`Éditer ${item.name}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <ArchiveItem item={item} onArchived={onChanged} />
        </div>
      </div>

      <div className="px-4 pb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPurchase}
          className="text-sm bg-brand text-brand-fg rounded-lg px-3 py-1.5 font-medium hover:opacity-95 flex items-center gap-1.5"
        >
          <ArrowDownToLine className="h-4 w-4" />
          Achat (entrée + dépense)
        </button>
        <button
          type="button"
          onClick={onSortie}
          className="text-sm border border-neutral-300 rounded-lg px-3 py-1.5 font-medium hover:bg-neutral-50 flex items-center gap-1.5"
        >
          <ArrowUpFromLine className="h-4 w-4" />
          Sortie (vers lot ou vente)
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-sm text-neutral-600 hover:text-neutral-900 ml-auto px-2 py-1.5 rounded-md hover:bg-neutral-100 flex items-center gap-1"
        >
          Historique
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {isExpanded && (
        <MovementsList
          item={item}
          movements={movements}
          lotsById={lotsById}
          onArchived={onChanged}
        />
      )}
    </li>
  );
}

function TypeBadge({ type }: { type: StockType }) {
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

// ─── Historique des mouvements ──────────────────────────────

function MovementsList({
  item,
  movements,
  lotsById,
  onArchived,
}: {
  item: StockItem;
  movements: StockMovement[];
  lotsById: Map<string, Lot>;
  onArchived: () => void;
}) {
  if (movements.length === 0) {
    return (
      <div className="border-t border-neutral-100 px-4 py-3 text-sm text-neutral-500 italic">
        Aucun mouvement pour l'instant. Saisissez un achat pour démarrer.
      </div>
    );
  }
  return (
    <ul className="border-t border-neutral-100 divide-y divide-neutral-100">
      {movements.slice(0, 10).map((m) => {
        const isEntree = m.direction === 'entree';
        const lot = m.lot_id ? lotsById.get(m.lot_id) : null;
        return (
          <li
            key={m.id}
            className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className={
                  'h-7 w-7 rounded-lg grid place-items-center shrink-0 ' +
                  (isEntree
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-neutral-100 text-neutral-700')
                }
              >
                {isEntree ? (
                  <ArrowDownToLine className="h-4 w-4" />
                ) : (
                  <ArrowUpFromLine className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">
                    {isEntree ? '+ ' : '− '}
                    {qtyFmt.format(m.quantity)} {item.unit}
                  </span>
                  {lot ? (
                    <span className="text-xs rounded-md bg-neutral-100 px-1.5 py-0.5">
                      → {lot.code}
                    </span>
                  ) : m.lot_id ? (
                    <span className="text-xs italic text-neutral-500">→ lot archivé</span>
                  ) : null}
                </div>
                <div className="text-xs text-neutral-500 flex items-center gap-1 flex-wrap">
                  <span>{dateShortFmt.format(new Date(m.day))}</span>
                  {isEntree ? (
                    <>
                      <span>·</span>
                      <span>{formatFCFA(m.cost)} <em>(achat — cash sortant)</em></span>
                    </>
                  ) : lot ? (
                    <>
                      <span>·</span>
                      <span>{formatFCFA(m.cost)} <em>(imputé au lot, pas de cash)</em></span>
                    </>
                  ) : (
                    <>
                      <span>·</span>
                      <span>vente / sortie diverse</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <ArchiveMovement movement={m} onArchived={onArchived} />
          </li>
        );
      })}
      {movements.length > 10 && (
        <li className="px-4 py-2 text-xs text-neutral-400 italic">
          + {movements.length - 10} mouvement{movements.length - 10 > 1 ? 's' : ''} plus ancien{movements.length - 10 > 1 ? 's' : ''}
        </li>
      )}
    </ul>
  );
}

// ─── Form panel : routes vers le bon sous-formulaire ─────────

function FormPanel({
  orgId,
  form,
  lots,
  movements,
  onClose,
  onSaved,
}: {
  orgId: string;
  form: FormState;
  lots: Lot[];
  movements: StockMovement[];
  onClose: () => void;
  onSaved: () => void;
}) {
  if (form.mode === 'closed') return null;
  if (form.mode === 'create_item' || form.mode === 'edit_item') {
    return (
      <ItemForm
        orgId={orgId}
        initial={form.mode === 'edit_item' ? form.item : null}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }
  if (form.mode === 'purchase') {
    return <PurchaseForm orgId={orgId} item={form.item} onClose={onClose} onSaved={onSaved} />;
  }
  // sortie
  const itemMovements = movements.filter((m) => m.stock_item_id === form.item.id);
  const stats = deriveStats(itemMovements);
  return (
    <SortieForm
      orgId={orgId}
      item={form.item}
      lots={lots}
      avgCost={stats.avgCost}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// ─── Form : créer / éditer un article ────────────────────────

function ItemForm({
  orgId,
  initial,
  onClose,
  onSaved,
}: {
  orgId: string;
  initial: StockItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<StockType>(initial?.type ?? 'aliment');
  const [unit, setUnit] = useState(initial?.unit ?? 'unite');
  const [threshold, setThreshold] = useState(String(initial?.reorder_threshold ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const thr = Number.parseFloat(threshold.replace(',', '.'));
    if (!Number.isFinite(thr) || thr < 0) {
      setError('Le seuil doit être un nombre positif.');
      return;
    }
    setBusy(true);
    const payload = {
      name: name.trim(),
      type,
      unit: unit.trim() || 'unite',
      reorder_threshold: thr,
    };
    const { error: dbError } = initial
      ? await supabase.from('stock_items').update(payload).eq('id', initial.id)
      : await supabase.from('stock_items').insert({ ...payload, org_id: orgId });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push('success', isEdit ? 'Article mis à jour.' : `Article « ${payload.name} » créé.`);
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <FormHeader title={isEdit ? 'Modifier l\u2019article' : 'Nouvel article'} onClose={onClose} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">Nom</span>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Maïs, vitamines, sachets, miel…"
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as StockType)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="aliment">Aliment</option>
            <option value="medicament">Médicament</option>
            <option value="emballage">Emballage</option>
            <option value="produit_fini">Produit fini (négoce)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Unité</span>
          <input
            type="text"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="kg, litre, unité, sac…"
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-700">
          Seuil de réappro <span className="text-neutral-400 font-normal">(0 = pas d'alerte)</span>
        </span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </label>

      <p className="text-xs text-neutral-500 -mt-1">
        Pas de quantité à saisir : le stock se déduit automatiquement des entrées
        et sorties.
      </p>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <FormButtons busy={busy} isEdit={isEdit} onClose={onClose} createLabel="Créer l'article" />
    </form>
  );
}

// ─── Form : achat (entrée stock + expense liée) ──────────────

function PurchaseForm({
  orgId,
  item,
  onClose,
  onSaved,
}: {
  orgId: string;
  item: StockItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [day, setDay] = useState(todayIso());
  const [quantity, setQuantity] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [category, setCategory] = useState(DEFAULT_EXPENSE_CATEGORY[item.type]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const qty = Number.parseFloat(quantity.replace(',', '.'));
    const cost = Number.parseInt(totalCost, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('La quantité doit être un nombre positif.');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError('Le coût total doit être un entier positif (FCFA).');
      return;
    }
    if (category.trim() === '') {
      setError('La catégorie de dépense est requise.');
      return;
    }

    setBusy(true);
    // Achat = 1 stock_movement (entree) + 1 expense liée par stock_item_id.
    // Pas de transaction côté supabase-js : on insère l'un puis l'autre, et on
    // rollback en soft-delete si la deuxième INSERT échoue.
    const { data: mv, error: mvErr } = await supabase
      .from('stock_movements')
      .insert({
        org_id: orgId,
        stock_item_id: item.id,
        lot_id: null,
        day,
        direction: 'entree',
        quantity: qty,
        cost,
      })
      .select()
      .single();
    if (mvErr || !mv) {
      setBusy(false);
      setError(mvErr?.message ?? 'erreur');
      return;
    }

    const { error: expErr } = await supabase.from('expenses').insert({
      org_id: orgId,
      stock_item_id: item.id,
      lot_id: null, // pas d'imputation à un lot par défaut sur un achat de stock
      day,
      category: category.trim(),
      amount: cost,
      supplier: supplier.trim() === '' ? null : supplier.trim(),
      payment_method: paymentMethod,
    });
    if (expErr) {
      await supabase
        .from('stock_movements')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', mv.id);
      setBusy(false);
      setError(`Échec de l'enregistrement de la dépense : ${expErr.message}`);
      return;
    }

    setBusy(false);
    toast.push('success', `Achat enregistré : +${qty} ${item.unit} et dépense de ${formatFCFA(cost)}.`);
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <FormHeader
        title={`Achat — ${item.name}`}
        subtitle="Crée une entrée de stock ET une dépense liée. Cash sortant."
        onClose={onClose}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <span className="text-sm font-medium text-neutral-700">Mode de paiement</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="border border-neutral-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            <option value="cash">Espèces</option>
            <option value="wave">Wave</option>
            <option value="orange_money">Orange Money</option>
            <option value="autre">Autre</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Quantité ({item.unit})</span>
          <input
            type="text"
            required
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]+)?"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            autoFocus
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Coût total</span>
          <div className="relative">
            <input
              type="number"
              required
              min={0}
              step={1}
              inputMode="numeric"
              value={totalCost}
              onChange={(e) => setTotalCost(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 pr-14 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 font-medium">
              FCFA
            </span>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Catégorie de dépense</span>
          <input
            type="text"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="stock-purchase-categories"
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <datalist id="stock-purchase-categories">
            <option value="aliment" />
            <option value="médicament" />
            <option value="emballage" />
            <option value="achat marchandise" />
            <option value="vétérinaire" />
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Fournisseur <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <input
            type="text"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
      </div>

      <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
        💸 Cet achat crée <strong>2 enregistrements liés</strong> : entrée de stock
        + dépense (visible dans Finances). Le cash sort une seule fois.
      </div>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <FormButtons busy={busy} isEdit={false} onClose={onClose} createLabel="Enregistrer l'achat" />
    </form>
  );
}

// ─── Form : sortie de stock (vers lot, ou vente / divers) ────

function SortieForm({
  orgId,
  item,
  lots,
  avgCost,
  onClose,
  onSaved,
}: {
  orgId: string;
  item: StockItem;
  lots: Lot[];
  avgCost: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [day, setDay] = useState(todayIso());
  const [quantity, setQuantity] = useState('');
  const [lotId, setLotId] = useState<string>('');
  const [cost, setCost] = useState('');
  const [costEdited, setCostEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-pré-remplit le coût d'imputation à quantity × coût moyen, sauf si
  // l'utilisateur a déjà édité ce champ manuellement.
  useMemo(() => {
    if (costEdited) return;
    const q = Number.parseFloat(quantity.replace(',', '.'));
    if (Number.isFinite(q) && q > 0 && avgCost > 0) {
      setCost(String(Math.round(q * avgCost)));
    }
  }, [quantity, avgCost, costEdited]);

  const isToLot = lotId !== '';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const qty = Number.parseFloat(quantity.replace(',', '.'));
    const cst = Number.parseInt(cost, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('La quantité doit être un nombre positif.');
      return;
    }
    if (!Number.isFinite(cst) || cst < 0) {
      setError('Le coût d\u2019imputation doit être un entier positif (FCFA).');
      return;
    }
    setBusy(true);
    const { error: dbError } = await supabase.from('stock_movements').insert({
      org_id: orgId,
      stock_item_id: item.id,
      lot_id: lotId === '' ? null : lotId,
      day,
      direction: 'sortie',
      quantity: qty,
      cost: cst,
    });
    setBusy(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    toast.push(
      'success',
      isToLot
        ? `Sortie ${qty} ${item.unit} → coût ${formatFCFA(cst)} imputé au lot.`
        : `Sortie ${qty} ${item.unit} enregistrée.`,
    );
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-neutral-200 p-4 flex flex-col gap-3 shadow-sm"
    >
      <FormHeader
        title={`Sortie — ${item.name}`}
        subtitle="Aucune dépense créée : le cash est déjà sorti à l'achat."
        onClose={onClose}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <span className="text-sm font-medium text-neutral-700">
            Lot <span className="text-neutral-400 font-normal">(facultatif — laisser vide pour une vente / sortie diverse)</span>
          </span>
          <select
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Quantité ({item.unit})</span>
          <input
            type="text"
            required
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]+)?"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            autoFocus
            className="border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Coût d'imputation {isToLot ? '(au lot)' : '(valorisation)'}
          </span>
          <div className="relative">
            <input
              type="number"
              required
              min={0}
              step={1}
              inputMode="numeric"
              value={cost}
              onChange={(e) => {
                setCostEdited(true);
                setCost(e.target.value);
              }}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 pr-14 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 font-medium">
              FCFA
            </span>
          </div>
          {avgCost > 0 && !costEdited && (
            <span className="text-xs text-neutral-500">
              Pré-rempli à partir du coût moyen ({formatNumberFr(Math.round(avgCost))} FCFA/{item.unit}).
            </span>
          )}
        </label>
      </div>

      <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-3 py-2">
        ✅ Aucune dépense créée. {isToLot
          ? 'Le coût est imputé uniquement à la marge analytique du lot.'
          : 'Cette sortie de stock ne touche pas le cash.'}
      </div>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <FormButtons busy={busy} isEdit={false} onClose={onClose} createLabel="Enregistrer la sortie" />
    </form>
  );
}

// ─── Sous-composants partagés ────────────────────────────────

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

function ArchiveItem({ item, onArchived }: { item: StockItem; onArchived: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('stock_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', item.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', `Article « ${item.name} » archivé.`);
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
        title={`Archiver « ${item.name} » ?`}
        message="L'article disparaît de la liste, mais les mouvements et dépenses passés restent visibles dans l'historique."
        confirmLabel="Archiver"
        busy={busy}
        onConfirm={() => void archive()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function ArchiveMovement({
  movement,
  onArchived,
}: {
  movement: StockMovement;
  onArchived: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    const { error: dbError } = await supabase
      .from('stock_movements')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', movement.id);
    setBusy(false);
    if (dbError) {
      toast.push('error', `Échec : ${dbError.message}`);
      return;
    }
    toast.push('success', 'Mouvement archivé.');
    setOpen(false);
    onArchived();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-red-700 hover:text-red-900 px-1.5 py-1 rounded-md hover:bg-red-50 shrink-0"
        aria-label="Archiver le mouvement"
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={open}
        title="Archiver ce mouvement ?"
        message={
          movement.direction === 'entree'
            ? "Note : l'entrée disparaît de l'historique mais la dépense liée reste dans Finances. Archivez-la séparément si nécessaire."
            : 'La sortie disparaît de l\u2019historique et n\u2019est plus déduite du stock.'
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
          <div className="h-8 w-2/3 bg-neutral-100 rounded animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 flex flex-col items-center text-center gap-3">
      <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand grid place-items-center">
        <Boxes className="h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">Aucun article en stock</div>
        <p className="text-sm text-neutral-600 mt-0.5">
          Ajoutez vos intrants (aliment, médicament…) ou produits finis de négoce
          (mangue, riz…). Le stock se mettra à jour automatiquement avec les achats
          et sorties.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 shadow-sm flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" />
        Nouvel article
      </button>
    </div>
  );
}
