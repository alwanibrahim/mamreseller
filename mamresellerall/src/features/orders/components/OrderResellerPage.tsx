import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type ProductData = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  orderable: boolean;
};

type CompletedOrder = {
  supplier_name: string;
  supplier_id: string;
  product: string;
  qty: number;
  amount: number;
  status: string;
  supplier_txn: string;
  created_at: string;
  product_data: ProductData | null;
  items: string[];
};

export function OrderResellerPage() {
  const [orders, setOrders] = useState<CompletedOrder[] | null>(null);
  const [failures, setFailures] = useState<{ supplier_name: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ product: ProductData; items: string[] } | null>(null);
  const [delivery, setDelivery] = useState<{ loading: boolean; items: string[]; error: string | null } | null>(null);

  // delivery kosong → ambil per-order dari supplier (mis. qamify tak memuat items di list)
  useEffect(() => {
    if (!detail || detail.items.length > 0) return;
    const row = orders?.find((o) => o.product_data === detail.product);
    if (!row?.supplier_id || !row.supplier_txn) return;
    setDelivery({ loading: true, items: [], error: null });
    apiFetch<{ items: string[] }>(
      `/api/admin/order-delivery?supplier_id=${row.supplier_id}&txn=${encodeURIComponent(row.supplier_txn)}`,
    )
      .then((d) => setDelivery({ loading: false, items: d.items, error: null }))
      .catch((e) => setDelivery({ loading: false, items: [], error: e instanceof Error ? e.message : "gagal" }));
  }, [detail, orders]);

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch<{ orders: CompletedOrder[]; failures: { supplier_name: string; error: string }[] }>(
        "/api/admin/order-reseller",
      );
      setOrders(d.orders);
      setFailures(d.failures);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "gagal memuat order");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Order Reseller</CardTitle>
            <CardDescription>Transaksi order yang sudah selesai (delivered) dari semua supplier.</CardDescription>
          </div>
          <button
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => void reload()}
          >
            Refresh
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {failures.map((f) => (
            <p key={f.supplier_name} className="text-sm text-destructive">
              {f.supplier_name}: {f.error}
            </p>
          ))}
          {!orders && !error && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          )}
          {orders && orders.length === 0 && (
            <p className="text-sm text-muted-foreground">Belum ada order selesai.</p>
          )}
          {orders && orders.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transaksi ID Supplier</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead className="text-right">Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={`${o.supplier_name}-${o.supplier_txn}`}>
                    <TableCell>
                      <Badge variant="secondary">{o.supplier_name}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-medium">{o.product}</TableCell>
                    <TableCell>{o.qty}</TableCell>
                    <TableCell className="font-medium">{fmtUSD.format(o.amount)}</TableCell>
                  <TableCell>
                    {o.status === "delivered" ? (
                      <Badge>{o.status}</Badge>
                    ) : o.status === "processing" ? (
                      <Badge variant="secondary">{o.status}</Badge>
                    ) : (
                      <Badge variant="destructive">{o.status}</Badge>
                    )}
                  </TableCell>
                    <TableCell className="font-mono text-xs">{o.supplier_txn}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.created_at ? new Date(o.created_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!o.product_data}
                        onClick={() => o.product_data && setDetail({ product: o.product_data, items: o.items })}
                      >
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Data Delivery</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              {(() => {
                const live = delivery && !delivery.loading && delivery.items.length > 0 ? delivery.items : detail.items;
                if (delivery?.loading)
                  return <Skeleton className="h-16 w-full" />;
                if (delivery?.error)
                  return <p className="rounded-md border p-2 text-xs text-destructive">{delivery.error}</p>;
                if (live.length === 0)
                  return (
                    <p className="rounded-md border p-2 text-xs text-muted-foreground">
                      Belum ada data delivery untuk order ini.
                    </p>
                  );
                return (
                  <div className="max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs">
                    {live.map((it, i) => (
                      <p key={i} className="break-all">
                        {it}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
