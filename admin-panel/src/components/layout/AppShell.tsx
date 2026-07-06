import clsx from "clsx";
import { motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  Users,
  Wallet,
  X
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAdmin } from "../../context/AdminContext";
import { ToastStack } from "../ui/ConfirmModal";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/users", icon: Users, label: "Users" },
  { to: "/support", icon: MessageSquare, label: "Support" },
  { to: "/notifications", icon: Bell, label: "Alerts" },
  { to: "/transactions", icon: Wallet, label: "Transactions" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/settings", icon: Settings, label: "Settings" }
];

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const { logout, toasts, stats, refreshing, refresh } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[260px] flex-col border-r border-gv-border bg-[#081B45]/90 backdrop-blur-2xl lg:flex">
        <SidebarContent onLogout={logout} stats={stats} />
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-gv-border bg-[#081B45]/95 backdrop-blur-2xl"
          >
            <button
              className="absolute right-3 top-4 rounded-lg p-2 hover:bg-white/10"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={20} />
            </button>
            <SidebarContent
              onNavigate={() => setSidebarOpen(false)}
              onLogout={logout}
              stats={stats}
            />
          </motion.aside>
        </div>
      )}

      {/* Top bar mobile */}
      <header className="sticky top-0 z-40 border-b border-gv-border bg-[#030818]/80 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <button className="rounded-gv-sm p-2 hover:bg-white/10" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <img src="/assets/globalvest-logo-light.svg" alt="GlobalVest" className="h-7" />
          <button
            className="rounded-gv-sm p-2 hover:bg-white/10"
            onClick={() => refresh()}
            disabled={refreshing}
          >
            <Bell size={20} className={refreshing ? "animate-pulse text-gv-primary" : ""} />
          </button>
        </div>
      </header>

      <main>{children}</main>

      {/* Bottom nav mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gv-border bg-[#081B45]/95 backdrop-blur-2xl lg:hidden">
        <div className="flex items-center justify-around px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {NAV.slice(0, 5).map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-semibold transition",
                  isActive ? "text-gv-primary" : "text-gv-muted"
                )
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* FAB */}
      <div className="fixed bottom-20 right-4 z-50 lg:bottom-8 lg:right-8">
        {fabOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-3 flex flex-col gap-2"
          >
            <button
              className="gv-glass gv-btn-ghost whitespace-nowrap text-xs shadow-gv"
              onClick={() => { navigate("/users"); setFabOpen(false); }}
            >
              Manage Users
            </button>
            <button
              className="gv-glass gv-btn-ghost whitespace-nowrap text-xs shadow-gv"
              onClick={() => { navigate("/transactions"); setFabOpen(false); }}
            >
              Pending Approvals
            </button>
            <button
              className="gv-glass gv-btn-ghost whitespace-nowrap text-xs shadow-gv"
              onClick={() => { navigate("/support"); setFabOpen(false); }}
            >
              Support Inbox
            </button>
          </motion.div>
        )}
        <motion.button
          whileTap={{ scale: 0.92 }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-gv-primary to-gv-blue text-white shadow-glow"
          onClick={() => setFabOpen((v) => !v)}
        >
          <Plus size={24} className={clsx("transition-transform", fabOpen && "rotate-45")} />
        </motion.button>
      </div>

      <ToastStack toasts={toasts} />

      {/* Desktop status pill */}
      <div className="fixed bottom-4 left-[280px] hidden text-xs text-gv-muted lg:block">
        {location.pathname} · {stats.registryOnline ? "Registry online" : "Local cache mode"}
      </div>
    </div>
  );
}

function SidebarContent({
  onNavigate,
  onLogout,
  stats
}: {
  onNavigate?: () => void;
  onLogout: () => void;
  stats: { pendingWithdrawals: number; pendingDeposits: number };
}) {
  return (
    <>
      <div className="px-5 pb-4 pt-6">
        <img src="/assets/globalvest-logo-light.svg" alt="GlobalVest" className="h-8" />
        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-gv-muted">
          Admin Console
        </p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-gv-sm px-3 py-2.5 text-sm font-medium transition",
                isActive
                  ? "bg-gv-primary/20 text-gv-primary"
                  : "text-gv-muted hover:bg-white/5 hover:text-gv-text"
              )
            }
          >
            <Icon size={18} />
            {label}
            {label === "Transactions" && (stats.pendingWithdrawals + stats.pendingDeposits) > 0 && (
              <span className="ml-auto rounded-full bg-gv-warning px-2 py-0.5 text-[10px] font-bold text-black">
                {stats.pendingWithdrawals + stats.pendingDeposits}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gv-border p-4">
        <button
          className="gv-btn-ghost w-full justify-start text-gv-danger"
          onClick={onLogout}
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </>
  );
}
