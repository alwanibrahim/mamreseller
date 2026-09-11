// Ledger dompet member — dipakai feature member (wallet), payment (fulfill), orders (pemotongan)
import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db");
db.exec(`
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_ref TEXT,
  created_at TEXT NOT NULL
);
`);
const migrations = [
  "ALTER TABLE transactions ADD COLUMN status TEXT",
  "ALTER TABLE transactions ADD COLUMN mode TEXT",
  "ALTER TABLE transactions ADD COLUMN qty INTEGER",
  "ALTER TABLE transactions ADD COLUMN supplier_id TEXT",
  "ALTER TABLE transactions ADD COLUMN product_id TEXT",
];
for (const m of migrations) {
  try {
    db.exec(m);
  } catch {}
}

export function walletBalance(userId: string): number {
  const r = db.query("SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE user_id = ?").get(userId) as any;
  return Number(r.s);
}

type TrxInput = {
  id?: string;
  type: string;
  amount: number;
  description: string;
  orderRef?: string | null;
  status?: string | null;
  mode?: string | null;
  qty?: number | null;
  supplierId?: string | null;
  productId?: string | null;
};

export function addTransaction(userId: string, t: TrxInput) {
  const id = t.id ?? `trx_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const created_at = new Date().toISOString();
  db.query(
    "INSERT INTO transactions (id, user_id, type, amount, description, order_ref, status, mode, qty, supplier_id, product_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    userId,
    t.type,
    t.amount,
    t.description,
    t.orderRef ?? null,
    t.status ?? null,
    t.mode ?? null,
    t.qty ?? null,
    t.supplierId ?? null,
    t.productId ?? null,
    created_at,
  );
  return { id, user_id: userId, ...t, created_at };
}

export function getTransaction(id: string) {
  return db.query("SELECT * FROM transactions WHERE id = ?").get(id) as any;
}

export function updateTransaction(
  id: string,
  fields: { status?: string; orderRef?: string | null; amount?: number },
) {
  const sets: string[] = [];
  const vals: any[] = [];
  if (fields.status !== undefined) {
    sets.push("status = ?");
    vals.push(fields.status);
  }
  if (fields.orderRef !== undefined) {
    sets.push("order_ref = ?");
    vals.push(fields.orderRef);
  }
  if (fields.amount !== undefined) {
    sets.push("amount = ?");
    vals.push(fields.amount);
  }
  if (!sets.length) return;
  vals.push(id);
  db.query(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function listTransactions(userId: string, limit = 100) {
  return db.query("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
}

// daftar semua user (panel admin) + saldo & jumlah order tiap user
export function listMembers() {
  return db
    .query(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              COALESCE(SUM(t.amount), 0) AS balance,
              COUNT(CASE WHEN t.type = 'order' THEN 1 END) AS orders
       FROM users u LEFT JOIN transactions t ON t.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    )
    .all();
}

// order yang sudah selesai (untuk menu Order Reseller admin)
export function listCompletedOrders(limit = 200) {
  return db
    .query(
      `SELECT t.id, u.email AS buyer, t.description AS product, t.qty, t.amount,
              t.status, t.mode, t.order_ref AS supplier_txn, t.created_at
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.type = 'order' AND t.status IN ('delivered', 'success')
       ORDER BY t.created_at DESC LIMIT ?`,
    )
    .all(limit);
}
