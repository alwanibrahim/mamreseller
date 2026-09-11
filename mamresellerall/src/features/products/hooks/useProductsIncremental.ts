import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Product } from "./useProducts";

export type { Product };

export type ProductSection = {
  supplierId: string;
  supplierName: string;
  status: "ok" | "error";
  products: Product[];
  error: string | null;
};

// Fetch per-supplier. Aturan tampilan: supplier yang selesai duluan tampil di atas,
// yang belakangan ditambahkan di bawah (append-only) — tidak menggeser data lama.
export function useProductsIncremental() {
  const [sections, setSections] = useState<ProductSection[]>([]);
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
        apiFetch<{ products: Product[] }>(`/api/suppliers/${s.id}/products`)
          .then((d) => {
            // tolak duplikat (StrictMode bisa memicu reload 2x)
            setSections((prev) =>
              prev.some((sec) => sec.supplierId === s.id)
                ? prev
                : [...prev, { supplierId: s.id, supplierName: s.name, status: "ok", products: d.products, error: null }],
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
                      products: [],
                      error: e instanceof Error ? e.message : "failed to load",
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

  const products = sections.flatMap((s) => s.products);
  const loadingCount = pending.length;
  const failures = sections
    .filter((s) => s.status === "error")
    .map((s) => ({ supplier_name: s.supplierName, error: s.error ?? "failed to load" }));

  return { sections, products, pending, loadingCount, failures, error, reload };
}
