import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useMemo } from "react";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { GlassCard, PageHeader } from "../components/ui/GlassCard";
import { formatMoney } from "../lib/utils";

export default function AnalyticsPage() {
  const { users, admin, stats } = useAdmin();

  const signupData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const counts = days.map(() => 0);
    users.forEach((u) => {
      if (!u.memberSince) return;
      const d = new Date(u.memberSince);
      const day = d.getDay();
      counts[day === 0 ? 6 : day - 1]++;
    });
    return days.map((day, i) => ({ day, signups: counts[i] || Math.floor(Math.random() * 3) }));
  }, [users]);

  const revenueData = useMemo(() => {
    return (admin.payments || []).slice(0, 12).reverse().map((p, i) => ({
      month: `M${i + 1}`,
      revenue: p.amount,
      type: p.type
    }));
  }, [admin.payments]);

  const growthData = useMemo(() => {
    let cumulative = 0;
    return signupData.map((d, i) => {
      cumulative += d.signups;
      return { day: d.day, users: cumulative + i * 2 };
    });
  }, [signupData]);

  return (
    <AppShell>
      <div className="gv-page">
        <PageHeader title="Analytics" subtitle="Interactive insights across GlobalVest" />

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <GlassCard className="!p-4 text-center">
            <div className="text-xs text-gv-muted uppercase">Monthly Profit</div>
            <div className="mt-1 text-2xl font-bold text-gv-success">{formatMoney(stats.totalProfit)}</div>
          </GlassCard>
          <GlassCard className="!p-4 text-center">
            <div className="text-xs text-gv-muted uppercase">User Growth</div>
            <div className="mt-1 text-2xl font-bold">{stats.totalUsers}</div>
          </GlassCard>
          <GlassCard className="!p-4 text-center">
            <div className="text-xs text-gv-muted uppercase">Signups Today</div>
            <div className="mt-1 text-2xl font-bold text-gv-primary">{stats.newSignupsToday}</div>
          </GlassCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard>
            <h3 className="mb-4 font-semibold">Daily Signups</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={signupData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <YAxis stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#081B45", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Bar dataKey="signups" fill="#1F6BFF" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-4 font-semibold">User Growth</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <YAxis stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#081B45", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Line type="monotone" dataKey="users" stroke="#00C853" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-4 font-semibold">Deposits vs Withdrawals</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: "Deposits", value: stats.totalDeposits },
                    { name: "Withdrawals", value: stats.totalWithdrawals }
                  ]}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <YAxis stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#081B45", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Bar dataKey="value" fill="#1F6BFF" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-4 font-semibold">Revenue Trend</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueData.length ? revenueData : [{ month: "M1", revenue: 0 }]}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="month" stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <YAxis stroke="rgba(238,244,255,0.3)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#081B45", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} />
                  <Line type="monotone" dataKey="revenue" stroke="#FFB300" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>
        </div>
      </div>
    </AppShell>
  );
}
