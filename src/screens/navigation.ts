// Type partagé entre AppShell (qui détient le state) et les écrans qui
// veulent déclencher une navigation (notamment le tableau de bord cliquable).
// Extrait dans son propre fichier pour éviter une dépendance circulaire
// entre AppShell.tsx et DashboardScreen.tsx.
export type View = 'dashboard' | 'catalogue' | 'lots' | 'production' | 'finances';
