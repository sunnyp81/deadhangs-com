#!/usr/bin/env node
// Read-only funnel counts from production D1. One SELECT of aggregates; never emails, names, IDs or free text.
// Usage: node scripts/funnel-readout.mjs   (needs wrangler auth for the production Cloudflare account)
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WRANGLER = "wrangler@4.158.0";
export const DATABASE = "deadhangs-accounts";
// Public price ids, mirrored from wrangler.jsonc env.production vars (checked by tests).
export const MONTHLY_PRICE = "price_1Ua2UxEp4lCx1so6NgBm7GPY";
export const YEARLY_PRICE = "price_1Ua2UyEp4lCx1so6ojJsesO8";

const DAY = 86400;
const ACTIVE = "eligible = 1 AND status = 'active'";
// Better Auth stores ISO-8601 UTC strings; billing columns are Unix seconds.
const isoSince = (days) => `julianday(createdAt) >= julianday('now', '-${days} days')`;

/** Fixed metric list: key, label, SQL expression returning one integer. */
export const METRICS = [
  ["users_total", "Accounts (all time)", "SELECT COUNT(*) FROM [user]"],
  ["users_28d", "Accounts created, last 28 days", `SELECT COUNT(*) FROM [user] WHERE ${isoSince(28)}`],
  ["users_7d", "Accounts created, last 7 days", `SELECT COUNT(*) FROM [user] WHERE ${isoSince(7)}`],
  ["active_users_7d", "Accounts with a session updated, last 7 days", "SELECT COUNT(DISTINCT userId) FROM [session] WHERE julianday(updatedAt) >= julianday('now', '-7 days')"],
  ["checkout_started_total", "Accounts that ever started checkout (latest start kept)", "SELECT COUNT(*) FROM billing_accounts WHERE checkout_started_at IS NOT NULL"],
  ["checkout_started_7d", "Accounts whose latest checkout start is in the last 7 days", `SELECT COUNT(*) FROM billing_accounts WHERE checkout_started_at >= unixepoch() - ${7 * DAY}`],
  ["paid_monthly", "Paid, active monthly", `SELECT COUNT(*) FROM billing_subscriptions WHERE ${ACTIVE} AND stripe_price_id = '${MONTHLY_PRICE}'`],
  ["paid_yearly", "Paid, active yearly", `SELECT COUNT(*) FROM billing_subscriptions WHERE ${ACTIVE} AND stripe_price_id = '${YEARLY_PRICE}'`],
  ["paid_other_price", "Paid, active, other price", `SELECT COUNT(*) FROM billing_subscriptions WHERE ${ACTIVE} AND stripe_price_id NOT IN ('${MONTHLY_PRICE}', '${YEARLY_PRICE}')`],
  ["cancel_at_period_end", "Paid, active, set to cancel at period end", `SELECT COUNT(*) FROM billing_subscriptions WHERE ${ACTIVE} AND cancel_at_period_end = 1`],
  // Reconciliation: Stripe says active but the app has not granted access (unfunded or unverified invoice).
  ["active_not_eligible", "Stripe status active, not access-eligible", "SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'active' AND eligible = 0"],
  ["active_not_eligible_cancelling", "Of those, set to cancel at period end", "SELECT COUNT(*) FROM billing_subscriptions WHERE status = 'active' AND eligible = 0 AND cancel_at_period_end = 1"],
];

/** One statement, one row, integer columns only. */
export function buildQuery() {
  return `SELECT ${METRICS.map(([key, , sql]) => `(${sql}) AS ${key}`).join(", ")}`;
}

/** Characters that a shell (cmd or POSIX) could expand or that would break the quoted argument. */
export const UNSAFE = /["%$`!^&|\\\n\r]/;
const FORBIDDEN = /\b(email|name|image|token|password|ipAddress|userAgent|accountId|idToken|accessToken|refreshToken|entries_json|stripe_customer_id|stripe_subscription_id|checkout_session_id|app_user_ref|lock_token|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH)\b/i;

export function assertSafe(sql) {
  if (!/^SELECT /.test(sql)) throw new Error("readout query must start with SELECT");
  if (UNSAFE.test(sql)) throw new Error("readout query contains a shell-unsafe character");
  if (FORBIDDEN.test(sql)) throw new Error("readout query names a personal column or a write keyword");
  if (sql.includes(";")) throw new Error("readout query must be a single statement");
  return sql;
}

/** Pull the single result row out of wrangler --json output, keeping only allowlisted integer keys. */
export function parseRow(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("wrangler output was not JSON (not printed)");
  }
  const row = Array.isArray(data) ? data[0]?.results?.[0] : data?.results?.[0];
  if (!row || typeof row !== "object") throw new Error("wrangler returned no result row");
  const out = {};
  for (const [key] of METRICS) {
    const value = row[key];
    if (!Number.isInteger(value) || value < 0) throw new Error(`metric ${key} was not a non-negative integer`);
    out[key] = value;
  }
  return out;
}

export function renderMarkdown(row, { generatedAt, commit }) {
  const lines = [
    `Generated ${generatedAt} (UTC) from D1 \`${DATABASE}\` (production, read-only) at commit \`${commit}\`. Windows are rolling, ending at the generation time.`,
    "",
    "| Metric | Count |",
    "|---|---:|",
    ...METRICS.map(([key, label]) => `| ${label} | ${row[key]} |`),
    "",
    "Notes: counts only. Sunny's own test subscription is included in the paid rows and is noted by hand, not filtered. `checkout_started_at` is overwritten by each new checkout, so it counts accounts, not attempts.",
  ];
  if (row.users_28d !== row.users_total) lines.push("", "Check: some accounts are older than 28 days.");
  return lines.join("\n");
}

function run() {
  const sql = assertSafe(buildQuery());
  const command = `npx --yes ${WRANGLER} d1 execute ${DATABASE} --remote --env production --json --command "${sql}"`;
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  let stdout;
  try {
    stdout = execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 20 });
  } catch (error) {
    // stderr can carry account details; report the exit status only.
    console.error(`wrangler failed with status ${error.status ?? "unknown"}. Check \`npx ${WRANGLER} whoami\` for the production account.`);
    process.exit(1);
  }
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {}
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  console.log(renderMarkdown(parseRow(stdout), { generatedAt, commit }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) run();
