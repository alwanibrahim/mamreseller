import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth, type Role } from "@/features/auth/auth";

// member  → hanya /dashboard/*
// admin   → /dashboard/* + /dashboard/admin/*
export function RoleRoute({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null; // RequireAuth di luar sudah menangani loading awal
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
