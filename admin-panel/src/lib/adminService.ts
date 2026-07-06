import type {
  AdminData,
  AuditEntry,
  PendingDeposit,
  PendingTransfer,
  UserAccount,
  UserSummary
} from "../types";
import {
  accountIdFromEmail,
  cacheAccountsLocal,
  cacheAdminLocal,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  isToday,
  normalizeEmail,
  readAccountsLocal,
  readAdminLocal,
  usernameFromEmail
} from "./utils";
import * as api from "./api";

const DEFAULT_ADMIN: AdminData = {
  email: DEFAULT_ADMIN_EMAIL,
  password: DEFAULT_ADMIN_PASSWORD,
  balance: 0,
  payments: [],
  pendingTransfers: [],
  pendingDeposits: [],
  walletAddress: "1J8uJaQo7h9GTNStr8cWf7mnzqbPV6s2s2",
  bankDetails: "GlobalVest Admin · Routing: 021000021 · Account: 8847291053",
  userActivityLog: [],
  registeredUsers: {},
  notificationLog: [],
  auditLog: [],
  websiteSettings: {
    siteName: "GlobalVest",
    siteTagline: "Global Investing & Digital Banking",
    supportEmail: "support@globalvest.com",
    announcement: "",
    maintenanceMode: false
  }
};

function ensureAdminShape(admin: AdminData): AdminData {
  if (!admin.payments) admin.payments = [];
  if (!admin.pendingTransfers) admin.pendingTransfers = [];
  if (!admin.pendingDeposits) admin.pendingDeposits = [];
  if (!admin.userActivityLog) admin.userActivityLog = [];
  if (!admin.notificationLog) admin.notificationLog = [];
  if (!admin.registeredUsers) admin.registeredUsers = {};
  if (!admin.auditLog) admin.auditLog = [];
  if (!admin.websiteSettings) admin.websiteSettings = DEFAULT_ADMIN.websiteSettings!;
  return admin;
}

function mergeAccounts(
  server: Record<string, UserAccount>,
  local: Record<string, UserAccount>
): Record<string, UserAccount> {
  const merged = { ...server };
  Object.entries(local).forEach(([email, acct]) => {
    const key = normalizeEmail(email);
    merged[key] = merged[key] ? { ...merged[key], ...acct } : acct;
  });
  return merged;
}

export function getHoldingsSummary(holdings?: Record<string, number>): string {
  if (!holdings) return "No holdings";
  const labels: Record<string, string> = {
    btc: "BTC", eth: "ETH", sol: "SOL", xrp: "XRP", gold: "Gold",
    aapl: "AAPL", googl: "GOOGL", msft: "MSFT", nvda: "NVDA",
    spy: "SPY", qqq: "QQQ", vti: "VTI"
  };
  const parts: string[] = [];
  Object.entries(holdings).forEach(([key, val]) => {
    if (!val || val <= 0) return;
    parts.push(`${val} ${labels[key] || key.toUpperCase()}`);
  });
  return parts.length ? parts.join(" · ") : "No holdings";
}

function pendingTotal(account: UserAccount, admin: AdminData, email: string): number {
  const key = normalizeEmail(email);
  return (admin.pendingTransfers || [])
    .filter((t) => t.status === "pending" && normalizeEmail(t.userEmail) === key)
    .reduce((s, t) => s + t.amount, 0);
}

export function buildUserSummaries(
  accounts: Record<string, UserAccount>,
  admin: AdminData
): UserSummary[] {
  const pendingDeposits = (admin.pendingDeposits || []).filter((d) => d.status === "pending");
  const pendingTransfers = (admin.pendingTransfers || []).filter((t) => t.status === "pending");

  return Object.entries(accounts)
    .map(([email, acct]) => {
      const key = normalizeEmail(email);
      const profile = acct.profile || {};
      const pending = pendingTotal(acct, admin, key);
      const suspended = !!profile.suspended;
      const frozen = !!acct.withdrawalsFrozen;

      let accountStatus = "Active";
      if (suspended) accountStatus = "Suspended";
      else if (frozen) accountStatus = "Frozen";

      return {
        email: key,
        name: profile.fullName || key,
        username: profile.username || usernameFromEmail(key),
        phone: profile.phone || "—",
        accountId: accountIdFromEmail(key),
        cash: acct.cash || 0,
        availableBalance: Math.max(0, (acct.cash || 0) - pending),
        holdingsSummary: getHoldingsSummary(acct.holdings),
        verificationStatus: profile.verificationStatus || "Pending",
        accountStatus,
        emailVerified: !!acct.emailVerified,
        withdrawalsFrozen: frozen,
        memberSince: profile.memberSince || null,
        lastLoginAt: profile.lastLoginAt || null,
        lastLoginDevice: profile.lastLoginDevice || null,
        transactionCount: (acct.transactions || []).length,
        pendingDeposits: pendingDeposits.filter((d) => normalizeEmail(d.userEmail) === key).length,
        pendingTransfers: pendingTransfers.filter((t) => normalizeEmail(t.userEmail) === key).length
      };
    })
    .sort((a, b) => {
      const aT = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
      const bT = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      return bT - aT || a.email.localeCompare(b.email);
    });
}

export async function loadAllData(): Promise<{
  accounts: Record<string, UserAccount>;
  admin: AdminData;
  registryOnline: boolean;
}> {
  let serverAccounts: Record<string, UserAccount> = {};
  let serverAdmin: AdminData | null = null;
  let registryOnline = false;

  try {
    registryOnline = await api.checkRegistryHealth();
    serverAccounts = await api.fetchAccounts();
    serverAdmin = await api.fetchAdmin();
  } catch {
    /* fallback to local */
  }

  const localAccounts = readAccountsLocal();
  const localAdmin = readAdminLocal();
  const accounts = mergeAccounts(serverAccounts, localAccounts);
  const admin = ensureAdminShape(
    serverAdmin || localAdmin || { ...DEFAULT_ADMIN }
  );

  cacheAccountsLocal(accounts);
  cacheAdminLocal(admin);

  return { accounts, admin, registryOnline };
}

export function authenticateAdmin(
  email: string,
  password: string,
  admin: AdminData
): boolean {
  const key = normalizeEmail(email);
  return (
    key === normalizeEmail(admin.email) &&
    admin.password === password
  );
}

export function appendAudit(
  admin: AdminData,
  adminId: string,
  action: string,
  reason: string,
  opts: { amount?: number; userEmail?: string; details?: string } = {}
): AdminData {
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    adminId,
    action,
    reason,
    amount: opts.amount,
    userEmail: opts.userEmail ? normalizeEmail(opts.userEmail) : undefined,
    timestamp: new Date().toISOString(),
    details: opts.details
  };
  const next = { ...admin, auditLog: [entry, ...(admin.auditLog || [])].slice(0, 500) };
  return next;
}

export function recordActivity(
  admin: AdminData,
  userEmail: string,
  userName: string,
  type: string,
  description: string,
  amount = 0
): AdminData {
  return {
    ...admin,
    userActivityLog: [
      {
        id: Date.now() + Math.random(),
        date: new Date().toLocaleString(),
        userEmail: normalizeEmail(userEmail),
        userName,
        type,
        description,
        amount
      },
      ...(admin.userActivityLog || [])
    ].slice(0, 500)
  };
}

export async function persist(
  accounts: Record<string, UserAccount>,
  admin: AdminData
): Promise<void> {
  cacheAccountsLocal(accounts);
  cacheAdminLocal(admin);
  await Promise.all([
    ...Object.entries(accounts).map(([email, acct]) =>
      api.saveAccount(email, acct).catch(() => undefined)
    ),
    api.saveAdmin(admin).catch(() => undefined)
  ]);
}

export async function adjustBalance(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  userEmail: string,
  action: "credit" | "debit",
  amount: number,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const key = normalizeEmail(userEmail);
  const account = accounts[key];
  if (!account) throw new Error("User not found");
  if (!amount || amount <= 0) throw new Error("Enter a valid amount");
  if (action === "debit" && (account.cash || 0) < amount) {
    throw new Error("Insufficient balance");
  }

  const delta = action === "credit" ? amount : -amount;
  const updated: UserAccount = {
    ...account,
    cash: (account.cash || 0) + delta,
    transactions: [
      {
        date: new Date().toLocaleString(),
        description: `Admin ${action} — ${reason}`,
        amount: delta
      },
      ...(account.transactions || [])
    ],
    notifications: [
      {
        id: Date.now(),
        message: `Your account was ${action === "credit" ? "credited" : "debited"} $${amount.toFixed(2)}: ${reason}`,
        time: new Date().toISOString(),
        read: false
      },
      ...(account.notifications || [])
    ].slice(0, 30)
  };

  let nextAdmin = appendAudit(admin, adminId, `balance_${action}`, reason, {
    amount,
    userEmail: key
  });
  nextAdmin = recordActivity(
    nextAdmin,
    key,
    account.profile?.fullName || key,
    `admin-${action}`,
    `Balance ${action} $${amount.toFixed(2)} — ${reason}`,
    delta
  );
  nextAdmin = {
    ...nextAdmin,
    balance: (nextAdmin.balance || 0) + (action === "credit" ? 0 : amount),
    payments: [
      {
        id: Date.now(),
        userEmail: key,
        userName: account.profile?.fullName || key,
        type: action === "credit" ? "admin-credit" : "admin-debit",
        amount,
        method: reason,
        date: new Date().toLocaleString()
      },
      ...(nextAdmin.payments || [])
    ].slice(0, 200)
  };

  const nextAccounts = { ...accounts, [key]: updated };
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function setWithdrawalsFrozen(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  userEmail: string,
  frozen: boolean,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const key = normalizeEmail(userEmail);
  const account = accounts[key];
  if (!account) throw new Error("User not found");

  const now = new Date().toISOString();
  const updated: UserAccount = {
    ...account,
    withdrawalsFrozen: frozen,
    withdrawalsFrozenReason: frozen ? reason : "",
    withdrawalsFrozenAt: frozen ? now : undefined,
    transactions: [
      {
        date: new Date().toLocaleString(),
        description: frozen
          ? `Withdrawals frozen — ${reason || "Admin action"}`
          : "Withdrawals unfrozen",
        amount: 0
      },
      ...(account.transactions || [])
    ],
    notifications: [
      {
        id: Date.now(),
        message: frozen
          ? `Withdrawals frozen${reason ? ": " + reason : ""}`
          : "Withdrawal restrictions lifted",
        time: now,
        read: false
      },
      ...(account.notifications || [])
    ].slice(0, 30)
  };

  let nextAdmin = appendAudit(admin, adminId, frozen ? "freeze_withdrawals" : "unfreeze_withdrawals", reason, {
    userEmail: key
  });
  nextAdmin = recordActivity(
    nextAdmin,
    key,
    account.profile?.fullName || key,
    frozen ? "admin-freeze" : "admin-unfreeze",
    frozen ? "Withdrawals frozen" : "Withdrawals unfrozen",
    0
  );

  const nextAccounts = { ...accounts, [key]: updated };
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function setAccountSuspended(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  userEmail: string,
  suspended: boolean,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const key = normalizeEmail(userEmail);
  const account = accounts[key];
  if (!account) throw new Error("User not found");

  const profile = { ...(account.profile || {}), suspended };
  const updated: UserAccount = {
    ...account,
    profile,
    withdrawalsFrozen: suspended ? true : account.withdrawalsFrozen,
    withdrawalsFrozenReason: suspended ? reason : account.withdrawalsFrozenReason
  };

  let nextAdmin = appendAudit(admin, adminId, suspended ? "suspend_account" : "activate_account", reason, {
    userEmail: key
  });
  nextAdmin = recordActivity(
    nextAdmin,
    key,
    profile.fullName || key,
    suspended ? "admin-suspend" : "admin-activate",
    suspended ? "Account suspended" : "Account activated",
    0
  );

  const nextAccounts = { ...accounts, [key]: updated };
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function approveTransfer(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  transferId: string,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const transfer = (admin.pendingTransfers || []).find(
    (t) => t.id === transferId && t.status === "pending"
  );
  if (!transfer) throw new Error("Transfer not found");

  const key = normalizeEmail(transfer.userEmail);
  const account = accounts[key];
  if (!account) throw new Error("User not found");
  if ((account.cash || 0) < transfer.amount) throw new Error("Insufficient balance");

  const updated: UserAccount = {
    ...account,
    cash: (account.cash || 0) - transfer.amount,
    transactions: [
      {
        date: new Date().toLocaleString(),
        description: `Withdrawal approved — ${transfer.destination}`,
        amount: -transfer.amount
      },
      ...(account.transactions || [])
    ]
  };

  const nextTransfers = (admin.pendingTransfers || []).map((t) =>
    t.id === transferId ? { ...t, status: "approved" } : t
  );

  let nextAdmin = appendAudit(admin, adminId, "approve_withdrawal", reason, {
    amount: transfer.amount,
    userEmail: key
  });
  nextAdmin = {
    ...nextAdmin,
    pendingTransfers: nextTransfers,
    balance: (nextAdmin.balance || 0) - transfer.amount,
    payments: [
      {
        id: Date.now(),
        userEmail: key,
        userName: transfer.userName,
        type: "withdraw",
        amount: transfer.amount,
        method: transfer.method,
        date: new Date().toLocaleString()
      },
      ...(nextAdmin.payments || [])
    ].slice(0, 200)
  };

  const nextAccounts = { ...accounts, [key]: updated };
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function rejectTransfer(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  transferId: string,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const transfer = (admin.pendingTransfers || []).find(
    (t) => t.id === transferId && t.status === "pending"
  );
  if (!transfer) throw new Error("Transfer not found");

  const nextTransfers = (admin.pendingTransfers || []).map((t) =>
    t.id === transferId ? { ...t, status: "rejected" } : t
  );
  let nextAdmin = appendAudit(admin, adminId, "reject_withdrawal", reason, {
    amount: transfer.amount,
    userEmail: transfer.userEmail
  });
  nextAdmin = { ...nextAdmin, pendingTransfers: nextTransfers };

  await persist(accounts, nextAdmin);
  return { accounts, admin: nextAdmin };
}

export async function approveDeposit(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  depositId: string,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const deposit = (admin.pendingDeposits || []).find(
    (d) => d.id === depositId && d.status === "pending"
  );
  if (!deposit) throw new Error("Deposit not found");

  const key = normalizeEmail(deposit.userEmail);
  const account = accounts[key];
  if (!account) throw new Error("User not found");

  const updated: UserAccount = {
    ...account,
    cash: (account.cash || 0) + deposit.amount,
    transactions: [
      {
        date: new Date().toLocaleString(),
        description: `Deposit approved — ${deposit.method}`,
        amount: deposit.amount
      },
      ...(account.transactions || [])
    ]
  };

  const nextDeposits = (admin.pendingDeposits || []).map((d) =>
    d.id === depositId ? { ...d, status: "approved" } : d
  );

  let nextAdmin = appendAudit(admin, adminId, "approve_deposit", reason, {
    amount: deposit.amount,
    userEmail: key
  });
  nextAdmin = {
    ...nextAdmin,
    pendingDeposits: nextDeposits,
    balance: (nextAdmin.balance || 0) + deposit.amount,
    payments: [
      {
        id: Date.now(),
        userEmail: key,
        userName: deposit.userName,
        type: "deposit",
        amount: deposit.amount,
        method: deposit.method,
        date: new Date().toLocaleString()
      },
      ...(nextAdmin.payments || [])
    ].slice(0, 200)
  };

  const nextAccounts = { ...accounts, [key]: updated };
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function rejectDeposit(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  depositId: string,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const deposit = (admin.pendingDeposits || []).find(
    (d) => d.id === depositId && d.status === "pending"
  );
  if (!deposit) throw new Error("Deposit not found");

  const nextDeposits = (admin.pendingDeposits || []).map((d) =>
    d.id === depositId ? { ...d, status: "rejected" } : d
  );
  let nextAdmin = appendAudit(admin, adminId, "reject_deposit", reason, {
    amount: deposit.amount,
    userEmail: deposit.userEmail
  });
  nextAdmin = { ...nextAdmin, pendingDeposits: nextDeposits };

  await persist(accounts, nextAdmin);
  return { accounts, admin: nextAdmin };
}

export async function deleteUser(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  userEmail: string,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const key = normalizeEmail(userEmail);
  if (key === normalizeEmail(admin.email)) throw new Error("Cannot delete admin account");
  if (!accounts[key]) throw new Error("User not found");

  const nextAccounts = { ...accounts };
  delete nextAccounts[key];

  let nextAdmin = appendAudit(admin, adminId, "delete_user", reason, { userEmail: key });
  nextAdmin = recordActivity(nextAdmin, key, key, "admin-delete", "Account deleted", 0);
  nextAdmin = {
    ...nextAdmin,
    pendingTransfers: (nextAdmin.pendingTransfers || []).filter(
      (t) => normalizeEmail(t.userEmail) !== key || t.status !== "pending"
    ),
    pendingDeposits: (nextAdmin.pendingDeposits || []).filter(
      (d) => normalizeEmail(d.userEmail) !== key || d.status !== "pending"
    )
  };

  await api.deleteAccountApi(key).catch(() => undefined);
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function sendUserNotification(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  target: string,
  message: string,
  reason: string
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const nextAccounts = { ...accounts };
  const emails =
    target === "all"
      ? Object.keys(accounts)
      : [normalizeEmail(target)];

  emails.forEach((email) => {
    const acct = nextAccounts[email];
    if (!acct) return;
    nextAccounts[email] = {
      ...acct,
      notifications: [
        { id: Date.now() + Math.random(), message, time: new Date().toISOString(), read: false },
        ...(acct.notifications || [])
      ].slice(0, 30)
    };
  });

  let nextAdmin = appendAudit(admin, adminId, "send_notification", reason, {
    details: `Target: ${target}, ${emails.length} recipients`
  });
  nextAdmin = {
    ...nextAdmin,
    notificationLog: [
      {
        id: Date.now(),
        date: new Date().toLocaleString(),
        target: target === "all" ? "All users" : target,
        message,
        recipientCount: emails.length
      },
      ...(nextAdmin.notificationLog || [])
    ].slice(0, 100)
  };

  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export async function respondSupport(
  accounts: Record<string, UserAccount>,
  admin: AdminData,
  adminId: string,
  userEmail: string,
  ticketId: string | number,
  response: string,
  reason: string,
  markResolved: boolean
): Promise<{ accounts: Record<string, UserAccount>; admin: AdminData }> {
  const key = normalizeEmail(userEmail);
  const account = accounts[key];
  if (!account) throw new Error("User not found");

  const tickets = [...(account.supportTickets || [])];
  const idx = tickets.findIndex((t) => String(t.id) === String(ticketId));
  if (idx === -1) throw new Error("Ticket not found");

  const ticket = { ...tickets[idx] };
  ticket.responses = [
    ...(ticket.responses || []),
    { from: "admin" as const, message: response, date: new Date().toLocaleString() }
  ];
  if (markResolved) ticket.status = "Resolved";
  else if (ticket.status === "Open") ticket.status = "In Progress";
  tickets[idx] = ticket;

  const updated: UserAccount = {
    ...account,
    supportTickets: tickets,
    notifications: [
      {
        id: Date.now(),
        message: markResolved
          ? `Support ticket resolved: ${ticket.subject}`
          : `New admin reply: ${ticket.subject}`,
        time: new Date().toISOString(),
        read: false
      },
      ...(account.notifications || [])
    ].slice(0, 30)
  };

  let nextAdmin = appendAudit(admin, adminId, markResolved ? "support_resolve" : "support_reply", reason, {
    userEmail: key,
    details: ticket.subject
  });

  const nextAccounts = { ...accounts, [key]: updated };
  await persist(nextAccounts, nextAdmin);
  return { accounts: nextAccounts, admin: nextAdmin };
}

export function computeDashboardStats(
  accounts: Record<string, UserAccount>,
  admin: AdminData
) {
  const users = Object.keys(accounts);
  const pendingTransfers = (admin.pendingTransfers || []).filter((t) => t.status === "pending");
  const pendingDeposits = (admin.pendingDeposits || []).filter((d) => d.status === "pending");

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  (admin.payments || []).forEach((p) => {
    if (p.type === "deposit" || p.type === "admin-credit") totalDeposits += p.amount;
    if (p.type === "withdraw" || p.type === "admin-debit") totalWithdrawals += p.amount;
  });

  const totalBalance = users.reduce((s, e) => s + (accounts[e]?.cash || 0), 0);
  const activeUsers = users.filter((e) => {
    const p = accounts[e]?.profile;
    if (!p?.lastLoginAt) return false;
    const days = (Date.now() - new Date(p.lastLoginAt).getTime()) / 86400000;
    return days <= 30;
  }).length;

  const newSignupsToday = users.filter((e) =>
    isToday(accounts[e]?.profile?.memberSince)
  ).length;

  const verificationRequests = users.filter((e) => {
    const acct = accounts[e];
    const status = acct?.profile?.verificationStatus || "Pending";
    return status === "Pending" || status === "Under Review";
  }).length;

  return {
    totalUsers: users.length,
    totalDeposits,
    totalWithdrawals,
    totalBalance,
    totalProfit: (admin.balance || 0),
    pendingWithdrawals: pendingTransfers.length,
    pendingDeposits: pendingDeposits.length,
    activeUsers,
    newSignupsToday,
    verificationRequests,
    registryOnline: false as boolean
  };
}

export type { PendingDeposit, PendingTransfer };
