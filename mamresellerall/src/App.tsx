import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "../styles/globals.css";
import { AuthProvider, RequireAuth } from "@/features/auth/auth";
import { LandingPage } from "@/features/auth/components/LandingPage";
import { LoginPage } from "@/features/auth/components/LoginPage";
import { DashboardLayout } from "@/features/dashboard/DashboardLayout";
import { DashboardIndex } from "@/features/dashboard/DashboardIndex";
import { RoleRoute } from "@/features/dashboard/RoleRoute";
import { SupplierPage } from "@/features/supplier/components/SupplierPage";
import { ProductPage } from "@/features/products/components/ProductPage";
import { BalancePage } from "@/features/balance/components/BalancePage";
import { OrderResellerPage } from "@/features/orders/components/OrderResellerPage";
import { AdminOrderBuyerPage } from "@/features/orders/components/AdminOrderBuyerPage";
import { AdminOverviewPage } from "@/features/dashboard/components/AdminOverviewPage";
import { AdminMembersPage } from "@/features/member/components/AdminMembersPage";
import { MemberOverviewPage } from "@/features/member/components/MemberOverviewPage";
import { MemberProductsPage } from "@/features/member/components/MemberProductsPage";
import { MemberSaldoPage } from "@/features/member/components/MemberSaldoPage";
import { MemberOrdersPage } from "@/features/member/components/MemberOrdersPage";
import { ProfilePage } from "@/features/member/components/ProfilePage";

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardLayout />
              </RequireAuth>
            }
          >
            {/* member: semua role boleh */}
            <Route index element={<DashboardIndex />} />
          <Route
            path="products"
            element={
              <RoleRoute allow={["member", "admin"]}>
                <MemberProductsPage />
              </RoleRoute>
            }
          />
          <Route
            path="saldo"
            element={
              <RoleRoute allow={["member", "admin"]}>
                <MemberSaldoPage />
              </RoleRoute>
            }
          />
          <Route
            path="orders"
            element={
              <RoleRoute allow={["member", "admin"]}>
                <MemberOrdersPage />
              </RoleRoute>
            }
          />
          <Route
            path="profile"
            element={
              <RoleRoute allow={["member", "admin"]}>
                <ProfilePage />
              </RoleRoute>
            }
          />
            {/* admin only */}
            <Route
              path="admin"
              element={
                <RoleRoute allow={["admin"]}>
                  <Navigate to="overview" replace />
                </RoleRoute>
              }
            />
            <Route
              path="admin/overview"
              element={
                <RoleRoute allow={["admin"]}>
                  <AdminOverviewPage />
                </RoleRoute>
              }
            />
            <Route
              path="admin/members"
              element={
                <RoleRoute allow={["admin"]}>
                  <AdminMembersPage />
                </RoleRoute>
              }
            />
            <Route
              path="admin/supplier"
              element={
                <RoleRoute allow={["admin"]}>
                  <SupplierPage />
                </RoleRoute>
              }
            />
            <Route
              path="admin/product"
              element={
                <RoleRoute allow={["admin"]}>
                  <ProductPage />
                </RoleRoute>
              }
            />
            <Route
              path="admin/balance"
              element={
                <RoleRoute allow={["admin"]}>
                  <BalancePage />
                </RoleRoute>
              }
            />
          <Route
            path="admin/order-reseller"
            element={
              <RoleRoute allow={["admin"]}>
                <OrderResellerPage />
              </RoleRoute>
            }
          />
          <Route
            path="admin/order-buyer"
            element={
              <RoleRoute allow={["admin"]}>
                <AdminOrderBuyerPage />
              </RoleRoute>
            }
          />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
