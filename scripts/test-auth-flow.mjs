// Test end-to-end de l'inscription contre le projet Supabase hébergé.
// Prouve que :
//   1. signUp ouvre une session immédiate (Confirm email désactivé)
//   2. le trigger handle_new_user a créé une ligne organizations + profiles
//   3. RLS + GRANT laissent l'utilisateur lire son propre profil et sa ferme
//
// À lancer après avoir renseigné .env.local :
//   node scripts/test-auth-flow.mjs
//
// NB : le compte créé n'est PAS supprimé (pas de service_role en local).
// Sans risque sécurité : l'email est unique par run, RLS isole chaque ferme.

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('Manque VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY dans .env.local');
  process.exit(1);
}

const supabase = createClient(url, anon);
const testEmail = `claude-ferme-test-${Date.now()}@mailinator.com`;
const testPassword = 'TestPassword123!';

console.log(`[1/4] signUp ${testEmail}`);
const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
  email: testEmail,
  password: testPassword,
});
if (signUpErr) {
  console.error('  ✗ signUp error:', signUpErr.message);
  process.exit(1);
}
if (!signUpData.session) {
  console.error('  ✗ pas de session immédiate — "Confirm email" est-il activé dans Auth ?');
  process.exit(1);
}
console.log('  ✓ session ouverte pour user', signUpData.user.id);

console.log('[2/4] lecture profiles (RLS + GRANT)');
const { data: profile, error: profileErr } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', signUpData.user.id)
  .single();
if (profileErr || !profile) {
  console.error('  ✗ profile:', profileErr?.message ?? 'aucune ligne');
  process.exit(1);
}
console.log('  ✓ profile:', {
  id: profile.id,
  org_id: profile.org_id,
  role: profile.role,
});

console.log('[3/4] lecture organizations (RLS + GRANT)');
const { data: organization, error: orgErr } = await supabase
  .from('organizations')
  .select('*')
  .eq('id', profile.org_id)
  .single();
if (orgErr || !organization) {
  console.error('  ✗ organization:', orgErr?.message ?? 'aucune ligne');
  process.exit(1);
}
console.log('  ✓ organization:', {
  id: organization.id,
  name: organization.name,
  color_primary: organization.color_primary,
  currency: organization.currency,
});

if (organization.name !== 'Ferme') {
  console.error(`  ✗ org name attendu "Ferme", reçu "${organization.name}"`);
  process.exit(1);
}
if (profile.role !== 'proprietaire') {
  console.error(`  ✗ role attendu "proprietaire", reçu "${profile.role}"`);
  process.exit(1);
}

console.log('[4/4] signOut');
const { error: signOutErr } = await supabase.auth.signOut();
if (signOutErr) {
  console.error('  ✗ signOut:', signOutErr.message);
  process.exit(1);
}
console.log('  ✓ session fermée');

console.log('\n=== TEST PASS ===');
console.log('handle_new_user a bien créé org "Ferme" + profile proprietaire.');
console.log('RLS et GRANT laissent l\'utilisateur lire sa propre ligne.');
