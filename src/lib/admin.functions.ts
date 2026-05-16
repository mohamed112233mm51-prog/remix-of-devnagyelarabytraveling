import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const BOOTSTRAP_EMAIL = "mohamed112233.mm51@gmail.com";
const BOOTSTRAP_PASSWORD = "nagy1420260000";

export const bootstrapAdmin = createServerFn({ method: "POST" }).handler(async () => {
  const sb = admin();

  // Always ensure the bootstrap admin auth user exists and is fully repaired.
  // Paginate listUsers — default page size (50) may miss the admin after a remix.
  async function findBootstrapUser() {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const found = data?.users.find((x) => x.email === BOOTSTRAP_EMAIL);
      if (found) return found;
      if (!data || data.users.length < 200) return null;
    }
    return null;
  }

  let authUser = await findBootstrapUser();

  if (!authUser) {
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: BOOTSTRAP_EMAIL,
      password: BOOTSTRAP_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Admin" },
    });
    if (createErr || !created?.user) {
      // Race / duplicate: user actually exists — look it up again before failing.
      const existing = await findBootstrapUser();
      if (existing) {
        authUser = existing as any;
      } else {
        throw new Error(createErr?.message ?? "Failed to create admin");
      }
    } else {
      authUser = created.user as any;
    }
  }

  const userId = authUser!.id;

  // Repair profile: active + invite accepted, regardless of prior state.
  await sb.from("profiles").upsert({
    id: userId,
    email: BOOTSTRAP_EMAIL,
    full_name: "Admin",
    is_active: true,
    invite_accepted: true,
  });

  // Repair admin role.
  await sb.from("user_roles").upsert(
    { user_id: userId, role: "admin" },
    { onConflict: "user_id,role" },
  );

  return { repaired: true };
});

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Response("Forbidden", { status: 403 });
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const { data: list } = await sb.auth.admin.listUsers();
    const { data: profiles } = await sb.from("profiles").select("*");
    const { data: roles } = await sb.from("user_roles").select("*");
    const users = (list?.users ?? []).map((u) => {
      const profile: any = profiles?.find((p: any) => p.id === u.id);
      const userRoles = roles?.filter((r) => r.user_id === u.id).map((r) => r.role) ?? [];
      return {
        id: u.id,
        email: u.email,
        full_name: profile?.full_name ?? u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        invited_at: u.invited_at,
        confirmed_at: u.confirmed_at,
        is_active: profile?.is_active ?? true,
        agent_id: profile?.agent_id ?? null,
        permissions: profile?.permissions ?? {},
        roles: userRoles,
      };
    });
    return { users };
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    email: string;
    full_name: string;
    role: "admin" | "manager" | "user";
    agent_id?: string | null;
    permissions?: Record<string, boolean>;
    origin?: string;
  }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();

    const origin = data.origin || process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/accept-invite` : undefined;

    const { data: invited, error } = await sb.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name, invited_by: context.userId },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (error || !invited?.user) {
      const { data: list } = await sb.auth.admin.listUsers();
      const existing = list?.users.find((u) => u.email === data.email);
      if (!existing) throw new Error(error?.message ?? "Invite failed");
      await sb.auth.admin.generateLink({
        type: "invite",
        email: data.email,
        ...(redirectTo ? { options: { redirectTo } } : {}),
      } as any);
    }
    const userId =
      invited?.user?.id ??
      (await sb.auth.admin.listUsers()).data.users.find((u) => u.email === data.email)?.id;
    if (!userId) throw new Error("Could not resolve user id");

    await sb.from("profiles").upsert({
      id: userId,
      email: data.email,
      full_name: data.full_name,
      is_active: false,
      invite_accepted: false,
      agent_id: data.agent_id ?? null,
      permissions: data.permissions ?? {},
      invited_by: context.userId,
    });
    await sb.from("user_roles").delete().eq("user_id", userId);
    await sb.from("user_roles").insert({ user_id: userId, role: data.role });
    return { id: userId };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; origin?: string }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const origin = data.origin || process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/accept-invite` : undefined;
    await sb.auth.admin.inviteUserByEmail(
      data.email,
      redirectTo ? { redirectTo } : undefined,
    );
    return { ok: true };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; origin?: string }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const origin = data.origin || process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/reset-password` : undefined;
    await sb.auth.resetPasswordForEmail(
      data.email,
      redirectTo ? { redirectTo } : undefined,
    );
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    await sb.auth.admin.deleteUser(data.id);
    return { ok: true };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; is_active: boolean }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    await sb.from("profiles").update({ is_active: data.is_active }).eq("id", data.id);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: "admin" | "manager" | "user" }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    await sb.from("user_roles").delete().eq("user_id", data.user_id);
    await sb.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    return { ok: true };
  });

export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    full_name?: string;
    agent_id?: string | null;
    permissions?: Record<string, boolean>;
  }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const patch: any = {};
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.agent_id !== undefined) patch.agent_id = data.agent_id;
    if (data.permissions !== undefined) patch.permissions = data.permissions;
    await sb.from("profiles").update(patch).eq("id", data.id);
    return { ok: true };
  });

// Verifies a Google-signed-in user is allowed (must have an active profile).
// If not, returns { allowed: false } and the client signs out.
export const checkAccessAllowed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    const { data: profile } = await sb.from("profiles").select("is_active").eq("id", context.userId).maybeSingle();
    if (!profile) return { allowed: false, reason: "not_invited" as const };
    if (profile.is_active === false) return { allowed: false, reason: "disabled" as const };
    return { allowed: true as const };
  });
