import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Balance } from "./useBalances";

export type { Balance };

export type BalanceSection = {
  supplierId: string;
  supplierName: string;
  status: "ok" | "error";
  balance: Balance | null;
  error: string | null;
};

// Aturan tampilan: yang selesai duluan di atas, sisanya append di bawah.
export function useBalancesIncremental() {
  const [sections, setSections] = useState<BalanceSection[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { suppliers } = await apiFetch<{ suppliers: { id: string; name: string; active: boolean }[] }>("/api/suppliers");
      const aktif = suppliers.filter((s) => s.active);
      setSections([]);
      setPending(aktif.map((s) => s.name));
      setError(null);
      for (const s of aktif) {
        apiFetch<{ supplier_id: string; supplier_name: string; currency: string; balance: number }>(
          `/api/suppliers/${s.id}/balance`,
        )
          .then((d) => {
            setSections((prev) =>
              prev.some((sec) => sec.supplierId === s.id)
                ? prev
                : [
                    ...prev,
                    {
                      supplierId: s.id,
                      supplierName: s.name,
                      status: "ok",
                      balance: {
                        supplier_id: d.supplier_id,
                        supplier_name: d.supplier_name,
                        currency: d.currency,
                        balance: d.balance,
                        status: "up",
                        error: null,
                      },
                      error: null,
                    },
                  ],
            );
            setPending((p) => p.filter((n) => n !== s.name));
          })
          .catch((e) => {
            setSections((prev) =>
              prev.some((sec) => sec.supplierId === s.id)
                ? prev
                : [
                    ...prev,
                    {
                      supplierId: s.id,
                      supplierName: s.name,
                      status: "error",
                      balance: null,
                      error: e instanceof Error ? e.message : "gagal",
                    },
                  ],
            );
            setPending((p) => p.filter((n) => n !== s.name));
          });
      }
    } catch (e) {
      setPending([]);
      setError(e instanceof Error ? e.message : "failed to load supplier");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const balances = sections.filter((s) => s.status === "ok").map((s) => s.balance!) as Balance[];
  const loadingCount = pending.length;
  const failures = sections
    .filter((s) => s.status === "error")
    .map((s) => ({ supplier_name: s.supplierName, error: s.error ?? "gagal" }));

  return { sections, balances, pending, loadingCount, failures, error, reload };
}
