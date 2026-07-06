import type { ReactNode } from "react";
import {
  Ban,
  Bell,
  CheckCircle,
  ChevronLeft,
  CreditCard,
  Mail,
  Shield,
  Snowflake,
  Trash2,
  UserCog
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { Avatar, GlassCard, PageHeader, StatusChip } from "../components/ui/GlassCard";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { formatDate, formatMoney, normalizeEmail } from "../lib/utils";
import { persist } from "../lib/adminService";

type ActionType =
  | "credit"
  | "debit"
  | "freeze"
  | "unfreeze"
  | "suspend"
  | "activate"
  | "delete"
  | "notify"
  | "verify_kyc"
  | "reject_kyc"
  | "reset_password";

export default function UserDetailPage() {
  const { email: emailParam } = useParams();
  const email = decodeURIComponent(emailParam || "");
  const navigate = useNavigate();
  const { accounts, admin, adminId, runAction, setData, ops } = useAdmin();
  const [action, setAction] = useState<ActionType | null>(null);
  const [tab, setTab] = useState("overview");

  const account = accounts[normalizeEmail(email)];
  const profile = account?.profile || {};

  const pendingDeposits = useMemo(
    () =>
      (admin.pendingDeposits || []).filter(
        (d) => d.status === "pending" && normalizeEmail(d.userEmail) === normalizeEmail(email)
      ),
    [admin.pendingDeposits, email]
  );

  const pendingTransfers = useMemo(
    () =>
      (admin.pendingTransfers || []).filter(
        (t) => t.status === "pending" && normalizeEmail(t.userEmail) === normalizeEmail(email)
      ),
    [admin.pendingTransfers, email]
  );

  if (!account) {
    return (
      <AppShell>
        <div className="gv-page">
          <p>User not found.</p>
          <Link to="/users" className="text-gv-primary">← Back to users</Link>
        </div>
      </AppShell>
    );
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "transactions", label: "Transactions" },
    { id: "deposits", label: "Deposits" },
    { id: "withdrawals", label: "Withdrawals" },
    { id: "security", label: "Security" }
  ];

  return (
    <AppShell>
      <div className="gv-page">
        <button
          onClick={() => navigate("/users")}
          className="mb-4 flex items-center gap-1 text-sm text-gv-muted hover:text-gv-text"
        >
          <ChevronLeft size={16} /> Back to users
        </button>

        <GlassCard className="mb-5">
          <div className="flex flex-wrap items-start gap-4">
            <Avatar name={profile.fullName || email} email={email} size="lg" />
            <div className="flex-1">
              <PageHeader
                title={profile.fullName || email}
                subtitle={`${email} · ${profile.phone || "No phone"}`}
              />
              <div className="flex flex-wrap gap-2">
                <StatusChip status={account.withdrawalsFrozen ? "Frozen" : profile.suspended ? "Suspended" : "Active"} />
                <StatusChip status={profile.verificationStatus || "Pending"} />
                {account.emailVerified && <StatusChip status="Email Verified" />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="Balance" value={formatMoney(account.cash || 0)} />
                <Metric label="Account ID" value={email.slice(0, 8).toUpperCase()} small />
                <Metric label="Registered" value={formatDate(profile.memberSince)} small />
                <Metric label="Last Login" value={formatDate(profile.lastLoginAt)} small />
              </div>
            </div>
          </div>
        </GlassCard>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold transition ${
                tab === t.id ? "bg-gv-primary text-white" : "bg-white/5 text-gv-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <GlassCard>
              <h3 className="mb-3 font-semibold">Personal Information</h3>
              <InfoRow label="Full Name" value={profile.fullName || "—"} />
              <InfoRow label="Username" value={profile.username || email.split("@")[0]} />
              <InfoRow label="Email" value={email} />
              <InfoRow label="Phone" value={profile.phone || "—"} />
              <InfoRow label="SSN on File" value={profile.ssnLast4 ? `***-**-${profile.ssnLast4}` : "Not submitted"} />
              <InfoRow label="Last Device" value={profile.lastLoginDevice || "—"} />
            </GlassCard>
            <GlassCard>
              <h3 className="mb-3 font-semibold">KYC & Documents</h3>
              <InfoRow label="Verification" value={profile.verificationStatus || "Pending"} />
              <InfoRow label="Email Verified" value={account.emailVerified ? "Yes" : "No"} />
              <p className="mt-4 text-sm text-gv-muted">
                Document uploads are stored in the user profile. Use Verify/Reject KYC actions below.
              </p>
            </GlassCard>
          </div>
        )}

        {tab === "transactions" && (
          <GlassCard>
            <h3 className="mb-3 font-semibold">Transaction History</h3>
            <TxList items={account.transactions || []} />
          </GlassCard>
        )}

        {tab === "deposits" && (
          <GlassCard>
            <h3 className="mb-3 font-semibold">Deposit History & Pending</h3>
            {pendingDeposits.map((d) => (
              <PendingRow key={d.id} label={`Pending ${formatMoney(d.amount)} · ${d.method}`} date={d.date} />
            ))}
            <TxList items={(account.transactions || []).filter((t) => t.amount > 0)} />
          </GlassCard>
        )}

        {tab === "withdrawals" && (
          <GlassCard>
            <h3 className="mb-3 font-semibold">Withdrawal History & Pending</h3>
            {pendingTransfers.map((t) => (
              <PendingRow key={t.id} label={`Pending ${formatMoney(t.amount)} → ${t.destination}`} date={t.date} />
            ))}
            <TxList items={(account.transactions || []).filter((t) => t.amount <= 0)} />
          </GlassCard>
        )}

        {tab === "security" && (
          <GlassCard>
            <h3 className="mb-3 font-semibold">Security Settings</h3>
            <InfoRow label="Withdrawals Frozen" value={account.withdrawalsFrozen ? "Yes" : "No"} />
            <InfoRow label="Freeze Reason" value={account.withdrawalsFrozenReason || "—"} />
            <InfoRow label="Account Suspended" value={profile.suspended ? "Yes" : "No"} />
          </GlassCard>
        )}

        <GlassCard className="mt-5">
          <h3 className="mb-4 font-semibold">Admin Actions</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            <ActionBtn icon={<CreditCard size={16} />} label="Credit" onClick={() => setAction("credit")} />
            <ActionBtn icon={<CreditCard size={16} />} label="Debit" onClick={() => setAction("debit")} />
            <ActionBtn icon={<Snowflake size={16} />} label={account.withdrawalsFrozen ? "Unfreeze" : "Freeze"} onClick={() => setAction(account.withdrawalsFrozen ? "unfreeze" : "freeze")} />
            <ActionBtn icon={<Ban size={16} />} label={profile.suspended ? "Activate" : "Suspend"} onClick={() => setAction(profile.suspended ? "activate" : "suspend")} />
            <ActionBtn icon={<Bell size={16} />} label="Notify" onClick={() => setAction("notify")} />
            <ActionBtn icon={<Mail size={16} />} label="Send Email" onClick={() => setAction("notify")} />
            <ActionBtn icon={<CheckCircle size={16} />} label="Verify KYC" onClick={() => setAction("verify_kyc")} />
            <ActionBtn icon={<Shield size={16} />} label="Reject KYC" onClick={() => setAction("reject_kyc")} />
            <ActionBtn icon={<UserCog size={16} />} label="Reset Password" onClick={() => setAction("reset_password")} />
            <ActionBtn icon={<Trash2 size={16} />} label="Delete" danger onClick={() => setAction("delete")} />
          </div>
        </GlassCard>

        <ConfirmModal
          open={!!action}
          title={actionLabel(action)}
          description="This action will be recorded in the audit log with your admin ID and timestamp."
          confirmVariant={action === "delete" || action === "reject_kyc" ? "danger" : "primary"}
          requireAmount={action === "credit" || action === "debit"}
          requireReason={action !== "unfreeze" && action !== "activate"}
          onClose={() => setAction(null)}
          onConfirm={async ({ reason, amount }) => {
            if (!action) return;
            await runAction(async () => {
              let result = { accounts, admin };
              switch (action) {
                case "credit":
                case "debit":
                  result = await ops.adjustBalance(accounts, admin, adminId, email, action, amount!, reason);
                  break;
                case "freeze":
                  result = await ops.setWithdrawalsFrozen(accounts, admin, adminId, email, true, reason);
                  break;
                case "unfreeze":
                  result = await ops.setWithdrawalsFrozen(accounts, admin, adminId, email, false, reason);
                  break;
                case "suspend":
                  result = await ops.setAccountSuspended(accounts, admin, adminId, email, true, reason);
                  break;
                case "activate":
                  result = await ops.setAccountSuspended(accounts, admin, adminId, email, false, reason);
                  break;
                case "delete":
                  result = await ops.deleteUser(accounts, admin, adminId, email, reason);
                  navigate("/users");
                  break;
                case "notify":
                  result = await ops.sendUserNotification(accounts, admin, adminId, email, reason, reason);
                  break;
                case "verify_kyc": {
                  const updated = { ...account, profile: { ...profile, verificationStatus: "Verified" } };
                  result = {
                    accounts: { ...accounts, [normalizeEmail(email)]: updated },
                    admin: ops.appendAudit(admin, adminId, "verify_kyc", reason, { userEmail: email })
                  };
                  await persist(result.accounts, result.admin);
                  break;
                }
                case "reject_kyc": {
                  const updated = { ...account, profile: { ...profile, verificationStatus: "Rejected" } };
                  result = {
                    accounts: { ...accounts, [normalizeEmail(email)]: updated },
                    admin: ops.appendAudit(admin, adminId, "reject_kyc", reason, { userEmail: email })
                  };
                  await persist(result.accounts, result.admin);
                  break;
                }
                case "reset_password": {
                  const updated = { ...account, password: "Reset123!" };
                  result = {
                    accounts: { ...accounts, [normalizeEmail(email)]: updated },
                    admin: ops.appendAudit(admin, adminId, "reset_password", reason, { userEmail: email })
                  };
                  await persist(result.accounts, result.admin);
                  break;
                }
              }
              setData(result.accounts, result.admin);
            });
            setAction(null);
          }}
        />
      </div>
    </AppShell>
  );
}

function actionLabel(action: ActionType | null): string {
  const map: Record<ActionType, string> = {
    credit: "Credit Account",
    debit: "Debit Account",
    freeze: "Freeze Withdrawals",
    unfreeze: "Unfreeze Withdrawals",
    suspend: "Suspend Account",
    activate: "Activate Account",
    delete: "Delete Account",
    notify: "Send Notification",
    verify_kyc: "Verify KYC",
    reject_kyc: "Reject KYC",
    reset_password: "Reset Password"
  };
  return action ? map[action] : "";
}

function Metric({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gv-muted">{label}</div>
      <div className={small ? "text-sm font-semibold" : "text-lg font-bold text-gv-success"}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-white/5 py-2 text-sm last:border-0">
      <span className="text-gv-muted">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  danger
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-gv-sm px-3 py-2.5 text-xs font-semibold transition ${
        danger ? "bg-gv-danger/15 text-gv-danger hover:bg-gv-danger/25" : "bg-white/5 hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TxList({ items }: { items: Array<{ date: string; description: string; amount: number }> }) {
  if (!items.length) return <p className="py-4 text-sm text-gv-muted">No records</p>;
  return (
    <div className="space-y-2">
      {items.slice(0, 30).map((t, i) => (
        <div key={i} className="flex justify-between rounded-gv-sm bg-white/[0.03] px-3 py-2 text-sm">
          <div>
            <div>{t.description}</div>
            <div className="text-xs text-gv-muted">{t.date}</div>
          </div>
          <div className={t.amount >= 0 ? "text-gv-success" : "text-gv-danger"}>
            {t.amount >= 0 ? "+" : ""}{formatMoney(t.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingRow({ label, date }: { label: string; date: string }) {
  return (
    <div className="mb-2 flex justify-between rounded-gv-sm border border-gv-warning/30 bg-gv-warning/10 px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="text-xs text-gv-muted">{date}</span>
    </div>
  );
}
