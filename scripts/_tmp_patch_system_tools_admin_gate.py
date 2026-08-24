from pathlib import Path

p = Path('src/lib/demo-data.functions.ts')
s = p.read_text(encoding='utf-8')
old = '''async function ensureAdmin(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin, permissions")
    .eq("id", userId)
    .maybeSingle();
  const permissions = (profile as any)?.permissions ?? {};
  if ((profile as any)?.is_super_admin === true || permissions?.settings?.system_tools === true) return;
  throw new Response("Forbidden: settings.system_tools permission required", { status: 403 });
}
'''
new = '''async function ensureAdmin(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin, permissions")
    .eq("id", userId)
    .maybeSingle();
  if ((profile as any)?.is_super_admin === true) return;
  const permissions = (profile as any)?.permissions ?? {};
  if (permissions?.settings?.system_tools !== true) {
    throw new Response("Forbidden: settings.system_tools permission required", { status: 403 });
  }
  const { data: adminRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!adminRole) {
    throw new Response("Forbidden: system tools require the admin role", { status: 403 });
  }
}
'''
if old not in s: raise SystemExit('system tools guard block not found')
p.write_text(s.replace(old, new), encoding='utf-8')

p = Path('src/routes/settings.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace(
'  const { permissions, isSuperAdmin, loading } = useAuth();',
'  const { permissions, isAdmin, isSuperAdmin, loading } = useAuth();',
1,
)
s = s.replace(
'''  const tabs = allTabs.filter((t) => can(t.perm));''',
'''  const tabs = allTabs.filter((t) => {
    if (t.perm === "system_tools" && !isSuperAdmin && !isAdmin) return false;
    return can(t.perm);
  });''',
1,
)
p.write_text(s, encoding='utf-8')
print('system_tools aligned to explicit permission + admin role (or Super Admin)')
