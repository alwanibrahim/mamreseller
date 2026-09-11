import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useWallet } from "../hooks/useWallet";
import { PendingPaymentNotice } from "./PendingPaymentNotice";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtIDR = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

type QrisPayment = {
  id: string;
  amount: number;
  amount_idr: number;
  qr_url: string;
  checkout_url: string;
  status: "pending";
};

export function MemberSaldoPage() {
  const { balance, loading, error, reload } = useWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  const [creating, setCreating] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [payment, setPayment] = useState<QrisPayment | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid" | "expire">("pending");
  const [pendingNotice, setPendingNotice] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  // polling status tiap 3 detik sampai bukan pending
  useEffect(() => {
    if (!payment || paymentStatus !== "pending") return;
    timer.current = setInterval(async () => {
      try {
        const d = await apiFetch<{ status: string; paymentStatus: "paid" | "expire" | "pending"; balance: number }>(
          `/api/payment/${payment.id}/status`,
        );
        if (d.paymentStatus !== "pending") {
          stopPolling();
          setPaymentStatus(d.paymentStatus);
          if (d.paymentStatus === "paid") await reload();
        }
      } catch {
        // polling gagal → tunggu tick berikutnya
      }
    }, 3000);
    return stopPolling;
  }, [payment, paymentStatus, reload]);

  const reset = () => {
    stopPolling();
    setPayment(null);
    setPaymentStatus("pending");
    setDialogError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setDialogError(null);
    try {
      const p = await apiFetch<QrisPayment>("/api/payment/qris", post("/api/payment/qris", { amount: Number(amount) }));
      setPayment(p);
      setPaymentStatus("pending");
    } catch (err) {
      const e2 = err as Error & { code?: string };
      if (e2.code === "payment_pending") {
        setOpen(false);
        setPendingNotice(true);
      } else {
        setDialogError(e2.message);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Balance</CardTitle>
          <CardDescription>Wallet for buying products. Top up via QRIS.</CardDescription>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button>Add Balance</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Balance</DialogTitle>
              <DialogDescription>Scan the QRIS — expires in 10 minutes.</DialogDescription>
            </DialogHeader>
            {!payment ? (
              <form
                onSubmit={(e) => {
                  void submit(e);
                }}
                className="grid gap-4"
              >
                <div className="grid gap-2">
                  <Label htmlFor="topup-amount">Amount (USD, min 0.1)</Label>
                  <Input
                    id="topup-amount"
                    type="number"
                    min="0.1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
                {dialogError && <p className="text-sm text-destructive">{dialogError}</p>}
                <DialogFooter>
                  <Button type="submit" disabled={creating}>
                    {creating ? "Creating QRIS..." : "Create QRIS"}
                  </Button>
                </DialogFooter>
              </form>
            ) : paymentStatus === "pending" ? (
              <div className="flex flex-col items-center gap-3 py-2">
                {payment.qr_url ? (
                  <img src={payment.qr_url} alt="QRIS" className="size-52 rounded-md border bg-white p-2" />
                ) : (
                  <Skeleton className="size-52" />
                )}
                <p className="text-sm text-muted-foreground">
                  {fmtUSD.format(payment.amount)} = {fmtIDR.format(payment.amount_idr)}
                </p>
                <p className="text-sm">Waiting for payment...</p>
                {payment.checkout_url && (
                  <Button asChild variant="outline" size="sm">
                    <a href={payment.checkout_url} target="_blank" rel="noreferrer">
                      Open payment page
                    </a>
                  </Button>
                )}
              </div>
            ) : paymentStatus === "paid" ? (
              <div className="space-y-3 py-2 text-center">
                <p className="font-medium">Payment received</p>
                <p className="text-sm text-muted-foreground">Balance increased by {fmtUSD.format(payment.amount)}.</p>
                <DialogFooter>
                  <Button onClick={() => setOpen(false)}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-3 py-2 text-center">
                <p className="font-medium text-destructive">Payment expired</p>
                <p className="text-sm text-muted-foreground">Try again with a new QRIS.</p>
                <DialogFooter>
                  <Button onClick={reset}>Try Again</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {pageError && <p className="text-sm text-destructive">{pageError}</p>}
        {loading ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <p className="text-4xl font-bold tracking-tight">{fmtUSD.format(balance ?? 0)}</p>
        )}
      </CardContent>
      <PendingPaymentNotice open={pendingNotice} onClose={() => setPendingNotice(false)} />
    </Card>
  );
}
