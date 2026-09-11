import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type Balance = {
  supplier_id: string;
  supplier_name: string;
  currency: string;
  balance: number | null;
  status: string;
  error: string | null;
};

export function useBalances() {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<{ balances: Balance[] }>("/api/balances");
      setBalances(data.balances);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load balance");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { balances, error, reload };
}
