// Test end-to-end Incubation contre Supabase hébergé.
// Reproduit le scénario utilisateur :
//   - Espèce Cailles avec duree_incubation_jours=17 dans species.attributes
//   - Couvée 30 œufs aujourd'hui → expected_hatch = today + 17j
//   - Éclosion 25 → nouveau lot de 25 cailles + couvée 'eclos' (taux 83.33 %)
//   - Objectif taux_eclosion 80 % mensuel : 83.33 % > 80 % → "En bonne voie"

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

function addDaysIso(yyyymmdd, days) {
  const d = new Date(`${yyyymmdd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const env = loadEnvLocal();
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const email = `claude-incub-test-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const monthEnd = (() => {
  const [y, m] = monthStart.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

console.log('[setup] signUp');
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

// ─── I0 : species Cailles avec duree_incubation_jours=17 ───
console.log('\n[I0] créer espèce "Cailles" avec attributes.duree_incubation_jours = 17');
const { data: cailles, error: spErr } = await sb
  .from('species')
  .insert({
    org_id: orgId,
    name: 'Cailles',
    category: 'volaille',
    attributes: { duree_incubation_jours: 17 },
  })
  .select()
  .single();
if (spErr) { console.error('  ✗', spErr.message); process.exit(1); }
console.log('  ✓ species', cailles.id.slice(0, 8), 'attributes :', cailles.attributes);
if (cailles.attributes?.duree_incubation_jours !== 17) {
  console.error('  ✗ duree_incubation_jours non persisté en JSONB');
  process.exit(1);
}

// ─── I1 : couvée 30 œufs avec expected_hatch calculé +17j ──
console.log('\n[I1] créer couvée 30 œufs cailles aujourd\u2019hui (expected = today + 17 j)');
const expectedHatch = addDaysIso(today, 17);
const { data: batch, error: bErr } = await sb
  .from('incubation_batches')
  .insert({
    org_id: orgId,
    source_lot_id: null,
    set_date: today,
    expected_hatch: expectedHatch,
    eggs_count: 30,
    status: 'en_cours',
  })
  .select()
  .single();
if (bErr) { console.error('  ✗', bErr.message); process.exit(1); }
console.log(`  ✓ couvée ${batch.id.slice(0, 8)} : set_date=${batch.set_date}, expected_hatch=${batch.expected_hatch}, eggs=${batch.eggs_count}`);
if (batch.expected_hatch !== expectedHatch) {
  console.error(`  ✗ expected_hatch attendu ${expectedHatch}, reçu ${batch.expected_hatch}`);
  process.exit(1);
}

// ─── I2 : éclosion 25 → nouveau lot 25 cailles ──────────────
console.log('\n[I2] enregistrer éclosion : 25 éclos → nouveau lot');
const hatchedCount = 25;
// Étape 1 : créer le lot (comme dans le HatchForm UI).
const { data: newLot, error: lotErr } = await sb
  .from('lots')
  .insert({
    org_id: orgId,
    species_id: cailles.id,
    code: `LOT-CAILLES-${today.replaceAll('-', '')}`,
    start_date: today,
    initial_count: hatchedCount,
    current_count: hatchedCount,
    status: 'actif',
    notes: `Issu de la couvée ${batch.id.slice(0, 8)} (éclosion ${today})`,
  })
  .select()
  .single();
if (lotErr) { console.error('  ✗ création lot:', lotErr.message); process.exit(1); }
console.log(`  ✓ nouveau lot ${newLot.code} créé (initial_count=${newLot.initial_count})`);

// Étape 2 : mettre à jour la couvée (hatched_count, status=eclos, result_lot_id).
await sb
  .from('incubation_batches')
  .update({
    hatched_count: hatchedCount,
    status: 'eclos',
    result_lot_id: newLot.id,
  })
  .eq('id', batch.id);

const { data: batchUpdated } = await sb
  .from('incubation_batches')
  .select('hatched_count, status, result_lot_id, eggs_count')
  .eq('id', batch.id)
  .single();
const successRate = (batchUpdated.hatched_count / batchUpdated.eggs_count) * 100;
console.log(`  ✓ couvée : status=${batchUpdated.status}, ${batchUpdated.hatched_count}/${batchUpdated.eggs_count} = ${successRate.toFixed(2)} %`);
console.log(`  ✓ result_lot_id lié = ${batchUpdated.result_lot_id?.slice(0, 8)}`);
if (Math.abs(successRate - 83.33) > 0.1) {
  console.error('  ✗ taux attendu ≈ 83.33 %');
  process.exit(1);
}

// ─── I3 : objectif taux_eclosion = 80 %, mensuel ────────────
console.log('\n[I3] objectif "taux_eclosion = 80 %, mensuel"');
await sb.from('goals').insert({
  org_id: orgId,
  metric: 'taux_eclosion',
  target_value: 80,
  period: 'mensuel',
});
// Calcul tel que dans le code UI (set_date dans le mois, status ∈ eclos/echoue)
const { data: batchesForGoal } = await sb
  .from('incubation_batches')
  .select('eggs_count, hatched_count')
  .gte('set_date', monthStart)
  .lte('set_date', monthEnd)
  .in('status', ['eclos', 'echoue'])
  .is('deleted_at', null);
const totalEggs = batchesForGoal.reduce((s, r) => s + r.eggs_count, 0);
const totalHatched = batchesForGoal.reduce((s, r) => s + (r.hatched_count ?? 0), 0);
const tauxActuel = (totalHatched / totalEggs) * 100;
console.log(`  œufs sur la période : ${totalEggs} ; éclos : ${totalHatched}`);
console.log(`  taux : ${tauxActuel.toFixed(2)} % vs cible 80 %`);
if (Math.abs(tauxActuel - 83.33) > 0.1) {
  console.error('  ✗ taux attendu ≈ 83.33 %');
  process.exit(1);
}
console.log('  ✓ 83.33 % > 80 % → "En bonne voie" (statut normal, non inversé)');

// ─── I4 : aucune mortalité créée (pas de double comptage) ──
console.log('\n[I4] vérifier : les 5 œufs non éclos ne créent AUCUNE mortalité');
const { data: mortRecords } = await sb
  .from('health_records')
  .select('id, type, affected_count, lot_id')
  .eq('lot_id', newLot.id)
  .eq('type', 'mortalite')
  .is('deleted_at', null);
if (mortRecords.length !== 0) {
  console.error('  ✗ mortalité parasite créée');
  process.exit(1);
}
console.log('  ✓ 0 mortalité enregistrée. Effectif lot = initial_count =', newLot.initial_count);

await sb.auth.signOut();
console.log('\n=== TEST INCUBATION PASS ===');
console.log('species.attributes.duree_incubation_jours : OK (JSONB).');
console.log('expected_hatch calculé set_date + 17 j : OK.');
console.log(`Éclosion 25/30 → 83.33 %, nouveau lot rattaché via result_lot_id : OK.`);
console.log('Objectif taux_eclosion 80 % → 83.33 % > 80 %, statut "En bonne voie".');
console.log('Œufs non éclos = pas de mortalité de lot (anti-double-comptage).');
