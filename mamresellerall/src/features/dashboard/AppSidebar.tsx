import { ClipboardList, LayoutDashboard, Package, ReceiptText, ShoppingCart, Store, User, Users, Wallet } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/features/auth/auth";
import { initials } from "@/features/member/member";

type Item = { title: string; url: string; icon: typeof Package; end: boolean };

// Sidebar member: 4 menu
const memberItems: Item[] = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard, end: true },
  { title: "Products", url: "/dashboard/products", icon: Package, end: false },
  { title: "Balance", url: "/dashboard/saldo", icon: Wallet, end: false },
  { title: "Orders", url: "/dashboard/orders", icon: ShoppingCart, end: false },
  { title: "Profile", url: "/dashboard/profile", icon: User, end: false },
];

// Sidebar admin: Overview paling atas + menu lain
const adminItems: Item[] = [
  { title: "Overview", url: "/dashboard/admin/overview", icon: LayoutDashboard, end: false },
  { title: "Members", url: "/dashboard/admin/members", icon: Users, end: false },
  { title: "Supplier", url: "/dashboard/admin/supplier", icon: Store, end: false },
  { title: "Products", url: "/dashboard/admin/product", icon: Package, end: false },
  { title: "Balance", url: "/dashboard/admin/balance", icon: Wallet, end: false },
  { title: "Order Reseller", url: "/dashboard/admin/order-reseller", icon: ClipboardList, end: false },
  { title: "Order Buyer", url: "/dashboard/admin/order-buyer", icon: ReceiptText, end: false },
];

function SidebarShell({ label, items }: { label: string; items: Item[] }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold">mamsell</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.end}
                      className={({ isActive }) => (isActive ? "font-medium" : undefined)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-md border p-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {initials(user?.name ?? "?")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <Badge variant={isAdmin ? "default" : "secondary"} className="shrink-0">
            {user?.role}
          </Badge>
        </div>
        <button
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => void logout().then(() => (window.location.href = "/login"))}
        >
          Log out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

export function MemberSidebar() {
  return <SidebarShell label="Member" items={memberItems} />;
}

export function AdminSidebar() {
  return <SidebarShell label="Admin" items={adminItems} />;
}

export function AppSidebar() {
  const { user } = useAuth();
  return user?.role === "admin" ? <AdminSidebar /> : <MemberSidebar />;
}
