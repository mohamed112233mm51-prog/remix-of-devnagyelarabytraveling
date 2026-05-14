import { supabase } from "@/integrations/supabase/client";

// Patch fetch globally so any same-origin server function call includes the
// Supabase auth bearer token automatically.
let installed = false;
export function installServerFnAuthFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: any, init: any = {}) => {
    try {
      const url = typeof input === "string" ? input : input?.url ?? "";
      const isSameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
      if (isSameOrigin) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
          if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
          init = { ...init, headers };
        }
      }
    } catch {}
    return origFetch(input, init);
  };
}
