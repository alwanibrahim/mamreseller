import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type ResellerOrder = {
  order_id: string;
  product_name: string;
  quantity: number;
  amount: number;
  status: string;
  items: string[];
  created_at: string | null;
  supplier_id: string;
  supplier_name: string;
};

type Result = { orders: ResellerOrder[]; failures: { supplier_name: string; error: string }[]; limit: number };

export function useOrders(limit: number) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setResult(await apiFetch<Result>(`/api/orders?limit=${limit}&offset=0`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "gagal memuat order");
    }
  }, [limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { result, error, reload };
}
