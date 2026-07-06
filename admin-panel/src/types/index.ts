export interface UserProfile {
  fullName?: string;
  phone?: string;
  memberSince?: string;
  lastLoginAt?: string;
  lastLoginDevice?: string;
  verificationStatus?: string;
  ssnLast4?: string;
  suspended?: boolean;
  username?: string;
}

export interface Transaction {
  date: string;
  description: string;
  amount: number;
}

export interface Notification {
  id: number | string;
  message: string;
  time: string;
  read?: boolean;
}

export interface SupportResponse {
  from: "admin" | "user";
  message: string;
  date: string;
}

export interface SupportTicket {
  id: number | string;
  subject: string;
  message: string;
  status: string;
  date: string;
  type?: string;
  responses?: SupportResponse[];
  assignedTo?: string;
  internalNotes?: string;
}

export interface PendingTransfer {
  id: string;
  userEmail: string;
  userName: string;
  amount: number;
  destination: string;
  method: string;
  status: string;
  date: string;
  requestedAt?: string;
}

export interface PendingDeposit {
  id: string;
  userEmail: string;
  userName: string;
  amount: number;
  method: string;
  payTo: string;
  status: string;
  date: string;
}

export interface PaymentRecord {
  id: number | string;
  userEmail: string;
  userName: string;
  type: string;
  amount: number;
  method: string;
  date: string;
}

export interface ActivityEntry {
  id: number | string;
  date: string;
  userEmail: string;
  userName: string;
  type: string;
  description: string;
  amount: number;
}

export interface AuditEntry {
  id: string;
  adminId: string;
  action: string;
  reason: string;
  amount?: number;
  userEmail?: string;
  timestamp: string;
  details?: string;
}

export interface WebsiteSettings {
  siteName: string;
  siteTagline: string;
  supportEmail: string;
  announcement: string;
  maintenanceMode: boolean;
}

export interface AdminData {
  email: string;
  password: string;
  balance: number;
  payments: PaymentRecord[];
  pendingTransfers: PendingTransfer[];
  pendingDeposits: PendingDeposit[];
  walletAddress: string;
  bankDetails: string;
  userActivityLog: ActivityEntry[];
  registeredUsers: Record<string, unknown>;
  notificationLog: Array<{
    id: number | string;
    date: string;
    target: string;
    message: string;
    recipientCount: number;
  }>;
  auditLog?: AuditEntry[];
  websiteSettings?: WebsiteSettings;
}

export interface UserAccount {
  password?: string;
  cash: number;
  emailVerified?: boolean;
  holdings?: Record<string, number>;
  transactions?: Transaction[];
  notifications?: Notification[];
  profile?: UserProfile;
  pendingTransfers?: Array<{ id: string; amount: number; destination: string; status: string; date: string }>;
  withdrawalsFrozen?: boolean;
  withdrawalsFrozenReason?: string;
  withdrawalsFrozenAt?: string;
  supportTickets?: SupportTicket[];
  settings?: Record<string, unknown>;
}

export interface UserSummary {
  email: string;
  name: string;
  username: string;
  phone: string;
  accountId: string;
  cash: number;
  availableBalance: number;
  holdingsSummary: string;
  verificationStatus: string;
  accountStatus: string;
  emailVerified: boolean;
  withdrawalsFrozen: boolean;
  memberSince: string | null;
  lastLoginAt: string | null;
  lastLoginDevice: string | null;
  transactionCount: number;
  pendingDeposits: number;
  pendingTransfers: number;
}

export interface AdminSession {
  email: string;
  adminId: string;
}

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}
