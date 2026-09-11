import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/auth";
import { MemberOverviewPage } from "@/features/member/components/MemberOverviewPage";

// /dashboard: member → overview member, admin → langsung ke menu admin
export function DashboardIndex() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === "admin") return <Navigate to="/dashboard/admin/supplier" replace />;
  return <MemberOverviewPage />;
}
