import { useCallback, useEffect, useState } from "react";
import { apiFetch, post } from "@/lib/api";

export type WalletTransaction = {
  id: string;
  user_id: string;
  type: "topup" | "order";
  amount: number;
  description: string;
  order_ref: string | null;
  created_at: string;
};

export type PendingPayment = {
  id: string;
  amount: number;
  amount_idr: number;
  qr_url: string;
  checkout_url: string;
  created_at: string;
} | null;

export function useWallet() {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const d = await apiFetch<{
        balance: number;
        transactions: WalletTransaction[];
        pending_payment: PendingPayment;
      }>("/api/wallet");
      setBalance(d.balance);
      setTransactions(d.transactions);
      setPendingPayment(d.pending_payment);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { balance, transactions, pendingPayment, loading, error, reload };
}
