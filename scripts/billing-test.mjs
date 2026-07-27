// Tests for billing maths. These numbers end up on invoices, so the
// precedence order and the discount/tax sequence are asserted explicitly.
const B = await import("../src/lib/billing.ts");

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
  if (ok) pass++;
  else fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* -- rate precedence ----------------------------------------------------- */
{
  const all = {
    task: 50,
    projectMember: 40,
    project: 30,
    member: 20,
    workspaceDefault: 10,
  };
  check("task wins over everything", B.resolveRate(all).rate === 50);
  check("project member wins when no task rate",
    B.resolveRate({ ...all, task: null }).rate === 40);
  check("project wins when no member override",
    B.resolveRate({ ...all, task: null, projectMember: null }).rate === 30);
  check("workspace member wins over the default",
    B.resolveRate({ ...all, task: null, projectMember: null, project: null }).rate === 20);
  check("workspace default is the last resort",
    B.resolveRate({ task: null, projectMember: null, project: null, member: null, workspaceDefault: 10 }).rate === 10);
  check("no rate anywhere yields null, not zero",
    B.resolveRate({ task: null, projectMember: null, project: null, member: null, workspaceDefault: null }).rate === null);

  // Pro bono work is billed at 0. Treating that as "unset" would silently
  // charge the client the workspace default.
  const free = B.resolveRate({ ...all, task: 0 });
  check("a zero rate is honoured rather than falling through",
    free.rate === 0 && free.origin === "task");

  check("origin is reported so the UI can explain the rate",
    B.resolveRate({ ...all, task: null }).origin === "projectMember");
}

/* -- amounts ------------------------------------------------------------- */
{
  check("one hour at 50 is 50", B.amountFor(3600, 50) === 50);
  check("half an hour at 50 is 25", B.amountFor(1800, 50) === 25);
  check("zero seconds bills nothing", B.amountFor(0, 50) === 0);
  check("a zero rate bills nothing", B.amountFor(7200, 0) === 0);
}

/* -- invoice totals ------------------------------------------------------ */
{
  const lines = [
    { quantity: 10, unitAmount: 50 }, // 500
    { quantity: 2, unitAmount: 25 }, // 50
  ];
  const t = B.invoiceTotals(lines, 20, 50);
  check("subtotal sums the lines", t.subtotal === 550);
  // Discount before tax: (550 - 50) * 1.20 = 600. Taxing first would give 610.
  check("discount is applied before tax", t.taxable === 500 && near(t.tax, 100));
  check("total combines taxable and tax", near(t.total, 600));

  const noTax = B.invoiceTotals(lines, 0, 0);
  check("no tax or discount leaves the subtotal", noTax.total === 550);

  const overDiscount = B.invoiceTotals(lines, 0, 9999);
  check("a discount cannot push the total negative",
    overDiscount.total === 0, `got ${overDiscount.total}`);
}

/* -- budgets ------------------------------------------------------------- */
{
  const s = B.budgetStatus(36000, 500, 1000, 20); // 10h used, 500 spent
  check("budget usage is reported as a percentage",
    s.amountPercent === 50 && s.hoursPercent === 50);
  check("under budget does not flag", !s.isOverAmount && !s.isOverHours);

  const over = B.budgetStatus(360000, 2000, 1000, 20); // 100h, 2000 spent
  check("over budget flags on both amount and hours",
    over.isOverAmount && over.isOverHours);

  const none = B.budgetStatus(3600, 100, null, null);
  check("no budget set reports no percentage rather than zero",
    none.amountPercent === null && none.hoursPercent === null && !none.isOverAmount);
}

/* -- cost per 1k views --------------------------------------------------- */
{
  check("cost per 1k views divides by thousands of views",
    B.costPerThousandViews(100, 50000) === 2);
  check("zero views yields null, never Infinity",
    B.costPerThousandViews(100, 0) === null);
}

/* -- invoice numbering --------------------------------------------------- */
{
  const year = new Date().getFullYear();
  check("first invoice of the year starts at 0001",
    B.nextInvoiceNumber([]) === `INV-${year}-0001`);
  check("numbering continues from the highest existing",
    B.nextInvoiceNumber([`INV-${year}-0001`, `INV-${year}-0007`]) === `INV-${year}-0008`);
  check("other years do not affect this year's sequence",
    B.nextInvoiceNumber([`INV-${year - 1}-0042`]) === `INV-${year}-0001`);
  check("malformed numbers are ignored rather than crashing",
    B.nextInvoiceNumber([`INV-${year}-abc`, `INV-${year}-0003`]) === `INV-${year}-0004`);
}

/* -- money formatting ---------------------------------------------------- */
{
  check("an unknown currency code degrades instead of throwing",
    typeof B.formatMoney(10, "NOTACURRENCY") === "string");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
