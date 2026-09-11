import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { AddSupplierDialog } from "./AddSupplierDialog";
import { SupplierTable } from "./SupplierTable";
import { useSuppliers } from "../hooks/useSuppliers";

export function SupplierPage() {
  const { suppliers, error, reload } = useSuppliers();
  const [actionError, setActionError] = useState<string | null>(null);

  async function ping(id: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/suppliers/${id}/ping`);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "ping gagal");
    }
  }

  async function remove(id: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/suppliers/${id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "hapus gagal");
    }
  }

  async function toggle(id: string, active: boolean) {
    setActionError(null);
    try {
      await apiFetch(`/api/suppliers/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) });
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "gagal mengubah status");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Supplier</CardTitle>
          <CardDescription>Kelola supplier api reseller.</CardDescription>
        </div>
        <AddSupplierDialog onAdded={reload} />
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        {!suppliers && !error && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        )}
        {suppliers && suppliers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Belum ada supplier. Klik <span className="font-medium">Add Supplier</span> untuk mulai.
          </p>
        )}
        {suppliers && suppliers.length > 0 && (
          <SupplierTable suppliers={suppliers} onPing={ping} onDelete={remove} onToggle={toggle} />
        )}
      </CardContent>
    </Card>
  );
}
