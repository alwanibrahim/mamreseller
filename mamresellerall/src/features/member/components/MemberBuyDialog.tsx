import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, post } from "@/lib/api";
import type { Product } from "@/features/products/hooks/useProductsIncremental";
import { useWallet } from "../hooks/useWallet";
import { PendingPaymentNotice } from "./PendingPaymentNotice";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type OrderResult = {
  order: { order_id: string; status: string; amount: number; items: string[] };
  idempotency_key: string;
  saldo: number;
};

type QrisPayment = { id: string; amount: number; amount_idr: number; qr_url: string; checkout_url: string };

type Props = { product: Product };

export function MemberBuyDialog({ product }: Props) {
  const { balance, reload: reloadWallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OrderResult | null>(null);
  const [pendingNotice, setPendingNotice] = useState(false);

  // alur QRIS
  const [payment, setPayment] = useState<QrisPayment | null>(null);
  const [payStatus, setPayStatus] = useState<"pending" | "paid" | "expire">("pending");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const unitPrice = Number(product.sell_price ?? product.price);
  const required = unitPrice * Number(qty || 0);
  const saldoCukup = balance !== null && Number(balance) >= required;
  const stopPolling = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const reset = () => {
    stopPolling();
    setQty("1");
    setError(null);
    setDone(null);
    setPayment(null);
    setPayStatus("pending");
  };

  // bayar pakai saldo → langsung order
  async function buyWithSaldo(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<OrderResult>(
        "/api/orders",
        post("/api/orders", { supplier_id: product.supplier_id, product_id: product.id, quantity: Number(qty) }),
      );
      setDone(data);
      void reloadWallet();
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === "payment_pending") {
        setOpen(false);
        setPendingNotice(true);
      } else {
        setError(e2.message);
      }
    } finally {
      setSaving(false);
    }
  }

  // bayar pakai QRIS → top up senilai order → order otomatis setelah lunas
  async function buyWithQris() {
    setError(null);
    setSaving(true);
    try {
      const p = await apiFetch<QrisPayment>("/api/payment/qris", post("/api/payment/qris", { amount: required }));
      setPayment(p);
      setPayStatus("pending");
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === "payment_pending") {
        setOpen(false);
        setPendingNotice(true);
      } else {
        setError(e2.message);
      }
    } finally {
      setSaving(false);
    }
  }

  // polling status pembayaran QRIS
  useEffect(() => {
    if (!payment || payStatus !== "pending") return;
    timer.current = setInterval(async () => {
      try {
        const d = await apiFetch<{ paymentStatus: "paid" | "expire" | "pending" }>(`/api/payment/${payment.id}/status`);
        if (d.paymentStatus === "paid") {
          stopPolling();
          setPayStatus("paid");
          await reloadWallet();
          // saldo sudah masuk → jalankan order
          setSaving(true);
          try {
            const data = await apiFetch<OrderResult>(
              "/api/orders",
              post("/api/orders", { supplier_id: product.supplier_id, product_id: product.id, quantity: Number(qty) }),
            );
            setDone(data);
          } catch (err) {
            const e2 = err as Error & { code?: string };
            setError(e2.code === "payment_pending" ? "you have a pending transaction" : e2.message);
          } finally {
            setSaving(false);
          }
        } else if (d.paymentStatus === "expire") {
          stopPolling();
          setPayStatus("expire");
        }
      } catch {
        // polling gagal → tick berikutnya
      }
    }, 3000);
    return stopPolling;
  }, [payment, payStatus, product, qty, reloadWallet]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" disabled={!product.orderable}>
            Beli
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Buy {product.name}</DialogTitle>
            <DialogDescription>
              Price {fmtUSD.format(product.sell_price ?? product.price)}/unit
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="space-y-2 text-sm">
              <p>
                Order <span className="font-mono">{done.order.order_id}</span> —{" "}
                <span className="font-medium">{done.order.status}</span>
              </p>
              <p className="text-muted-foreground">
                Remaining balance:{" "}
                <span className="font-medium text-foreground">{fmtUSD.format(done.saldo)}</span>
              </p>
              {done.order.items.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
                  {done.order.items.map((it, i) => (
                    <p key={i} className="break-all">
                      {it}
                    </p>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : payment && payStatus === "pending" ? (
            <div className="flex flex-col items-center gap-3 py-2">
              {payment.qr_url ? (
                <img src={payment.qr_url} alt="QRIS" className="size-52 rounded-md border bg-white p-2" />
              ) : (
                <Skeleton className="size-52" />
              )}
              <p className="text-sm text-muted-foreground">Pay {fmtUSD.format(payment.amount)}</p>
              <p className="text-sm">Waiting for payment — order will be placed automatically once paid...</p>
            </div>
          ) : payStatus === "expire" ? (
            <div className="space-y-3 py-2 text-center">
              <p className="font-medium text-destructive">Payment expired</p>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setPayment(null);
                    setPayStatus("pending");
                  }}
                >
                  Try Again
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={buyWithSaldo} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="buy-qty">Quantity</Label>
                <Input
                  id="buy-qty"
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{fmtUSD.format(required)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your balance</span>
                {balance === null ? (
                  <Skeleton className="h-4 w-16" />
                ) : (
                  <span className={saldoCukup ? "font-medium" : "font-medium text-destructive"}>
                    {fmtUSD.format(balance)}
                  </span>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter className="flex flex-col gap-2 sm:flex-col">
                {saldoCukup && (
                  <Button type="submit" disabled={saving} className="w-full">
                    {saving ? "Processing..." : `Pay with Balance (${fmtUSD.format(required)})`}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={saving || required < 0.1}
                  title={required < 0.1 ? "Minimum QRIS payment is 0.1 USD" : undefined}
                  onClick={() => void buyWithQris()}
                >
                  Pay with QRIS
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <PendingPaymentNotice open={pendingNotice} onClose={() => setPendingNotice(false)} />
    </>
  );
}
