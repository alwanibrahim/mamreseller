import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type Supplier = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  last_ping_status: string | null;
  last_ping_at: string | null;
  active: boolean;
  created_at: string;
};

export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<{ suppliers: Supplier[] }>("/api/suppliers");
      setSuppliers(data.suppliers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "gagal memuat supplier");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { suppliers, error, reload };
}
