import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Shield, UserPlus } from "lucide-react";
import { useMemo } from "react";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { EmptyState, GlassCard, PageHeader, StatusChip } from "../components/ui/GlassCard";

export default function NotificationsPage() {
  const { admin, accounts, users } = useAdmin();

  const alerts = useMemo(() => {
    const list: Array<{ type: string; message: string; date: string; icon: ReactNode }> = [];

    users.filter((u) => u.pendingDeposits > 0).forEach((u) => {
      list.push({
        type: "Deposit",
        message: `${u.name} has ${u.pendingDeposits} pending deposit(s)`,
        date: new Date().toLocaleString(),
        icon: <ArrowDownLeft size={16} />
      });
    });

    users.filter((u) => u.pendingTransfers > 0).forEach((u) => {
      list.push({
        type: "Withdrawal",
        message: `${u.name} has ${u.pendingTransfers} pending withdrawal(s)`,
        date: new Date().toLocaleString(),
        icon: <ArrowUpRight size={16} />
      });
    });

    users
      .filter((u) => u.verificationStatus === "Pending" || u.verificationStatus === "Under Review")
      .forEach((u) => {
        list.push({
          type: "KYC",
          message: `Verification request from ${u.name}`,
          date: u.memberSince || "",
          icon: <Shield size={16} />
        });
      });

    users.filter((u) => u.withdrawalsFrozen).forEach((u) => {
      list.push({
        type: "Security",
        message: `${u.name} account has frozen withdrawals`,
        date: new Date().toLocaleString(),
        icon: <AlertTriangle size={16} />
      });
    });

    Object.entries(accounts).forEach(([email, acct]) => {
      (acct.supportTickets || [])
        .filter((t) => t.status === "Open" || t.status === "Urgent")
        .forEach((t) => {
          list.push({
            type: "Support",
            message: `${t.subject} — ${acct.profile?.fullName || email}`,
            date: t.date,
            icon: <AlertTriangle size={16} />
          });
        });
    });

    (admin.userActivityLog || [])
      .filter((a) => a.type === "signup")
      .slice(0, 5)
      .forEach((a) => {
        list.push({
          type: "New User",
          message: a.description,
          date: a.date,
          icon: <UserPlus size={16} />
        });
      });

    return list;
  }, [admin, accounts, users]);

  return (
    <AppShell>
      <div className="gv-page">
        <PageHeader title="Notifications" subtitle={`${alerts.length} active alerts`} />

        {!alerts.length ? (
          <EmptyState
            icon={<Shield size={28} />}
            title="All clear"
            description="No pending alerts at the moment."
          />
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <GlassCard key={i} className="!p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-gv-primary/15 p-2 text-gv-primary">{a.icon}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <StatusChip status={a.type} />
                      <span className="text-xs text-gv-muted">{a.date}</span>
                    </div>
                    <p className="mt-1 text-sm">{a.message}</p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}

        <GlassCard className="mt-6">
          <h3 className="mb-3 font-semibold">Sent Notifications Log</h3>
          <div className="space-y-2">
            {(admin.notificationLog || []).slice(0, 20).map((n) => (
              <div key={String(n.id)} className="rounded-gv-sm bg-white/[0.03] px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{n.target}</span>
                  <span className="text-xs text-gv-muted">{n.date}</span>
                </div>
                <p className="text-gv-muted">{n.message}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
