export type CustomerStatus = "active" | "inactive";
export type InstallationStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type InvoiceStatus = "unpaid" | "partial" | "paid" | "void";
export type InvoiceType = "monthly" | "installation";
export type PaymentMethod = "cash" | "gcash" | "bank" | "other";

export interface Plan {
  id: string;
  name: string;
  monthly_price: number; // smallest currency unit
  speed_mbps: number;
  active: number; // 1 | 0
}

export interface Customer {
  id: string;
  full_name: string;
  phone: string;
  address: string;
  plan_id: string | null;
  status: CustomerStatus;
  created_at: string;
  archived: number;
  archived_at: string | null;
}

export interface CustomerWithPlan extends Customer {
  plan_name: string | null;
  monthly_price: number | null;
  speed_mbps: number | null;
  balance: number; // outstanding across invoices
}

export interface Installation {
  id: string;
  customer_id: string;
  scheduled_date: string | null;
  started_at: string | null;
  completed_date: string | null;
  installer: string | null;
  status: InstallationStatus;
  installation_fee: number;
  notes: string | null;
  created_at: string;
  archived: number;
  archived_at: string | null;
}

export interface InstallationWithCustomer extends Installation {
  customer_name: string;
  customer_phone: string;
}

export interface Invoice {
  id: string;
  customer_id: string;
  period_start: string;
  period_end: string;
  amount: number;
  type: InvoiceType;
  status: InvoiceStatus;
  due_date: string;
  created_at: string;
}

export interface InvoiceWithMeta extends Invoice {
  customer_name: string;
  paid: number;
  balance: number;
  invoice_no: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
  recorded_by: string | null;
  device_id: string | null;
  cancelled: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
}

export interface PaymentWithMeta extends Payment {
  invoice_no: string;
  customer_name: string;
  customer_id: string;
  invoice_amount: number;
  invoice_balance: number; // balance BEFORE this payment
  recorded_by_name: string | null;
}

export interface DashboardStats {
  activeCustomers: number;
  mrr: number;
  monthInvoiced: number;
  monthCollected: number;
  outstanding: number;
  unpaidInvoices: number;
  activeInstallations: number;
  collectionRate: number; // 0..1
}

export interface BillingHealth {
  activeCustomers: number;
  planless: number;
  invoiced: number;
  needsGeneration: boolean;
}

export interface PlanInput {
  name: string;
  monthly_price: number;
  speed_mbps: number;
}

export interface CustomerInput {
  full_name: string;
  phone: string;
  address: string;
  plan_id: string | null;
  status: CustomerStatus;
}

export interface InstallationInput {
  customer_id: string;
  scheduled_date: string | null;
  installer: string;
  installation_fee: number;
  notes: string;
}

export interface PaymentInput {
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes: string;
  recorded_by?: string | null;
  device_id?: string | null;
}

export type UserRole = "owner" | "collector";

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  must_change_pin: boolean;
  created_at: string;
}

/** Thin user identity persisted in the session (no secrets). */
export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  mustChangePin: boolean;
}

export type RequestType = "payment_reversal";

export type RequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  type: RequestType;
  payload: Record<string, unknown>;
  status: RequestStatus;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface AuditLogEntry {
  id: string;
  ts: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  device_id: string | null;
}

export interface SyncState {
  configured: boolean;
  enabled: boolean;
  syncing: boolean;
  lastSync: string | null;
  lastError: string | null;
}