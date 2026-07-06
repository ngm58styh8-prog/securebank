import type { AdminData, AdminSession, UserAccount } from "../types";

const ACCOUNTS_KEY = "securebank_accounts";
const ADMIN_DATA_KEY = "securebank_admin_data";
const ADMIN_SESSION_KEY = "securebank_admin_session";

export const DEFAULT_ADMIN_EMAIL = "admin@globalvest.com";
export const DEFAULT_ADMIN_PASSWORD = "admin123";

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function formatMoney(amount: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : "$";
  return (
    symbol +
    Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function accountIdFromEmail(email: string): string {
  const key = normalizeEmail(email);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return "GV-" + Math.abs(hash).toString(16).toUpperCase().slice(0, 8).padStart(8, "0");
}

export function usernameFromEmail(email: string): string {
  return normalizeEmail(email).split("@")[0] || email;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarGradient(email: string): string {
  const hues = [220, 250, 200, 170, 280, 320];
  let sum = 0;
  for (let i = 0; i < email.length; i++) sum += email.charCodeAt(i);
  const h = hues[sum % hues.length];
  return `linear-gradient(135deg, hsl(${h},70%,45%), hsl(${h + 40},80%,55%))`;
}

export function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function getSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AdminSession;
  } catch {
    return null;
  }
}

export function setSession(session: AdminSession): void {
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function cacheAccountsLocal(accounts: Record<string, UserAccount>): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function cacheAdminLocal(admin: AdminData): void {
  localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(admin));
}

export function readAccountsLocal(): Record<string, UserAccount> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, UserAccount>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function readAdminLocal(): AdminData | null {
  try {
    const raw = localStorage.getItem(ADMIN_DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AdminData;
  } catch {
    return null;
  }
}
