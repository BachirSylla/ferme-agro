import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette,
  Type,
  Quote,
  Image as ImageIcon,
  Check,
  Save,
  RotateCcw,
  Loader2,
  Sprout,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { useToast } from '@/context/ToastContext';
import { applyBranding } from '@/lib/branding';

// Palette curée — 16 couleurs profondes garantissant un bon contraste avec
// du texte blanc (--brand-fg-rgb par défaut = 255 255 255).
// Chaque teinte a été vérifiée ≥ 4.5:1 (WCAG AA). Pas de sélecteur libre :
// l'utilisateur tape une pastille, c'est tout. Pas de code hexa exposé.
const PALETTE: { id: string; name: string; hex: string }[] = [
  // Verts
  { id: 'vert', name: 'Vert agricole', hex: '#1f6e3a' },
  { id: 'emeraude', name: 'Émeraude', hex: '#047857' },
  { id: 'vert_sapin', name: 'Vert sapin', hex: '#14532d' },
  { id: 'olive', name: 'Olive', hex: '#4d7c0f' },
  // Bleus & sarcelle
  { id: 'sarcelle', name: 'Sarcelle', hex: '#0f766e' },
  { id: 'bleu_ciel', name: 'Bleu ciel', hex: '#0369a1' },
  { id: 'bleu_marin', name: 'Bleu marin', hex: '#1d4ed8' },
  { id: 'indigo', name: 'Indigo', hex: '#4338ca' },
  // Violets & roses
  { id: 'aubergine', name: 'Aubergine', hex: '#7e22ce' },
  { id: 'violet', name: 'Violet', hex: '#6b21a8' },
  { id: 'framboise', name: 'Framboise', hex: '#be185d' },
  { id: 'brique', name: 'Brique', hex: '#b91c1c' },
  // Chauds & terreux
  { id: 'terracotta', name: 'Terracotta', hex: '#b45309' },
  { id: 'moutarde', name: 'Moutarde', hex: '#a16207' },
  { id: 'marron', name: 'Marron', hex: '#78350f' },
  // Neutre
  { id: 'ardoise', name: 'Ardoise', hex: '#475569' },
];

export function PersonnalisationScreen() {
  const session = useSession();
  if (session.status !== 'authenticated') return null;
  const toast = useToast();
  const { profile, organization, setOrganization } = session;

  const canEdit = profile.role === 'proprietaire';

  const [name, setName] = useState(organization.name);
  const [slogan, setSlogan] = useState(organization.slogan ?? '');
  const [color, setColor] = useState(organization.color_primary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le snapshot d'origine reste figé pour pouvoir restaurer le branding
  // au démontage si l'utilisateur quitte sans sauver.
  const savedRef = useRef(false);
  const originalOrgRef = useRef(organization);

  // Aperçu live : on pousse la couleur courante dans la variable CSS
  // racine dès qu'elle change. Tout brand-* à l'écran (header, badges,
  // boutons) suit instantanément, sans rerender React.
  useEffect(() => {
    applyBranding({ color_primary: color });
  }, [color]);

  // Si l'utilisateur quitte l'écran sans avoir sauvé, on remet la couleur
  // officielle de la ferme pour ne pas laisser l'app dans un état "preview"
  // ambigu sur les autres écrans.
  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        applyBranding(originalOrgRef.current);
      }
    };
  }, []);

  const trimmedName = name.trim();
  const trimmedSlogan = slogan.trim();
  const sloganValue = trimmedSlogan === '' ? null : trimmedSlogan;

  const dirty = useMemo(
    () =>
      trimmedName !== organization.name ||
      sloganValue !== organization.slogan ||
      color !== organization.color_primary,
    [trimmedName, sloganValue, color, organization],
  );

  async function save() {
    if (!canEdit) return;
    setError(null);
    if (trimmedName === '') {
      setError('Le nom de la ferme est requis.');
      return;
    }
    setBusy(true);
    const { data, error: dbError } = await supabase
      .from('organizations')
      .update({
        name: trimmedName,
        slogan: sloganValue,
        color_primary: color,
      })
      .eq('id', organization.id)
      .select()
      .single();
    setBusy(false);
    if (dbError || !data) {
      setError(dbError?.message ?? 'Échec de l\u2019enregistrement.');
      return;
    }
    savedRef.current = true;
    originalOrgRef.current = data;
    setOrganization(data);
    toast.push('success', 'Personnalisation enregistrée.');
  }

  function reset() {
    setName(originalOrgRef.current.name);
    setSlogan(originalOrgRef.current.slogan ?? '');
    setColor(originalOrgRef.current.color_primary);
    setError(null);
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Personnalisation</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Couleur, nom et slogan de la ferme.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            <strong>Accès réservé au propriétaire.</strong> Demandez au propriétaire
            de la ferme d'effectuer ces modifications.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Personnalisation</h1>
        <p className="text-sm text-neutral-500 mt-0.5">
          Couleur, nom et slogan de votre ferme. Aperçu en direct.
        </p>
      </div>

      {/* ─── Aperçu visuel (live preview) ─── */}
      <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
          <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
            <Sprout className="h-4 w-4" />
          </span>
          Aperçu
        </div>
        <div className="rounded-xl bg-brand text-brand-fg p-4 flex items-center gap-3 shadow-sm">
          {organization.logo_url ? (
            <img
              src={organization.logo_url}
              alt=""
              className="h-12 w-12 rounded-xl object-cover bg-white/10 shrink-0"
            />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-white/15 grid place-items-center font-bold text-xl shrink-0">
              {(trimmedName || 'F').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">
              {trimmedName || 'Ma ferme'}
            </div>
            <div className="text-xs opacity-90 leading-tight truncate">
              {trimmedSlogan || 'Votre slogan apparaîtra ici'}
            </div>
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          C'est exactement ce que vous (et vos superviseurs) verrez dans l'en-tête de
          l'application.
        </p>
      </section>

      {/* ─── Couleur ─── */}
      <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
            <Palette className="h-4 w-4" />
          </span>
          <h2 className="font-semibold text-neutral-800">Couleur de la marque</h2>
        </div>
        <p className="text-xs text-neutral-500 -mt-1">
          Touchez une pastille — la couleur s'applique immédiatement à tout l'écran.
        </p>
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 mt-1">
          {PALETTE.map((p) => {
            const active = color === p.hex;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setColor(p.hex)}
                className="flex flex-col items-center gap-1.5 group focus:outline-none"
                aria-label={p.name}
                aria-pressed={active}
              >
                <span
                  style={{ backgroundColor: p.hex }}
                  className={
                    'h-12 w-12 rounded-full grid place-items-center transition-all shadow-sm ' +
                    'ring-offset-2 ring-offset-white ' +
                    (active
                      ? 'ring-[3px] ring-neutral-800 scale-105'
                      : 'ring-0 group-hover:scale-105 group-active:scale-95')
                  }
                >
                  {active && <Check className="h-5 w-5 text-white drop-shadow" />}
                </span>
                <span
                  className={
                    'text-[10.5px] text-center leading-tight max-w-full ' +
                    (active ? 'font-semibold text-neutral-900' : 'text-neutral-600')
                  }
                >
                  {p.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── Identité (nom + slogan) ─── */}
      <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
            <Type className="h-4 w-4" />
          </span>
          <h2 className="font-semibold text-neutral-800">Identité</h2>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">Nom de la ferme</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ferme Diakhao, Élevage Aïssata…"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-neutral-700">
            Slogan <span className="text-neutral-400 font-normal">(facultatif)</span>
          </span>
          <div className="relative">
            <Quote className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <input
              type="text"
              value={slogan}
              onChange={(e) => setSlogan(e.target.value)}
              placeholder="Œufs frais et miel de brousse"
              maxLength={60}
              className="w-full border border-neutral-300 rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>
          <span className="text-xs text-neutral-400 text-right">
            {slogan.length} / 60
          </span>
        </label>
      </section>

      {/* ─── Logo (lecture seule pour l'instant) ─── */}
      <section className="rounded-2xl bg-white border border-neutral-200 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center">
            <ImageIcon className="h-4 w-4" />
          </span>
          <h2 className="font-semibold text-neutral-800">Logo</h2>
        </div>
        {organization.logo_url ? (
          <div className="flex items-center gap-3">
            <img
              src={organization.logo_url}
              alt="Logo actuel"
              className="h-16 w-16 rounded-xl object-cover border border-neutral-200"
            />
            <div className="text-sm text-neutral-600">
              <div className="font-medium text-neutral-800">Logo actuel</div>
              <div className="text-xs text-neutral-500">
                L'édition / téléversement arrive avec le module Stockage.
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-4 text-center">
            <div className="text-sm text-neutral-600">
              Pas encore de logo. <span className="text-neutral-400">Téléversement à venir.</span>
            </div>
            <div className="text-xs text-neutral-400 mt-1">
              En attendant, l'initiale du nom de la ferme s'affiche sur l'en-tête.
            </div>
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* ─── Action bar sticky (au-dessus du bottom-nav) ─── */}
      <div className="sticky bottom-24 sm:bottom-28 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6">
        <div className="bg-white/95 backdrop-blur border border-neutral-200 shadow-lg rounded-2xl p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-500 flex-1 min-w-0 truncate">
            {dirty
              ? 'Modifications non enregistrées'
              : 'Toutes les modifications sont enregistrées'}
          </div>
          <button
            type="button"
            onClick={reset}
            disabled={!dirty || busy}
            className="text-sm text-neutral-700 hover:text-neutral-900 px-3 py-1.5 rounded-lg hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Réinitialiser</span>
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || busy}
            className="bg-brand text-brand-fg rounded-lg px-4 py-2 text-sm font-medium hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
