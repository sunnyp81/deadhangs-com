#!/usr/bin/env node
// Read-only programme readout from production D1. Aggregates only: no emails, ids, notes or hold times leave the database.
// Usage: node scripts/programme-readout.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--exclude-users id1,id2] [--asof YYYY-MM-DD]
//   Window is inclusive, UTC, on purchase or signup time. Live-mode rows only; test-mode rows never count.
//   --exclude-users drops owner test accounts (internal user ids from D1) from every count.
// Definitions (also in docs/programme-operations.md):
//   purchaser            distinct user with a live purchase in the window now in status paid, refunded or disputed
//   gross receipts       sum of amounts for those purchases (money taken, before refunds)
//   refunds              sum of amounts now refunded (full refund or lost dispute); disputed amounts are shown apart
//   net receipts         gross minus refunds minus disputed
//   enrolled             purchaser (paid) who has saved a programme start
//   week-4 participation purchasers paid at least 21 days before --asof with any recorded week 4 session
//   completion           purchasers whose last session (test day or unassisted check) is recorded
//   checkout started     live checkout sessions created in the window, whatever happened next
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WRANGLER = 'wrangler@4.158.0';
export const DATABASE = 'deadhangs-accounts';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const USER = /^[A-Za-z0-9_-]{1,64}$/;
const day = (date) => date.toISOString().slice(0, 10);

export function parseArgs(argv, now = new Date()) {
  const args = { from: null, to: null, asof: null, exclude: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1] ?? ''];
    if (flag === '--exclude-users') {
      args.exclude = value.split(',').map((v) => v.trim()).filter(Boolean);
      if (args.exclude.some((id) => !USER.test(id))) throw new Error('--exclude-users takes comma-separated user ids');
      continue;
    }
    if (!['--from', '--to', '--asof'].includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (!DATE.test(value)) throw new Error(`${flag} must be YYYY-MM-DD`);
    args[flag.slice(2)] = value;
  }
  args.to ??= day(now);
  args.asof ??= day(now);
  args.from ??= day(new Date(Date.parse(`${args.to}T00:00:00Z`) - 27 * 86400000));
  if (args.from > args.to) throw new Error('--from is after --to');
  return args;
}

const epoch = (date, endOfDay = false) => Math.floor(Date.parse(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}Z`) / 1000);

/** One SELECT of aggregates. Values are validated before they reach the SQL text. */
export function buildQuery({ from, to, asof, exclude }) {
  const lo = epoch(from); const hi = epoch(to, true); const cutoff = epoch(asof, true) - 21 * 86400;
  const notExcluded = exclude.length ? `AND (p.user_id IS NULL OR p.user_id NOT IN (${exclude.map((id) => `'${id}'`).join(',')}))` : '';
  const purchases = `programme_purchases p WHERE p.provider_mode='live' AND p.created_at BETWEEN ${lo} AND ${hi} ${notExcluded}`;
  const settled = `${purchases} AND p.status IN ('paid','refunded','disputed')`;
  const lastSession = `EXISTS (SELECT 1 FROM json_each(g.state_json,'$.results') r WHERE json_extract(r.value,'$.sessionKey')='w4s3')`;
  const week4 = `EXISTS (SELECT 1 FROM json_each(g.state_json,'$.results') r WHERE json_extract(r.value,'$.sessionKey') LIKE 'w4s%')`;
  const paidBuyers = `SELECT DISTINCT p.user_id FROM ${purchases} AND p.status='paid' AND p.user_id IS NOT NULL`;
  return `SELECT
 (SELECT COUNT(*) FROM ${purchases}) checkout_started,
 (SELECT COUNT(DISTINCT COALESCE(p.user_id, p.checkout_session_id)) FROM ${settled}) purchasers,
 (SELECT COUNT(*) FROM ${settled}) settled_purchases,
 (SELECT COALESCE(SUM(p.amount),0) FROM ${settled}) gross_pence,
 (SELECT COALESCE(SUM(p.amount),0) FROM ${purchases} AND p.status='refunded') refunded_pence,
 (SELECT COALESCE(SUM(p.amount),0) FROM ${purchases} AND p.status='disputed') disputed_pence,
 (SELECT COUNT(*) FROM ${purchases} AND p.status='paid') paid_now,
 (SELECT COUNT(*) FROM ${purchases} AND p.status='refunded') refunded_now,
 (SELECT COUNT(*) FROM ${purchases} AND p.status='disputed') disputed_now,
 (SELECT COUNT(*) FROM ${purchases} AND p.status IN ('pending','expired')) unpaid_checkouts,
 (SELECT COUNT(*) FROM programme_progress g WHERE g.user_id IN (${paidBuyers})) enrolled,
 (SELECT COUNT(*) FROM programme_progress g WHERE g.user_id IN (${paidBuyers}) AND json_extract(g.state_json,'$.route')='supported') enrolled_supported,
 (SELECT COUNT(DISTINCT p.user_id) FROM ${purchases} AND p.status='paid' AND p.paid_at <= ${cutoff}) week4_eligible,
 (SELECT COUNT(*) FROM programme_progress g WHERE g.user_id IN (SELECT DISTINCT p.user_id FROM ${purchases} AND p.status='paid' AND p.paid_at <= ${cutoff}) AND ${week4}) week4_active,
 (SELECT COUNT(*) FROM programme_progress g WHERE g.user_id IN (${paidBuyers}) AND ${lastSession}) completed,
 (SELECT COALESCE(SUM(json_array_length(g.state_json,'$.results')),0) FROM programme_progress g WHERE g.user_id IN (${paidBuyers})) sessions_recorded,
 (SELECT COUNT(*) FROM programme_interest i WHERE i.created_at BETWEEN ${lo} AND ${hi}) interest_signups,
 (SELECT COUNT(*) FROM programme_interest i WHERE i.notified_at IS NULL) interest_waiting`;
}

const gbp = (pence) => `GBP ${(pence / 100).toFixed(2)}`;
const rate = (part, whole) => (whole >= 30 ? `${((part / whole) * 100).toFixed(1)}%` : `not enough data (${part} of ${whole})`);

/** Plain report. Rates are shown only from 30 in the denominator; below that the raw counts are shown. */
export function summarise(row, args) {
  const net = row.gross_pence - row.refunded_pence - row.disputed_pence;
  return [
    `Programme readout, live mode only, purchases created ${args.from} to ${args.to} (UTC); week-4 cut-off ${args.asof} minus 21 days.`,
    args.exclude.length ? `Excluded ${args.exclude.length} owner test account(s).` : 'No accounts excluded; owner test purchases, if any, are included.',
    `Checkouts started: ${row.checkout_started}; unpaid or expired: ${row.unpaid_checkouts}.`,
    `Purchasers: ${row.purchasers} (paid now ${row.paid_now}, refunded ${row.refunded_now}, disputed ${row.disputed_now}).`,
    `Gross receipts ${gbp(row.gross_pence)}; refunds ${gbp(row.refunded_pence)}; disputed ${gbp(row.disputed_pence)}; net ${gbp(net)}. Before Stripe fees and tax.`,
    `Enrolled: ${row.enrolled} of ${row.paid_now} paid (${row.enrolled_supported} on the supported route). Sessions recorded: ${row.sessions_recorded}.`,
    `Week-4 participation: ${rate(row.week4_active, row.week4_eligible)} of purchasers paid 21+ days ago.`,
    `Completion: ${rate(row.completed, row.paid_now)} of paid purchasers.`,
    `Interest signups in window: ${row.interest_signups}; waiting for the launch email: ${row.interest_waiting}.`,
    'Pro subscription revenue is not in D1: read it from Stripe. Annual payments are cash received once, not monthly income.',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let out;
  try {
    out = execSync(`npx --yes ${WRANGLER} d1 execute ${DATABASE} --remote --json --command "${buildQuery(args).replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const text = String(error.stderr || error.message);
    if (/no such table/i.test(text)) { console.log('Programme tables are not in production yet (migration 0005 not applied). Nothing to report.'); return; }
    console.error(`wrangler failed with status ${error.status ?? 1}. Check \`npx ${WRANGLER} whoami\` for the production account.`);
    process.exit(1);
  }
  const row = JSON.parse(out)[0].results[0];
  console.log(summarise(row, args));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
