import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PASSENGER_MAPPING_KEY, readPassengerMapping, passengerOptionLabel, type PassengerContext, type PassengerOption } from "@/lib/passengerClassification";

export const PASSENGER_QUERY_KEY = ["passenger-classification"] as const;
export async function loadPassengerContext(): Promise<PassengerContext> {
  const options: PassengerOption[] = [];
  const settingPromise = supabase.from("app_settings").select("key,value").eq("key", PASSENGER_MAPPING_KEY).maybeSingle();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("system_dropdown_options")
      .select("id,category,value,is_active").eq("category", "passenger_type")
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    options.push(...(data || []).map(option => ({ ...option, value: passengerOptionLabel(option.value) })));
    if ((data || []).length < 1000) break;
  }
  const { data, error } = await settingPromise;
  if (error) throw error;
  return { options, mapping: readPassengerMapping(data?.value), configured: (data?.value as any)?.v?.version === 1 };
}
export function usePassengerClassification() {
  const { user, profileLoaded } = useAuth();
  const client = useQueryClient();
  const queryOptions = { queryKey: [...PASSENGER_QUERY_KEY, user?.id], queryFn: loadPassengerContext, staleTime: 30_000, retry: 1 };
  const query = useQuery({ ...queryOptions, enabled: !!user && profileLoaded });
  return {
    ...query,
    getCurrent: async (force = false) => {
      if (!user || !profileLoaded) throw new Error("انتظر تحميل جلسة المستخدم قبل تحديد نوع المسافر.");
      const result = await client.fetchQuery({ ...queryOptions, staleTime: force ? 0 : 30_000 });
      // Auth lifecycle clears the query cache; do not publish a late request after logout.
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== user.id) throw new Error("تغيرت جلسة المستخدم؛ أعد المحاولة.");
      return result;
    },
  };
}
