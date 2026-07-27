/**
 * Billing maths and rate resolution (PRD 6.2).
 *
 * Mirrors resolve_billable_rate() in SQL. The database version is authoritative
 * for aggregate reporting; this one exists so the UI can show what a rate will
 * be without a round trip. If they ever disagree, the SQL wins -- it is what
 * invoices are built from.
 */

export type RateSources = {
  task: number | null;
  projectMember: number | null;
  project: number | null;
  member: number | null;
  workspaceDefault: number | null;
};

export type RateOrigin =
  | "task"
  | "projectMember"
  | "project"
  | "member"
  | "workspaceDefault"
  | "none";

/**
 * Highest-precedence non-null rate wins. Zero is a real rate -- pro bono work
 * is billed at 0, which must not fall through to a higher default.
 */
export function resolveRate(s: RateSources): { rate: number | null; origin: RateOrigin } {
  if (s.task != null) return { rate: s.task, origin: "task" };
  if (s.projectMember != null) return { rate: s.projectMember, origin: "projectMember" };
  if (s.project != null) return { rate: s.project, origin: "project" };
  if (s.member != null) return { rate: s.member, origin: "member" };
  if (s.workspaceDefault != null)
    return { rate: s.workspaceDefault, origin: "workspaceDefault" };
  return { rate: null, origin: "none" };
}

export const RATE_ORIGIN_LABELS: Record<RateOrigin, string> = {
  task: "Task rate",
  projectMember: "Project member rate",
  project: "Project rate",
  member: "Member rate",
  workspaceDefault: "Workspace default",
  none: "No rate set",
};

export function amountFor(seconds: number, hourlyRate: number): number {
  return (seconds / 3600) * hourlyRate;
}

export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown or malformed currency codes must not blank out a whole report.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export type InvoiceTotals = {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
};

/**
 * Discount is applied before tax, which is the common convention and the one
 * that produces the smaller tax figure -- getting this backwards overcharges.
 */
export function invoiceTotals(
  lines: { quantity: number; unitAmount: number }[],
  taxPercent = 0,
  discountAmount = 0,
): InvoiceTotals {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitAmount, 0);
  const discount = Math.min(discountAmount, subtotal);
  const taxable = subtotal - discount;
  const tax = taxable * (taxPercent / 100);
  return { subtotal, discount, taxable, tax, total: taxable + tax };
}

export type BudgetStatus = {
  usedAmount: number;
  budgetAmount: number | null;
  usedHours: number;
  budgetHours: number | null;
  amountPercent: number | null;
  hoursPercent: number | null;
  isOverAmount: boolean;
  isOverHours: boolean;
};

export function budgetStatus(
  usedSeconds: number,
  usedAmount: number,
  budgetAmount: number | null,
  budgetHours: number | null,
): BudgetStatus {
  const usedHours = usedSeconds / 3600;
  const amountPercent =
    budgetAmount && budgetAmount > 0 ? (usedAmount / budgetAmount) * 100 : null;
  const hoursPercent =
    budgetHours && budgetHours > 0 ? (usedHours / budgetHours) * 100 : null;
  return {
    usedAmount,
    budgetAmount,
    usedHours,
    budgetHours,
    amountPercent,
    hoursPercent,
    isOverAmount: amountPercent != null && amountPercent > 100,
    isOverHours: hoursPercent != null && hoursPercent > 100,
  };
}

/**
 * Cost per 1,000 views, per platform.
 *
 * Deliberately takes one platform's views at a time. Passing a cross-platform
 * total would produce a confident-looking number built on incomparable units
 * (PRD 5 Step 2).
 */
export function costPerThousandViews(
  cost: number,
  platformViews: number,
): number | null {
  if (platformViews <= 0) return null;
  return cost / (platformViews / 1000);
}

/** Next invoice number in a simple zero-padded sequence. */
export function nextInvoiceNumber(existing: string[]): string {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const highest = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}
