// helper tampilan member — identitas asli datang dari AuthContext (features/auth/auth.tsx)
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
