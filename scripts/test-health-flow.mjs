// Test end-to-end Santé contre Supabase hébergé.
// Reproduit le scénario utilisateur :
//   - LOT-CAILLES-001 (initial 60)
//   - mortalité 4 → effectif dérivé = 56
//   - vaccin coût 10 000 → coût lot ↑, bénéfice INCHANGÉ (juge de paix)
//   - objectif taux_mortalité max 5 % → 4/60 = 6.67 %, statut "dépassé"
//   - édition + archivage OK

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const email = `claude-health-test-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

function lastOfMonthIso(yyyymm01) {
  const [y, m] = yyyymm01.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const monthEnd = lastOfMonthIso(monthStart);

async function fetchBenefice() {
  const { data } = await sb
    .from('v_financial_summary')
    .select('benefice')
    .eq('mois', monthStart)
    .maybeSingle();
  return data?.benefice ?? 0;
}

async function fetchLotCost(lotId) {
  const { data } = await sb
    .from('v_lot_overview')
    .select('cout_total, cout_sante')
    .eq('lot_id', lotId)
    .maybeSingle();
  return data ?? { cout_total: 0, cout_sante: 0 };
}

async function deriveEffectif(lotId, initial) {
  const { data } = await sb
    .from('health_records')
    .select('affected_count')
    .eq('lot_id', lotId)
    .eq('type', 'mortalite')
    .is('deleted_at', null);
  const mort = (data ?? []).reduce((s, r) => s + r.affected_count, 0);
  return { effectif: initial - mort, mortalite: mort };
}

console.log('[setup] signUp + lot LOT-CAILLES-001 (initial 60)');
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;
const { data: cailles } = await sb.from('species').insert({ org_id: orgId, name: 'Cailles' }).select().single();
const { data: lot } = await sb
  .from('lots')
  .insert({
    org_id: orgId,
    species_id: cailles.id,
    code: 'LOT-CAILLES-001',
    initial_count: 60,
    current_count: 60,
    status: 'actif',
  })
  .select()
  .single();
console.log('  ✓ setup ;', { lot: lot.id.slice(0, 8), initial: lot.initial_count });

// ─── M1 : mortalité 4 → effectif dérivé = 56 ───────────────
console.log('\n[M1] saisir mortalité de 4 animaux');
await sb.from('health_records').insert({
  org_id: orgId,
  lot_id: lot.id,
  day: today,
  type: 'mortalite',
  affected_count: 4,
  cost: 0,
  description: 'Mort en début de journée',
});
const { effectif, mortalite } = await deriveEffectif(lot.id, 60);
console.log(`  effectif dérivé : ${effectif} (initial 60 − mortalité ${mortalite})`);
if (effectif !== 56) { console.error('  ✗ effectif attendu 56'); process.exit(1); }
console.log('  ✓ effectif = 56 (calcul UI, pas current_count en base)');

// ─── M2 : vaccin coût 10000 → juge de paix bénéfice inchangé ─
console.log('\n[M2] vaccin coût 10 000 — juge de paix');
const beneficeAvant = await fetchBenefice();
const lotCostAvant = (await fetchLotCost(lot.id)).cout_total ?? 0;
const coutSanteAvant = (await fetchLotCost(lot.id)).cout_sante ?? 0;
await sb.from('health_records').insert({
  org_id: orgId,
  lot_id: lot.id,
  day: today,
  type: 'vaccin',
  affected_count: 60,
  cost: 10000,
  description: 'Newcastle annuel',
});
const beneficeApres = await fetchBenefice();
const lotCostApres = (await fetchLotCost(lot.id)).cout_total ?? 0;
const coutSanteApres = (await fetchLotCost(lot.id)).cout_sante ?? 0;
console.log(`  bénéfice mois : ${beneficeAvant} → ${beneficeApres}`);
console.log(`  coût lot      : ${lotCostAvant} → ${lotCostApres} (santé : ${coutSanteAvant} → ${coutSanteApres})`);
if (beneficeApres !== beneficeAvant) {
  console.error(`  ✗ BÉNÉFICE A BOUGÉ : double comptage probable`);
  process.exit(1);
}
if (lotCostApres - lotCostAvant !== 10000) {
  console.error(`  ✗ coût lot devrait avoir augmenté de 10000`);
  process.exit(1);
}
if (coutSanteApres - coutSanteAvant !== 10000) {
  console.error(`  ✗ cout_sante devrait avoir augmenté de 10000`);
  process.exit(1);
}
console.log('  ✓ bénéfice INCHANGÉ, coût lot +10 000 via cout_sante. Anti-double-comptage OK.');

// ─── M3 : objectif taux_mortalite max 5 % ──────────────────
console.log('\n[M3] objectif "taux_mortalite max 5 %, mensuel"');
const { data: goal, error: gErr } = await sb.from('goals').insert({
  org_id: orgId,
  metric: 'taux_mortalite',
  target_value: 5,
  period: 'mensuel',
}).select().single();
if (gErr) { console.error('  ✗', gErr.message); process.exit(1); }
console.log('  ✓ objectif créé', goal.id.slice(0, 8));

// Calcul de la métrique tel que dans le code UI
const [mortRes, lotsRes] = await Promise.all([
  sb.from('health_records')
    .select('affected_count')
    .eq('type', 'mortalite')
    .gte('day', monthStart)
    .lte('day', monthEnd)
    .is('deleted_at', null),
  sb.from('lots').select('initial_count').is('deleted_at', null),
]);
const mort = (mortRes.data ?? []).reduce((s, r) => s + r.affected_count, 0);
const totalInitial = (lotsRes.data ?? []).reduce((s, l) => s + l.initial_count, 0);
const tauxActuel = (mort / totalInitial) * 100;
console.log(`  mortalité période : ${mort} ; initial total : ${totalInitial}`);
console.log(`  taux : ${tauxActuel.toFixed(2)} % vs cible MAX 5 %`);
if (Math.abs(tauxActuel - 6.666667) > 0.01) {
  console.error(`  ✗ taux attendu ≈ 6.67 %, reçu ${tauxActuel.toFixed(2)}`);
  process.exit(1);
}
console.log('  ✓ 6.67 % > 5 % → statut "Seuil dépassé" (inversé : sous = bon)');

// ─── M4 : édition ──────────────────────────────────────────
console.log('\n[M4] éditer la mortalité : 4 → 3');
const { data: mortRecord } = await sb
  .from('health_records')
  .select('id')
  .eq('lot_id', lot.id)
  .eq('type', 'mortalite')
  .is('deleted_at', null)
  .single();
await sb.from('health_records').update({ affected_count: 3 }).eq('id', mortRecord.id);
const eff2 = await deriveEffectif(lot.id, 60);
console.log(`  effectif après édition : ${eff2.effectif}`);
if (eff2.effectif !== 57) { console.error('  ✗ effectif attendu 57'); process.exit(1); }
console.log('  ✓ effectif recalculé à 57 (60 − 3)');

// ─── M5 : archivage du vaccin ──────────────────────────────
console.log('\n[M5] archiver le vaccin');
const { data: vaccinRecord } = await sb
  .from('health_records')
  .select('id')
  .eq('lot_id', lot.id)
  .eq('type', 'vaccin')
  .is('deleted_at', null)
  .single();
const lotCostAvantArch = (await fetchLotCost(lot.id)).cout_total ?? 0;
await sb.from('health_records').update({ deleted_at: new Date().toISOString() }).eq('id', vaccinRecord.id);
const lotCostApresArch = (await fetchLotCost(lot.id)).cout_total ?? 0;
console.log(`  coût lot : ${lotCostAvantArch} → ${lotCostApresArch}`);
if (lotCostApresArch !== lotCostAvantArch - 10000) {
  console.error('  ✗ coût lot devrait avoir diminué de 10000 (vaccin archivé)');
  process.exit(1);
}
console.log('  ✓ coût lot recalculé sans le vaccin archivé');

await sb.auth.signOut();
console.log('\n=== TEST SANTÉ PASS ===');
console.log('Effectif dérivé (initial − mortalité) : OK.');
console.log('Vaccin → coût lot +10 000, bénéfice mois inchangé (juge de paix).');
console.log('Taux mortalité : 6.67 % sur cible MAX 5 % → dépassé (statut inversé).');
console.log('Édition + archivage propagent dans les calculs dérivés.');
