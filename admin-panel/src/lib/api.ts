import type { AdminData, UserAccount } from "../types";
import { normalizeEmail } from "./utils";

export async function fetchAccounts(): Promise<Record<string, UserAccount>> {
  const res = await fetch("/api/accounts", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load accounts");
  const payload = (await res.json()) as { ok?: boolean; accounts?: Record<string, UserAccount> };
  if (!payload.ok || !payload.accounts) return {};
  const normalized: Record<string, UserAccount> = {};
  Object.entries(payload.accounts).forEach(([email, acct]) => {
    normalized[normalizeEmail(email)] = acct;
  });
  return normalized;
}

export async function fetchAdmin(): Promise<AdminData | null> {
  const res = await fetch("/api/admin-data", { cache: "no-store" });
  if (!res.ok) return null;
  const payload = (await res.json()) as { ok?: boolean; admin?: AdminData };
  return payload.ok && payload.admin ? payload.admin : null;
}

export async function saveAccount(email: string, account: UserAccount): Promise<void> {
  const res = await fetch("/api/accounts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email), account })
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || "Failed to save account");
  }
}

export async function deleteAccountApi(email: string): Promise<void> {
  const res = await fetch("/api/accounts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email) })
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || "Failed to delete account");
  }
}

export async function saveAdmin(admin: AdminData): Promise<void> {
  const res = await fetch("/api/admin-data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin })
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || "Failed to save admin data");
  }
}

export async function checkRegistryHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/registry-health", { cache: "no-store" });
    if (!res.ok) return false;
    const payload = (await res.json()) as { ok?: boolean };
    return !!payload.ok;
  } catch {
    return false;
  }
}
