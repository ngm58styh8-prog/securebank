import { useMemo, useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { EmptyState, GlassCard, PageHeader, StatusChip } from "../components/ui/GlassCard";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { formatMoney } from "../lib/utils";
import { Wallet } from "lucide-react";

type TxFilter = "all" | "deposits" | "withdrawals" | "transfers" | "investments";

export default function TransactionsPage() {
  const { admin, accounts, adminId, runAction, setData, ops } = useAdmin();
  const [filter, setFilter] = useState<TxFilter>("all");
  const [pendingAction, setPendingAction] = useState<{
    type: "approve_deposit" | "reject_deposit" | "approve_withdrawal" | "reject_withdrawal";
    id: string;
  } | null>(null);

  const pendingDeposits = (admin.pendingDeposits || []).filter((d) => d.status === "pending");
  const pendingTransfers = (admin.pendingTransfers || []).filter((t) => t.status === "pending");

  const payments = useMemo(() => {
    let list = [...(admin.payments || [])];
    if (filter === "deposits") list = list.filter((p) => p.type.includes("deposit") || p.type.includes("credit"));
    if (filter === "withdrawals") list = list.filter((p) => p.type.includes("withdraw") || p.type.includes("debit"));
    return list;
  }, [admin.payments, filter]);

  return (
    <AppShell>
      <div className="gv-page">
        <PageHeader
          title="Transactions"
          subtitle={`${pendingDeposits.length} pending deposits · ${pendingTransfers.length} pending withdrawals`}
        />

        <div className="mb-4 flex flex-wrap gap-2">
          {(["all", "deposits", "withdrawals", "transfers", "investments"] as TxFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize ${
                filter === f ? "bg-gv-primary text-white" : "bg-white/5 text-gv-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {(pendingDeposits.length > 0 || pendingTransfers.length > 0) && (
          <GlassCard className="mb-5">
            <h3 className="mb-3 font-semibold">Pending Approvals</h3>
            {pendingDeposits.map((d) => (
              <div key={d.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-gv-sm bg-gv-success/10 px-3 py-2 text-sm">
                <div>
                  <StatusChip status="Deposit" />
                  <span className="ml-2">{d.userName} · {formatMoney(d.amount)} · {d.method}</span>
                </div>
                <div className="flex gap-2">
                  <button className="gv-btn-success !py-1.5 !text-xs" onClick={() => setPendingAction({ type: "approve_deposit", id: d.id })}>Approve</button>
                  <button className="gv-btn-danger !py-1.5 !text-xs" onClick={() => setPendingAction({ type: "reject_deposit", id: d.id })}>Reject</button>
                </div>
              </div>
            ))}
            {pendingTransfers.map((t) => (
              <div key={t.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-gv-sm bg-gv-warning/10 px-3 py-2 text-sm">
                <div>
                  <StatusChip status="Withdrawal" />
                  <span className="ml-2">{t.userName} · {formatMoney(t.amount)} → {t.destination}</span>
                </div>
                <div className="flex gap-2">
                  <button className="gv-btn-success !py-1.5 !text-xs" onClick={() => setPendingAction({ type: "approve_withdrawal", id: t.id })}>Approve</button>
                  <button className="gv-btn-danger !py-1.5 !text-xs" onClick={() => setPendingAction({ type: "reject_withdrawal", id: t.id })}>Reject</button>
                </div>
              </div>
            ))}
          </GlassCard>
        )}

        <GlassCard>
          <h3 className="mb-3 font-semibold">Payment History</h3>
          {!payments.length ? (
            <EmptyState icon={<Wallet size={28} />} title="No transactions" description="Payment activity will appear here." />
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={String(p.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-gv-sm bg-white/[0.03] px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{p.userName}</div>
                    <div className="text-xs text-gv-muted">{p.userEmail} · {p.date}</div>
                  </div>
                  <div className="text-right">
                    <StatusChip status={p.type} />
                    <div className={`font-bold ${p.type.includes("withdraw") || p.type.includes("debit") ? "text-gv-danger" : "text-gv-success"}`}>
                      {formatMoney(p.amount)}
                    </div>
                    <div className="text-[10px] text-gv-muted">ID {String(p.id).slice(-8)} · {p.method}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <ConfirmModal
          open={!!pendingAction}
          title={pendingAction?.type.includes("approve") ? "Approve Transaction" : "Reject Transaction"}
          confirmVariant={pendingAction?.type.includes("approve") ? "success" : "danger"}
          onClose={() => setPendingAction(null)}
          onConfirm={async ({ reason }) => {
            if (!pendingAction) return;
            await runAction(async () => {
              let result = { accounts, admin };
              if (pendingAction.type === "approve_deposit") {
                result = await ops.approveDeposit(accounts, admin, adminId, pendingAction.id, reason);
              } else if (pendingAction.type === "reject_deposit") {
                result = await ops.rejectDeposit(accounts, admin, adminId, pendingAction.id, reason);
              } else if (pendingAction.type === "approve_withdrawal") {
                result = await ops.approveTransfer(accounts, admin, adminId, pendingAction.id, reason);
              } else {
                result = await ops.rejectTransfer(accounts, admin, adminId, pendingAction.id, reason);
              }
              setData(result.accounts, result.admin);
            });
            setPendingAction(null);
          }}
        />
      </div>
    </AppShell>
  );
}
