import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  orderable: boolean;
  supplier_id: string;
  supplier_name: string;
  active: boolean;
  profit_percent: number;
  sell_price: number;
};

type Result = { products: Product[]; failures: { supplier_name: string; error: string }[] };

export function useProducts() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setResult(await apiFetch<Result>("/api/products"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load products");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { result, error, reload };
}
