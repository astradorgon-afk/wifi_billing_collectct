import { createPlan, createCustomer, createInstallation } from "./db/repository";
import { addDays, prevMonth, todayISO } from "./dates";
import { runBatch } from "./db/database";
import { generateMonthlyInvoices, listInvoices, recordPayment } from "./db/repository";
import { nowISO } from "./dates";
import type { PlanInput, CustomerInput, InstallationInput } from "./types";

/** Wipe + insert demo data so the app is explorable immediately. */
export async function seedDemoData(): Promise<void> {
  // clear tables (order matters for FK clarity; sqlite FKs are off by default)
  await runBatch([
    { sql: `DELETE FROM payments` },
    { sql: `DELETE FROM invoices` },
    { sql: `DELETE FROM installations` },
    { sql: `DELETE FROM customers` },
    { sql: `DELETE FROM plans` },
  ]);

  const planDefs: PlanInput[] = [
    { name: "Home 25 Mbps", monthly_price: 99900, speed_mbps: 25 },
    { name: "Home 50 Mbps", monthly_price: 149900, speed_mbps: 50 },
    { name: "Business 100 Mbps", monthly_price: 249900, speed_mbps: 100 },
  ];
  const plans = [];
  for (const p of planDefs) plans.push(await createPlan(p));

  const people: Array<[string, string, string, number]> = [
    ["Maria Santos", "0917 123 4567", "Blk 2 Lot 5, Sampaguita St., Brgy. San Isidro", 0],
    ["Juan Dela Cruz", "0918 234 5678", "12 Rizal Ave., Poblacion", 1],
    ["Ana Reyes", "0919 345 6789", "Blk 7 Lot 12, Ilang-Ilang St.", 0],
    ["Pedro Bautista", "0920 456 7890", "23 Mabini Ext.", 2],
    ["Liza Gonzales", "0921 567 8901", "Blk 3 Lot 9, Acacia Dr.", 1],
    ["Carlo Mendoza", "0922 678 9012", "45 Bonifacio St.", 0],
    ["Grace Villanueva", "0923 789 0123", "Blk 10 Lot 3, Molave St.", 1],
    ["Ramon Aquino", "0924 890 1234", "8 Magsaysay Rd.", 2],
  ];

  const today = todayISO();
  const customers = [];
  for (let i = 0; i < people.length; i++) {
    const [name, phone, address, planIdx] = people[i];
    const input: CustomerInput = {
      full_name: name,
      phone,
      address,
      plan_id: plans[planIdx].id,
      status: i === 7 ? "inactive" : "active",
    };
    customers.push(await createCustomer(input));
  }

  // Installations: some done, some pending
  const installDefs: InstallationInput[] = [
    { customer_id: customers[0].id, scheduled_date: addDays(today, -20), installer: "Team A", installation_fee: 150000, notes: "Rooftop mount" },
    { customer_id: customers[1].id, scheduled_date: addDays(today, -18), installer: "Team A", installation_fee: 150000, notes: "" },
    { customer_id: customers[2].id, scheduled_date: addDays(today, -10), installer: "Team B", installation_fee: 100000, notes: "Pole share with neighbor" },
    { customer_id: customers[4].id, scheduled_date: addDays(today, -5), installer: "Team B", installation_fee: 150000, notes: "" },
    { customer_id: customers[5].id, scheduled_date: addDays(today, 1), installer: "Team C", installation_fee: 150000, notes: "Confirm access gate" },
    { customer_id: customers[6].id, scheduled_date: addDays(today, 3), installer: "Team C", installation_fee: 100000, notes: "" },
  ];
  const installs = [];
  for (const d of installDefs) installs.push(await createInstallation(d));

  // Mark the first four as completed (this creates installation invoices for fee>0)
  for (const ins of installs.slice(0, 4)) {
    const { setInstallationStatus } = await import("./db/repository");
    await setInstallationStatus(ins.id, "completed");
  }

  // Generate invoices for the previous month and the current month
  const prev = prevMonth(today.slice(0, 7));
  const cur = today.slice(0, 7);
  await generateMonthlyInvoices(prev);
  await generateMonthlyInvoices(cur);

  // Collect most of last month's invoices; a couple stay unpaid (arrears demo)
  const invoices = await listInvoices();
  const prevMonthly = invoices.filter(
    (i) => i.type === "monthly" && i.period_start.startsWith(prev),
  );
  let idx = 0;
  for (const inv of prevMonthly) {
    if (customers[5].id === inv.customer_id || customers[6].id === inv.customer_id) {
      idx++; // leave these two unpaid
      continue;
    }
    await recordPayment({
      invoice_id: inv.id,
      amount: inv.amount,
      method: idx % 2 === 0 ? "cash" : "gcash",
      reference: `SEED-${++idx}`,
      notes: "",
    });
  }

  // Partial payment demo on one current invoice
  const curFirst = invoices.find(
    (i) => i.type === "monthly" && i.period_start.startsWith(cur),
  );
  if (curFirst && curFirst.amount >= 20000) {
    await recordPayment({
      invoice_id: curFirst.id,
      amount: 20000,
      method: "cash",
      reference: "SEED-PARTIAL",
      notes: "Partial payment",
    });
  }

  // A recent activity timestamp so "recent payments" looks alive
  await runBatch([{ sql: `UPDATE payments SET paid_at = ? WHERE reference LIKE 'SEED-%'`, params: [nowISO()] }]);
}
