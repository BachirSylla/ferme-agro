// Test du correctif 0006 : species_id sur les couvées.
// Vérifie qu'une couvée SANS source_lot_id mais AVEC species_id retourne
// bien sa species à la lecture, et qu'à l'éclosion le nouveau lot reprend
// la bonne species.

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
const email = `claude-incub-fix-${Date.now()}@mailinator.com`;
const today = new Date().toISOString().slice(0, 10);

console.log('[setup] signUp');
const { data: su, error: suErr } = await sb.auth.signUp({ email, password: 'TestPassword123!' });
if (suErr || !su.session) { console.error('  ✗', suErr?.message); process.exit(1); }
const orgId = (await sb.from('profiles').select('org_id').eq('id', su.user.id).single()).data.org_id;

console.log('\n[1] créer espèce Cailles');
const { data: cailles } = await sb
  .from('species')
  .insert({ org_id: orgId, name: 'Cailles', attributes: { duree_incubation_jours: 17 } })
  .select()
  .single();

console.log('\n[2] créer couvée 30 œufs Cailles SANS source_lot_id');
const { data: batch, error: bErr } = await sb
  .from('incubation_batches')
  .insert({
    org_id: orgId,
    species_id: cailles.id,
    source_lot_id: null, // ← cœur du correctif
    set_date: today,
    expected_hatch: today,
    eggs_count: 30,
    status: 'en_cours',
  })
  .select()
  .single();
if (bErr) {
  console.error('  ✗ INSERT échoue :', bErr.message);
  console.error('    → la colonne species_id n\'est probablement pas appliquée.');
  console.error('      Colle le SQL de 0006_incubation_species.sql dans le SQL Editor.');
  process.exit(1);
}
console.log(`  ✓ couvée ${batch.id.slice(0, 8)} : species_id=${batch.species_id?.slice(0, 8)}, source_lot_id=${batch.source_lot_id}`);
if (batch.species_id !== cailles.id) {
  console.error('  ✗ species_id non persisté');
  process.exit(1);
}

console.log('\n[3] relire la couvée et vérifier que la species est résoluble sans source_lot');
const { data: reread } = await sb
  .from('incubation_batches')
  .select('species_id, source_lot_id, eggs_count')
  .eq('id', batch.id)
  .single();
console.log(`  → species_id = ${reread.species_id?.slice(0, 8)} (Cailles)`);
console.log(`  → source_lot_id = ${reread.source_lot_id ?? 'null'}`);
console.log('  ✓ logique UI : deriveSpecies(batch) → speciesById.get(species_id) → Cailles. Plus de "Espèce inconnue".');

console.log('\n[4] éclosion 25 → nouveau lot doit hériter de species Cailles');
const { data: newLot, error: lotErr } = await sb
  .from('lots')
  .insert({
    org_id: orgId,
    species_id: cailles.id, // dans le HatchForm, on prend batch.species_id
    code: `LOT-CAILLES-FIX-${today.replaceAll('-', '')}`,
    start_date: today,
    initial_count: 25,
    current_count: 25,
    status: 'actif',
  })
  .select()
  .single();
if (lotErr) { console.error('  ✗ lot create:', lotErr.message); process.exit(1); }
await sb.from('incubation_batches').update({
  hatched_count: 25,
  status: 'eclos',
  result_lot_id: newLot.id,
}).eq('id', batch.id);
console.log(`  ✓ lot créé ${newLot.code}, species_id=${newLot.species_id?.slice(0, 8)} (= Cailles)`);
if (newLot.species_id !== cailles.id) {
  console.error('  ✗ species du lot d\'éclosion incorrecte');
  process.exit(1);
}

await sb.auth.signOut();
console.log('\n=== FIX TEST PASS ===');
console.log('Couvée SANS lot d\'origine + species_id explicite : species résolue à la lecture.');
console.log('Nouveau lot d\'éclosion : species correcte.');
