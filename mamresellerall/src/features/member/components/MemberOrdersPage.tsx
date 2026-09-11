import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useWallet } from "../hooks/useWallet";

type Delivery = { loading: boolean; items: string[]; error: string | null };

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtIDR = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function MemberOrdersPage() {
  const { transactions, pendingPayment, loading, error, reload } = useWallet();
  const [canceling, setCanceling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);

  function openDetail(trx: string) {
    setDetail(trx);
    setDelivery({ loading: true, items: [], error: null });
    apiFetch<{ items: string[] }>(`/api/order-delivery?trx=${encodeURIComponent(trx)}`)
      .then((d) => setDelivery({ loading: false, items: d.items, error: null }))
      .catch((e) => setDelivery({ loading: false, items: [], error: e instanceof Error ? e.message : "gagal" }));
  }

  async function cancelPending() {
    if (!pendingPayment) return;
    setCanceling(true);
    setActionError(null);
    try {
      await apiFetch(`/api/payment/${pendingPayment.id}/cancel`, { method: "POST" });
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "failed to cancel");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="space-y-4">
      {pendingPayment && (
        <Card className="border-amber-500/50">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Badge variant="secondary">pending</Badge> Top up transaction
              </CardTitle>
              <CardDescription>
                {fmtUSD.format(pendingPayment.amount)} = {fmtIDR.format(pendingPayment.amount_idr)} · created{" "}
                {new Date(pendingPayment.created_at).toLocaleString()} · expires in 10 minutes
              </CardDescription>
            </div>
            <Button variant="destructive" size="sm" disabled={canceling} onClick={() => void cancelPending()}>
              {canceling ? "Cancelling..." : "Cancel"}
            </Button>
          </CardHeader>
          {actionError && (
            <CardContent>
              <p className="text-sm text-destructive">{actionError}</p>
            </CardContent>
          )}
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Order</CardTitle>
          <CardDescription>Your order and top up history.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          )}
          {!loading && transactions.length === 0 && !pendingPayment && (
            <p className="text-sm text-muted-foreground">
              No activity yet. Top up your balance then buy a product.
            </p>
          )}
          {transactions.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      {t.type === "topup" ? <Badge>top up</Badge> : <Badge variant="secondary">order</Badge>}
                    </TableCell>
                    <TableCell className="font-medium">{t.description}</TableCell>
                    <TableCell className={t.amount >= 0 ? "font-medium" : "font-medium text-destructive"}>
                      {t.amount >= 0 ? "+" : ""}
                      {fmtUSD.format(t.amount)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.type === "order" && t.order_ref && (
                        <Button variant="outline" size="sm" onClick={() => openDetail(t.id)}>
                          Detail
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Data Delivery</DialogTitle>
              </DialogHeader>
              {delivery?.loading && <Skeleton className="h-16 w-full" />}
              {delivery?.error && <p className="rounded-md border p-2 text-xs text-destructive">{delivery.error}</p>}
              {delivery && !delivery.loading && !delivery.error && delivery.items.length === 0 && (
                <p className="rounded-md border p-2 text-xs text-muted-foreground">
                  No delivery data for this order yet.
                </p>
              )}
              {delivery && !delivery.loading && !delivery.error && delivery.items.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs">
                  {delivery.items.map((it, i) => (
                    <p key={i} className="break-all">
                      {it}
                    </p>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
