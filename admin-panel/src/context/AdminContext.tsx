import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { AdminData, AdminSession, Toast, UserAccount } from "../types";
import {
  authenticateAdmin,
  buildUserSummaries,
  computeDashboardStats,
  loadAllData
} from "../lib/adminService";
import * as AdminOps from "../lib/adminService";
import {
  clearSession,
  DEFAULT_ADMIN_EMAIL,
  getSession,
  setSession
} from "../lib/utils";

interface AdminContextValue {
  accounts: Record<string, UserAccount>;
  admin: AdminData;
  session: AdminSession | null;
  users: ReturnType<typeof buildUserSummaries>;
  stats: ReturnType<typeof computeDashboardStats> & { registryOnline: boolean };
  loading: boolean;
  refreshing: boolean;
  toasts: Toast[];
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  showToast: (type: Toast["type"], message: string) => void;
  runAction: <T>(fn: () => Promise<T>) => Promise<T>;
  adminId: string;
  setData: (accounts: Record<string, UserAccount>, admin: AdminData) => void;
  ops: typeof AdminOps;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Record<string, UserAccount>>({});
  const [admin, setAdmin] = useState<AdminData | null>(null);
  const [session, setSessionState] = useState<AdminSession | null>(getSession);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [registryOnline, setRegistryOnline] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const actionLock = useRef(false);

  const showToast = useCallback((type: Toast["type"], message: string) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await loadAllData();
      setAccounts(data.accounts);
      setAdmin(data.admin);
      setRegistryOnline(data.registryOnline);
    } catch {
      showToast("error", "Failed to refresh data");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await loadAllData();
      if (!authenticateAdmin(email, password, data.admin)) return false;
      const adminId = normalizeAdminId(email);
      const sess = { email: data.admin.email, adminId };
      setSession(sess);
      setSessionState(sess);
      setAccounts(data.accounts);
      setAdmin(data.admin);
      setRegistryOnline(data.registryOnline);
      setLoading(false);
      return true;
    },
    []
  );

  const logout = useCallback(() => {
    clearSession();
    setSessionState(null);
  }, []);

  const setData = useCallback(
    (nextAccounts: Record<string, UserAccount>, nextAdmin: AdminData) => {
      setAccounts(nextAccounts);
      setAdmin(nextAdmin);
    },
    []
  );

  const runAction = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      if (actionLock.current) throw new Error("Action already in progress");
      actionLock.current = true;
      try {
        const result = await fn();
        showToast("success", "Action completed successfully");
        await refresh();
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Action failed";
        showToast("error", msg);
        throw err;
      } finally {
        actionLock.current = false;
      }
    },
    [refresh, showToast]
  );

  const adminData = admin || {
    email: DEFAULT_ADMIN_EMAIL,
    password: "",
    balance: 0,
    payments: [],
    pendingTransfers: [],
    pendingDeposits: [],
    walletAddress: "",
    bankDetails: "",
    userActivityLog: [],
    registeredUsers: {},
    notificationLog: [],
    auditLog: []
  };

  const users = useMemo(
    () => buildUserSummaries(accounts, adminData),
    [accounts, adminData]
  );

  const stats = useMemo(() => {
    const base = computeDashboardStats(accounts, adminData);
    return { ...base, registryOnline };
  }, [accounts, adminData, registryOnline]);

  const value: AdminContextValue = {
    accounts,
    admin: adminData,
    session,
    users,
    stats,
    loading,
    refreshing,
    toasts,
    refresh,
    login,
    logout,
    showToast,
    runAction,
    adminId: session?.adminId || "admin",
    setData,
    ops: AdminOps
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

function normalizeAdminId(email: string): string {
  return email.split("@")[0] || "admin";
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
