// Auth: users + sessions + Google OAuth + /api/me
import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH ?? "mamreseller.db");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const meta = () => ({ supplier: "mamresellerall", timestamp: new Date().toISOString() });
const ok = (data: unknown) => Response.json({ success: true, data, error: null, meta: meta() });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const SESSION_DAYS = 30;

const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function findUser(id: string) {
  return db.query("SELECT id, name, email, role, created_at FROM users WHERE id = ?").get(id) as any;
}

// Admin ditentukan lewat daftar email di .env (ADMIN_EMAILS), dipisah koma/spasi
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(/[,\s;]+/)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// role disinkronkan tiap login: ada di daftar → admin, tidak → member
function upsertUser(name: string, email: string) {
  const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "member";
  const existing = db.query("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (existing) {
    if (existing.role !== role)
      db.query("UPDATE users SET role = ? WHERE id = ?").run(role, existing.id);
    return findUser(existing.id);
  }
  const id = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  db.query("INSERT INTO users (id, name, email, password, role, created_at) VALUES (?,?,?,NULL,?,?)")
    .run(id, name || email, email, role, new Date().toISOString());
  return findUser(id);
}

function createSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.query("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)")
    .run(token, userId, expires, new Date().toISOString());
  return token;
}

const sessionCookie = (token: string) =>
  `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`;

function redirect(uri: string, cookie?: string | string[]) {
  const headers = new Headers({ location: uri });
  const cookies = cookie ? (Array.isArray(cookie) ? cookie : [cookie]) : [];
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

// next tujuan setelah login — hanya path internal ("/...") agar tidak jadi pintu redirect terbuka
function safeNext(req: Request): string {
  const n = new URL(req.url).searchParams.get("next") ?? "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

// user yang sedang login dari cookie session (null jika belum/tidak valid)
export function currentUser(req: Request) {
  const token = getCookie(req, "session");
  if (!token) return null;
  const row = db
    .query(
      "SELECT u.id, u.name, u.email, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?",
    )
    .get(token, new Date().toISOString()) as any;
  return row ?? null;
}

export const authRoutes = {
  // Mulai OAuth Google
  "/auth/google": {
    async GET(req: Request) {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
        return redirect("/login?error=google_belum_dikonfigurasi");
      const origin = new URL(req.url).origin;
      const state = randomToken();
      const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorize.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", `${origin}/auth/google/callback`);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", "openid email profile");
      authorize.searchParams.set("state", state);
      return redirect(authorize.toString(), [
        `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`,
        `oauth_next=${encodeURIComponent(safeNext(req))}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`,
      ]);
    },
  },

  // Callback Google → tukar code → upsert user → session
  "/auth/google/callback": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state || state !== getCookie(req, "oauth_state"))
        return redirect("/login?error=state_tidak_valid");
      try {
        const origin = url.origin;
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: `${origin}/auth/google/callback`,
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(15000),
        });
        const tk: any = await tokenRes.json();
        if (!tk?.id_token) return redirect("/login?error=google_token_gagal");
        const payload = JSON.parse(
          Buffer.from(tk.id_token.split(".")[1], "base64url").toString("utf8"),
        );
        const user = upsertUser(String(payload.name ?? ""), String(payload.email ?? ""));
        const token = createSession(user.id);
        return redirect(getCookie(req, "oauth_next") || "/dashboard", sessionCookie(token));
      } catch {
        return redirect("/login?error=google_callback_gagal");
      }
    },
  },

  // ponytail: login dev tanpa Google — hanya aktif kalau GOOGLE_CLIENT_ID kosong. Hapus saat OAuth live.
  "/auth/dev-login": {
    async GET(req: Request) {
      if (GOOGLE_CLIENT_ID) return redirect("/login?error=dev_login_mati");
      const url = new URL(req.url);
      const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect("/login?error=email_tidak_valid");
      const user = upsertUser(url.searchParams.get("name") ?? "", email);
      const token = createSession(user.id);
      return redirect(safeNext(req), sessionCookie(token));
    },
  },

  "/api/me": {
    async GET(req: Request) {
      const user = currentUser(req);
      return ok({ user });
    },
  },

  "/api/auth/logout": {
    async POST(req: Request) {
      const token = getCookie(req, "session");
      if (token) db.query("DELETE FROM sessions WHERE token = ?").run(token);
      return new Response(null, {
        status: 204,
        headers: { "set-cookie": "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" },
      });
    },
  },
};
