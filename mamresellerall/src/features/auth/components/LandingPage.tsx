import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, post } from "@/lib/api";
import { useAuth } from "../auth";
import { PendingPaymentNotice } from "@/features/member/components/PendingPaymentNotice";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const INTENT_KEY = "mamsell_buy_intent";

type Product = {
  id: string;
  name: string;
  price: number;
  sell_price?: number;
  stock: number;
  orderable: boolean;
  active: boolean;
  supplier_id: string;
  supplier_name: string;
};

type Intent = { supplier_id: string; product_id: string; qty: number };
type QrisPayment = { id: string; amount: number; qr_url: string };
type OrderResult = { order: { order_id: string; status: string; items: string[] }; saldo: number };

export function LandingPage() {
  const { user, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [buy, setBuy] = useState<{ product: Product; qty: string; autoQris: boolean } | null>(null);
  const [pendingNotice, setPendingNotice] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch<{ products: Product[]; failures: { error: string }[] }>(
        "/api/products",
      );
      setProducts(d.products.filter((p) => p.active && p.orderable));
      setFailures(d.failures.map((f) => f.error));
    } catch (e) {
      setFailures([e instanceof Error ? e.message : "failed to load products"]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold">mamsell</span>
        {authLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : user ? (
          <Button asChild size="sm">
            <a href="/dashboard">Go to Dashboard</a>
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href="/auth/google?next=/">Sign in with Google</a>
          </Button>
        )}
      </header>
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Digital Products</h1>
          <p className="text-sm text-muted-foreground">Digital products, ready stock. Pay with QRIS.</p>
        </div>
        {failures.map((f) => (
          <p key={f} className="text-sm text-destructive">
            {f}
          </p>
        ))}
        {!products && failures.length === 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        )}
        {products && products.length === 0 && (
          <p className="text-sm text-muted-foreground">No products yet.</p>
        )}
        {products && products.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <Card key={`${p.supplier_id}-${p.id}`} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="text-lg font-semibold">{fmtUSD.format(p.sell_price ?? p.price)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.stock === -1 ? "stok service" : `stok ${p.stock}`}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button size="sm" onClick={() => setBuy({ product: p, qty: "1", autoQris: false })}>
                    Buy
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>
      {buy && (
        <LandingBuyDialog
          buy={buy}
          loggedIn={!!user}
          onClose={() => setBuy(null)}
          onPending={() => {
            setBuy(null);
            setPendingNotice(true);
          }}
        />
      )}
      <PendingPaymentNotice open={pendingNotice} onClose={() => setPendingNotice(false)} />
    </div>
  );
}

function LandingBuyDialog({
  buy,
  loggedIn,
  onClose,
  onPending,
}: {
  buy: { product: Product; qty: string; autoQris: boolean };
  loggedIn: boolean;
  onClose: () => void;
  onPending: () => void;
}) {
  const { product } = buy;
  const [qty, setQty] = useState(buy.qty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<QrisPayment | null>(null);
  const [paid, setPaid] = useState<OrderResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const required = Number(product.sell_price ?? product.price) * Number(qty || 0);

  const stopPolling = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  function checkoutWithQris() {
    if (!loggedIn) {
      // simpan niat beli → login Google → balik ke / → QRIS langsung muncul
      sessionStorage.setItem(
        INTENT_KEY,
        JSON.stringify({ supplier_id: product.supplier_id, product_id: product.id, qty: Number(qty || 1) }),
      );
      window.location.href = "/auth/google?next=/";
      return;
    }
    void createQris(Number(qty || 1));
  }

  async function createQris(q: number) {
    setSaving(true);
    setError(null);
    try {
      const p = await apiFetch<QrisPayment>(
        "/api/payment/qris",
        post("/api/payment/qris", { amount: Number(product.sell_price ?? product.price) * q }),
      );
      setPayment(p);
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === "payment_pending") onPending();
      else setError(e2.message);
    } finally {
      setSaving(false);
    }
  }

  // setelah login balik ke / → intent tersimpan → langsung bikin QRIS
  useEffect(() => {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw || !loggedIn) return;
    sessionStorage.removeItem(INTENT_KEY);
    try {
      const it = JSON.parse(raw) as Intent;
      setQty(String(it.qty));
      void createQris(it.qty);
    } catch {
      sessionStorage.removeItem(INTENT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  // polling status QRIS → lunas → order
  useEffect(() => {
    if (!payment) return;
    timer.current = setInterval(async () => {
      try {
        const d = await apiFetch<{ paymentStatus: "paid" | "expire" | "pending" }>(`/api/payment/${payment.id}/status`);
        if (d.paymentStatus === "paid") {
          stopPolling();
          setSaving(true);
          try {
            const data = await apiFetch<OrderResult>(
              "/api/orders",
              post("/api/orders", { supplier_id: product.supplier_id, product_id: product.id, quantity: Number(qty) }),
            );
            setPaid(data);
          } catch (err) {
            setError(err instanceof Error ? err.message : "order gagal");
          } finally {
            setSaving(false);
          }
        } else if (d.paymentStatus === "expire") {
          stopPolling();
          setError("Payment expired — try again.");
          setPayment(null);
        }
      } catch {
        // polling gagal → tick berikutnya
      }
    }, 3000);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Buy {product.name}</DialogTitle>
          <DialogDescription>
            {fmtUSD.format(product.sell_price ?? product.price)}/unit
          </DialogDescription>
        </DialogHeader>
        {paid ? (
          <div className="space-y-2 text-sm">
            <p>
              Order <span className="font-mono">{paid.order.order_id}</span> —{" "}
              <span className="font-medium">{paid.order.status}</span>
            </p>
            {paid.order.items.length > 0 && (
              <div className="max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
                {paid.order.items.map((it, i) => (
                  <p key={i} className="break-all">
                    {it}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : payment ? (
          <div className="flex flex-col items-center gap-3 py-2">
            {payment.qr_url ? (
              <img src={payment.qr_url} alt="QRIS" className="size-52 rounded-md border bg-white p-2" />
            ) : (
              <Skeleton className="size-52" />
            )}
            <p className="text-sm text-muted-foreground">Pay {fmtUSD.format(payment.amount)}</p>
            <p className="text-sm">Waiting for payment — order will be placed automatically once paid...</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {!loggedIn && (
              <p className="rounded-md border border-amber-500/50 p-2 text-xs">
                You're not signed in yet. Click <span className="font-medium">Pay with QRIS</span> → sign in with Google → the QRIS
                will appear right away.
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="land-qty">Quantity</Label>
              <Input
                id="land-qty"
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={saving || !!payment}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-medium">{fmtUSD.format(required)}</span>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="flex flex-col gap-2 sm:flex-col">
              <Button
                className="w-full"
                disabled={saving || required < 0.1}
                title={required < 0.1 ? "Minimum QRIS payment is 0.1 USD" : undefined}
                onClick={checkoutWithQris}
              >
                {saving ? "Processing..." : "Pay with QRIS"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
