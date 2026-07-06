import { useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { AppShell } from "../components/layout/AppShell";
import { GlassCard, PageHeader } from "../components/ui/GlassCard";
import { persist } from "../lib/adminService";
import type { AdminData } from "../types";

export default function SettingsPage() {
  const { admin, accounts, adminId, runAction, setData, ops } = useAdmin();
  const ws = admin.websiteSettings || {
    siteName: "GlobalVest",
    siteTagline: "Global Investing & Digital Banking",
    supportEmail: "support@globalvest.com",
    announcement: "",
    maintenanceMode: false
  };

  const [form, setForm] = useState({
    siteName: ws.siteName,
    siteTagline: ws.siteTagline,
    supportEmail: ws.supportEmail,
    announcement: ws.announcement,
    maintenanceMode: ws.maintenanceMode,
    walletAddress: admin.walletAddress,
    bankDetails: admin.bankDetails
  });

  return (
    <AppShell>
      <div className="gv-page">
        <PageHeader title="Settings" subtitle="Platform configuration & security" />

        <form
          className="grid gap-4 lg:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await runAction(async () => {
              const nextAdmin: AdminData = {
                ...admin,
                walletAddress: form.walletAddress,
                bankDetails: form.bankDetails,
                websiteSettings: {
                  siteName: form.siteName,
                  siteTagline: form.siteTagline,
                  supportEmail: form.supportEmail,
                  announcement: form.announcement,
                  maintenanceMode: form.maintenanceMode
                }
              };
              const audited = ops.appendAudit(nextAdmin, adminId, "update_settings", "Website and payment settings updated");
              await persist(accounts, audited);
              setData(accounts, audited);
            });
          }}
        >
          <GlassCard>
            <h3 className="mb-4 font-semibold">Website</h3>
            <Field label="Site Name" value={form.siteName} onChange={(v) => setForm({ ...form, siteName: v })} />
            <Field label="Tagline" value={form.siteTagline} onChange={(v) => setForm({ ...form, siteTagline: v })} />
            <Field label="Support Email" value={form.supportEmail} onChange={(v) => setForm({ ...form, supportEmail: v })} />
            <label className="gv-label">Announcement Banner</label>
            <textarea
              className="gv-input mb-3 resize-none"
              rows={3}
              value={form.announcement}
              onChange={(e) => setForm({ ...form, announcement: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.maintenanceMode}
                onChange={(e) => setForm({ ...form, maintenanceMode: e.target.checked })}
              />
              Maintenance mode (block new logins)
            </label>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-4 font-semibold">Payment & Email</h3>
            <Field label="BTC Wallet Address" value={form.walletAddress} onChange={(v) => setForm({ ...form, walletAddress: v })} />
            <Field label="Bank Details" value={form.bankDetails} onChange={(v) => setForm({ ...form, bankDetails: v })} />
            <p className="mt-4 text-xs text-gv-muted">
              Resend email verification uses Vercel env vars: RESEND_API_KEY, RESEND_FROM_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
            </p>
          </GlassCard>

          <GlassCard className="lg:col-span-2">
            <h3 className="mb-4 font-semibold">Security & Audit Log</h3>
            <p className="mb-3 text-sm text-gv-muted">
              Admin ID: <strong>{adminId}</strong> · All sensitive actions require confirmation and are logged below.
            </p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {(admin.auditLog || []).slice(0, 30).map((entry) => (
                <div key={entry.id} className="rounded-gv-sm bg-white/[0.03] px-3 py-2 text-xs">
                  <div className="flex justify-between font-medium">
                    <span>{entry.action}</span>
                    <span className="text-gv-muted">{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="text-gv-muted">Admin: {entry.adminId} · {entry.reason}</div>
                  {entry.userEmail && <div className="text-gv-muted">User: {entry.userEmail}</div>}
                  {entry.amount != null && <div className="text-gv-muted">Amount: ${entry.amount.toFixed(2)}</div>}
                </div>
              ))}
              {!admin.auditLog?.length && <p className="text-sm text-gv-muted">No audit entries yet.</p>}
            </div>
          </GlassCard>

          <button type="submit" className="gv-btn-primary lg:col-span-2">Save Settings</button>
        </form>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-3">
      <label className="gv-label">{label}</label>
      <input className="gv-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
