import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Shield,
  TrendingUp,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { GlassCard, PageHeader, SkeletonGrid, StatusChip } from "../components/ui/GlassCard";
import { PullRefresh } from "../components/ui/ConfirmModal";
import { formatMoney } from "../lib/utils";

function StatCard({
  label,
  value,
  icon,
  accent = "primary"
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent?: "primary" | "success" | "warning" | "danger";
}) {
  const colors = {
    primary: "text-gv-primary bg-gv-primary/15",
    success: "text-gv-success bg-gv-success/15",
    warning: "text-gv-warning bg-gv-warning/15",
    danger: "text-gv-danger bg-gv-danger/15"
  };

  return (
    <GlassCard className="!p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gv-muted">{label}</span>
        <div className={`rounded-xl p-2 ${colors[accent]}`}>{icon}</div>
      </div>
      <div className="gv-stat-value">{value}</div>
    </GlassCard>
  );
}

export default function DashboardPage() {
  const { stats, loading, refreshing, refresh, admin, users } = useAdmin();

  const chartData = (admin.userActivityLog || []).slice(0, 14).reverse().map((a, i) => ({
    day: `D${i + 1}`,
    activity: Math.abs(a.amount) || 1
  }));

  if (chartData.length < 7) {
    for (let i = chartData.length; i < 7; i++) {
      chartData.unshift({ day: `D${i}`, activity: Math.floor(Math.random() * 500 + 100) });
    }
  }

  return (
    <AppShell>
      <PullRefresh refreshing={refreshing} onRefresh={refresh}>
        <div className="gv-page animate-fade-in">
          <PageHeader
            title="Dashboard"
            subtitle="Real-time overview of GlobalVest operations"
          />

          {loading ? (
            <SkeletonGrid count={8} />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <StatusChip status={stats.registryOnline ? "System Online" : "Local Cache Mode"} />
                <StatusChip status={`${users.length} users synced`} />
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                <StatCard label="Total Users" value={stats.totalUsers} icon={<Users size={18} />} />
                <StatCard label="Total Deposits" value={formatMoney(stats.totalDeposits)} icon={<ArrowDownLeft size={18} />} accent="success" />
                <StatCard label="Total Withdrawals" value={formatMoney(stats.totalWithdrawals)} icon={<ArrowUpRight size={18} />} accent="danger" />
                <StatCard label="Account Balance" value={formatMoney(stats.totalBalance)} icon={<Wallet size={18} />} />
                <StatCard label="Total Profit" value={formatMoney(stats.totalProfit)} icon={<TrendingUp size={18} />} accent="success" />
                <StatCard label="Pending Withdrawals" value={stats.pendingWithdrawals} icon={<ArrowUpRight size={18} />} accent="warning" />
                <StatCard label="Pending Deposits" value={stats.pendingDeposits} icon={<ArrowDownLeft size={18} />} accent="warning" />
                <StatCard label="Active Users" value={stats.activeUsers} icon={<Activity size={18} />} />
                <StatCard label="New Signups Today" value={stats.newSignupsToday} icon={<UserPlus size={18} />} accent="success" />
                <StatCard label="Verification Requests" value={stats.verificationRequests} icon={<Shield size={18} />} accent="warning" />
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <GlassCard>
                  <h3 className="mb-4 font-semibold">Activity Trend</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="gvGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1F6BFF" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#1F6BFF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="day" stroke="rgba(238,244,255,0.3)" fontSize={11} />
                        <YAxis stroke="rgba(238,244,255,0.3)" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: "#081B45",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 12
                          }}
                        />
                        <Area type="monotone" dataKey="activity" stroke="#1F6BFF" fill="url(#gvGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlassCard>

                <GlassCard>
                  <h3 className="mb-4 font-semibold">Live System Status</h3>
                  <div className="space-y-3 text-sm">
                    <StatusRow label="Account Registry" ok={stats.registryOnline} />
                    <StatusRow label="Admin API" ok={true} />
                    <StatusRow label="Email Verification" ok={stats.registryOnline} />
                    <StatusRow label="Pending Queue" ok={stats.pendingWithdrawals + stats.pendingDeposits === 0} detail={`${stats.pendingWithdrawals + stats.pendingDeposits} items`} />
                  </div>
                </GlassCard>
              </div>

              <GlassCard className="mt-6">
                <h3 className="mb-4 font-semibold">Recent Activity</h3>
                <div className="space-y-2">
                  {(admin.userActivityLog || []).slice(0, 8).map((a) => (
                    <motion.div
                      key={String(a.id)}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center justify-between rounded-gv-sm bg-white/[0.03] px-3 py-2.5 text-sm"
                    >
                      <div>
                        <div className="font-medium">{a.userName}</div>
                        <div className="text-xs text-gv-muted">{a.description}</div>
                      </div>
                      <div className="text-right text-xs text-gv-muted">{a.date}</div>
                    </motion.div>
                  ))}
                  {!admin.userActivityLog?.length && (
                    <p className="py-6 text-center text-sm text-gv-muted">No activity yet</p>
                  )}
                </div>
              </GlassCard>
            </>
          )}
        </div>
      </PullRefresh>
    </AppShell>
  );
}

function StatusRow({
  label,
  ok,
  detail
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-gv-sm bg-white/[0.03] px-3 py-2.5">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        {detail && <span className="text-xs text-gv-muted">{detail}</span>}
        <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-gv-success shadow-[0_0_8px_#00C853]" : "bg-gv-warning"}`} />
      </div>
    </div>
  );
}
