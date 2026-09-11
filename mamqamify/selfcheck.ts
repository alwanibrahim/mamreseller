// Self-check konektor — GET endpoints + envelope shape
const BASE = "http://localhost:3001";
const MASTER = process.env.MASTER_KEY!;

let key = "";
const results: [string, boolean, string][] = [];

function check(name: string, cond: boolean, detail = "") {
  results.push([name, cond, detail]);
}

async function j(path: string, init?: RequestInit) {
  await new Promise((r) => setTimeout(r, 350)); // upstream rate limit 3 req/s
  const res = await fetch(BASE + path, init);
  let body: any = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const envelope = (b: any) =>
  b && typeof b.success === "boolean" && "data" in b && "error" in b &&
  b.meta && typeof b.meta.supplier === "string" && !isNaN(Date.parse(b.meta.timestamp));

// 0. setup: buat api key konektor (admin)
{
  const { status, body } = await j("/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${MASTER}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "selftest" }),
  });
  key = body?.data?.key?.key ?? "";
  check("POST /keys (admin, setup)", status === 200 && envelope(body) && key.startsWith("cnk_live_"), `http=${status}`);
}

const H = { authorization: `Bearer ${key}` };

// 1. GET /ping
{
  const { status, body } = await j("/ping", { headers: H });
  check("GET /ping", status === 200 && envelope(body) && body.data?.status === "up", `http=${status} data=${JSON.stringify(body?.data)?.slice(0, 120)}`);
}

// 2. GET /products
let firstId = "";
{
  const { status, body } = await j("/products", { headers: H });
  const list = body?.data?.products;
  firstId = Array.isArray(list) && list[0]?.id ? String(list[0].id) : "";
  const shape = !Array.isArray(list) || list.every((p: any) => "id" in p && "name" in p && "price" in p && "stock" in p && "orderable" in p);
  check("GET /products", status === 200 && envelope(body) && shape, `http=${status} count=${list?.length ?? 0}`);
}

// 3. GET /products/:id
{
  if (!firstId) {
    check("GET /products/:id", false, "skip: tidak ada produk");
  } else {
    const { status, body } = await j(`/products/${firstId}`, { headers: H });
    const p = body?.data?.product;
    check("GET /products/:id", status === 200 && envelope(body) && p?.id === firstId, `http=${status} id=${p?.id}`);
  }
}

// 4. GET /balance
{
  const { status, body } = await j("/balance", { headers: H });
  check("GET /balance", status === 200 && envelope(body) && typeof body?.data?.balance === "number", `http=${status} balance=${body?.data?.balance}`);
}

// 5. GET /orders
let firstOrder = "";
{
  const { status, body } = await j("/orders?limit=5", { headers: H });
  const d = body?.data;
  firstOrder = d?.orders?.[0]?.order_id ?? "";
  check("GET /orders", status === 200 && envelope(body) && Array.isArray(d?.orders) && d?.limit === 5 && d?.offset === 0, `http=${status} count=${d?.orders?.length ?? 0}`);
}

// 6. GET /orders/:id
{
  if (firstOrder) {
    const { status, body } = await j(`/orders/${firstOrder}`, { headers: H });
    check("GET /orders/:id", status === 200 && envelope(body) && body?.data?.order?.order_id === firstOrder, `http=${status} id=${body?.data?.order?.order_id}`);
  } else {
    // belum ada order → uji jalur 404 tetap bentuk envelope
    const { status, body } = await j("/orders/RA-TIDAKADA000", { headers: H });
    check("GET /orders/:id (404 path)", status === 404 && envelope(body) && body?.error?.code === "not_found", `http=${status} code=${body?.error?.code}`);
  }
}

// 7. auth tanpa key → 401
{
  const { status, body } = await j("/products");
  check("GET /products tanpa key → 401", status === 401 && envelope(body) && body?.error?.code === "unauthorized", `http=${status} code=${body?.error?.code}`);
}

let pass = 0;
for (const [name, ok, detail] of results) {
  console.log(`${ok ? "✓" : "✗"} ${name}  ${ok ? "" : detail}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${results.length} lolos`);
process.exit(pass === results.length ? 0 : 1);
