import { MessageSquare, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { Avatar, EmptyState, GlassCard, PageHeader, StatusChip } from "../components/ui/GlassCard";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { normalizeEmail } from "../lib/utils";
import type { SupportTicket } from "../types";

type Filter = "open" | "pending" | "closed" | "all";

interface SupportItem {
  userEmail: string;
  userName: string;
  ticket: SupportTicket;
}

export default function SupportPage() {
  const { accounts, admin, adminId, runAction, setData, ops } = useAdmin();
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SupportItem | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [confirmResolve, setConfirmResolve] = useState(false);

  const items = useMemo(() => {
    const list: SupportItem[] = [];
    Object.entries(accounts).forEach(([email, acct]) => {
      (acct.supportTickets || []).forEach((ticket) => {
        list.push({
          userEmail: normalizeEmail(email),
          userName: acct.profile?.fullName || email,
          ticket
        });
      });
    });
    return list.sort((a, b) => String(b.ticket.date).localeCompare(String(a.ticket.date)));
  }, [accounts]);

  const filtered = items.filter((item) => {
    const status = item.ticket.status.toLowerCase();
    const matchFilter =
      filter === "all" ||
      (filter === "open" && (status === "open" || status === "urgent")) ||
      (filter === "pending" && status.includes("progress")) ||
      (filter === "closed" && (status === "resolved" || status === "closed"));
    const q = query.toLowerCase();
    const matchQuery =
      !q ||
      item.userName.toLowerCase().includes(q) ||
      item.userEmail.toLowerCase().includes(q) ||
      item.ticket.subject.toLowerCase().includes(q);
    return matchFilter && matchQuery;
  });

  return (
    <AppShell>
      <div className="gv-page">
        <PageHeader title="Support Center" subtitle="Manage customer conversations" />

        <div className="mb-4 flex flex-wrap gap-2">
          {(["open", "pending", "closed", "all"] as Filter[]).map((f) => (
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

        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gv-muted" size={18} />
          <input
            className="gv-input pl-11"
            placeholder="Search conversations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {!filtered.length ? (
              <EmptyState
                icon={<MessageSquare size={28} />}
                title="No conversations"
                description="Support tickets from users will appear here."
              />
            ) : (
              filtered.map((item) => (
                <GlassCard
                  key={`${item.userEmail}-${item.ticket.id}`}
                  onClick={() => setSelected(item)}
                  className={selected?.ticket.id === item.ticket.id ? "!border-gv-primary/50" : ""}
                >
                  <div className="flex gap-3">
                    <Avatar name={item.userName} email={item.userEmail} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="truncate font-semibold">{item.ticket.subject}</h4>
                        <StatusChip status={item.ticket.status} />
                      </div>
                      <p className="text-xs text-gv-muted">{item.userName} · {item.ticket.date}</p>
                      <p className="mt-1 truncate text-sm text-gv-muted">{item.ticket.message}</p>
                    </div>
                  </div>
                </GlassCard>
              ))
            )}
          </div>

          <GlassCard className="min-h-[400px] lg:sticky lg:top-4">
            {!selected ? (
              <EmptyState
                icon={<MessageSquare size={28} />}
                title="Select a conversation"
                description="View customer profile and reply from here."
              />
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3 border-b border-gv-border pb-4">
                  <Avatar name={selected.userName} email={selected.userEmail} />
                  <div>
                    <h3 className="font-semibold">{selected.userName}</h3>
                    <p className="text-xs text-gv-muted">{selected.userEmail}</p>
                  </div>
                </div>

                <div className="mb-4 max-h-48 overflow-y-auto space-y-2">
                  <div className="rounded-gv-sm bg-white/5 p-3 text-sm">
                    <strong>Customer</strong>
                    <p className="mt-1">{selected.ticket.message}</p>
                  </div>
                  {(selected.ticket.responses || []).map((r, i) => (
                    <div
                      key={i}
                      className={`rounded-gv-sm p-3 text-sm ${
                        r.from === "admin" ? "bg-gv-primary/15 ml-4" : "bg-white/5 mr-4"
                      }`}
                    >
                      <strong>{r.from === "admin" ? "Admin" : "User"}</strong>
                      <p className="mt-1">{r.message}</p>
                      <p className="mt-1 text-[10px] text-gv-muted">{r.date}</p>
                    </div>
                  ))}
                </div>

                <textarea
                  className="gv-input mb-2 resize-none"
                  rows={3}
                  placeholder="Type your reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <textarea
                  className="gv-input mb-3 resize-none"
                  rows={2}
                  placeholder="Internal admin note (optional)…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="gv-btn-primary flex-1"
                    disabled={!reply.trim()}
                    onClick={async () => {
                      await runAction(async () => {
                        const result = await ops.respondSupport(
                          accounts,
                          admin,
                          adminId,
                          selected.userEmail,
                          selected.ticket.id,
                          reply,
                          note || "Support reply",
                          false
                        );
                        setData(result.accounts, result.admin);
                        setReply("");
                      });
                    }}
                  >
                    Send Reply
                  </button>
                  <button className="gv-btn-success" onClick={() => setConfirmResolve(true)}>
                    Resolve
                  </button>
                </div>
              </>
            )}
          </GlassCard>
        </div>

        <ConfirmModal
          open={confirmResolve}
          title="Mark as Resolved"
          description="Close this support conversation and notify the customer."
          confirmVariant="success"
          onClose={() => setConfirmResolve(false)}
          onConfirm={async ({ reason }) => {
            if (!selected) return;
            await runAction(async () => {
              const result = await ops.respondSupport(
                accounts,
                admin,
                adminId,
                selected.userEmail,
                selected.ticket.id,
                reply || "Your ticket has been resolved.",
                reason,
                true
              );
              setData(result.accounts, result.admin);
              setSelected(null);
              setReply("");
            });
            setConfirmResolve(false);
          }}
        />
      </div>
    </AppShell>
  );
}
