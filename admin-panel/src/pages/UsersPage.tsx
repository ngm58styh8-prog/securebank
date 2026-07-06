import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { Avatar, EmptyState, GlassCard, PageHeader, StatusChip } from "../components/ui/GlassCard";
import { PullRefresh } from "../components/ui/ConfirmModal";
import { formatDate, formatMoney } from "../lib/utils";

export default function UsersPage() {
  const { users, loading, refreshing, refresh } = useAdmin();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        u.accountId.toLowerCase().includes(q)
    );
  }, [users, query]);

  return (
    <AppShell>
      <PullRefresh refreshing={refreshing} onRefresh={refresh}>
        <div className="gv-page">
          <PageHeader title="User Management" subtitle={`${users.length} accounts in registry`} />

          <div className="relative mb-5">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gv-muted" size={18} />
            <input
              className="gv-input pl-11"
              placeholder="Search name, email, phone, account ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="gv-glass h-28 animate-pulse" />
              ))}
            </div>
          ) : !filtered.length ? (
            <EmptyState
              icon={<Search size={28} />}
              title="No users found"
              description={query ? "Try a different search term." : "Users appear here when they register on GlobalVest."}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((user) => (
                <GlassCard
                  key={user.email}
                  className="cursor-pointer transition hover:scale-[1.01] hover:border-gv-primary/30"
                  onClick={() => navigate(`/users/${encodeURIComponent(user.email)}`)}
                >
                  <div className="flex gap-3">
                    <Avatar name={user.name} email={user.email} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="truncate font-semibold">{user.name}</h3>
                          <p className="text-xs text-gv-muted">@{user.username}</p>
                        </div>
                        <StatusChip status={user.accountStatus} />
                      </div>
                      <p className="mt-1 truncate text-xs text-gv-muted">{user.email}</p>
                      <p className="text-xs text-gv-muted">{user.phone}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-gv-muted">Balance</span>
                          <div className="font-semibold text-gv-success">{formatMoney(user.cash)}</div>
                        </div>
                        <div>
                          <span className="text-gv-muted">Available</span>
                          <div className="font-semibold">{formatMoney(user.availableBalance)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <StatusChip status={user.verificationStatus} />
                        {user.emailVerified && <StatusChip status="Email Verified" />}
                      </div>
                      <p className="mt-2 text-[10px] text-gv-muted">
                        ID {user.accountId} · Last login {formatDate(user.lastLoginAt)}
                      </p>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </PullRefresh>
    </AppShell>
  );
}
