#!/usr/bin/env node
// Read-only counts of one-off plan purchases from production D1. Aggregates only; never emails, tokens, inputs or free text.
// Usage: node scripts/plan-readout.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//   Default window: the 28 days ending today (UTC). Both dates are inclusive.
// Needs wrangler auth for the production Cloudflare account. Prints a clear note, not an error, if migration 0003 is not applied yet.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WRANGLER = "wrangler@4.158.0";
export const DATABASE = "deadhangs-accounts";
export const TABLE = "plan_purchases";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Reasons are a four-option radio; anything else is bucketed so free text never reaches the output.
const REASON = /^[a-z_]{1,40}$/;

const isoDay = (date) => date.toISOString().slice(0, 10);

/** Validate --from and --to (UTC calendar dates, inclusive). Defaults to the 28 days ending on `now`. */
export function parseArgs(argv, now = new Date()) {
  const args = { from: null, to: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== "--from" && flag !== "--to") throw new Error(`unknown argument ${flag}`);
    if (!DATE.test(value ?? "")) throw new Error(`${flag} must be YYYY-MM-DD`);
    args[flag.slice(2)] = value;
  }
  args.to ??= isoDay(now);
  args.from ??= isoDay(new Date(Date.parse(`${args.to}T00:00:00Z`) - 27 * 86400000));
  for (const key of ["from", "to"]) {
    const parsed = new Date(Date.parse(`${args[key]}T00:00:00Z`));
    if (Number.isNaN(parsed.getTime()) || isoDay(parsed) !== args[key]) throw new Error(`--${key} is not a real date`);
  }
  if (args.from > args.to) throw new Error("--from is after --to");
  return args;
}

/** Window on Unix-second columns. Dates are validated by parseArgs before they reach SQL. */
export function windowSql(column, { from, to }) {
  return `${column} >= unixepoch('${from}') AND ${column} < unixepoch('${to}', '+1 day')`;
}

/** Table check: one row, one integer. Run first so a missing table is reported, not thrown. */
export function tableCheckSql() {
  return `SELECT COUNT(*) AS present FROM sqlite_master WHERE type = 'table' AND name = '${TABLE}'`;
}

/** Fixed aggregate row for the window. */
export function metricsSql(range) {
  const inWindow = windowSql("created_at", range);
  const refundDated = windowSql("refunded_at", range);
  return `SELECT `
    + `(SELECT COUNT(*) FROM ${TABLE} WHERE ${inWindow}) AS purchases_in_window, `
    + `(SELECT COUNT(*) FROM ${TABLE} WHERE ${inWindow} AND status = 'paid') AS paid_in_window, `
    + `(SELECT COUNT(*) FROM ${TABLE} WHERE ${inWindow} AND status = 'refunded') AS refunded_in_window, `
    + `(SELECT COUNT(*) FROM ${TABLE} WHERE ${refundDated}) AS refunds_dated_in_window, `
    + `(SELECT COUNT(*) FROM ${TABLE}) AS purchases_all_time`;
}

/** Reason counts for the window, one row per distinct reason value. */
export function reasonsSql(range) {
  return `SELECT reason, COUNT(*) AS n FROM ${TABLE} WHERE ${windowSql("created_at", range)} GROUP BY reason`;
}

/** Characters that a shell (cmd or POSIX) could expand or that would break the quoted argument. */
export const UNSAFE = /["%$`!^&|\\\n\r]/;
const FORBIDDEN = /\b(email|token|token_hash|inputs|payment_intent_id|checkout_session_id|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH)\b/i;

export function assertSafe(sql) {
  if (!/^SELECT /.test(sql)) throw new Error("readout query must start with SELECT");
  if (UNSAFE.test(sql)) throw new Error("readout query contains a shell-unsafe character");
  if (FORBIDDEN.test(sql)) throw new Error("readout query names a personal column or a write keyword");
  if (sql.includes(";")) throw new Error("readout query must be a single statement");
  return sql;
}

/** First result row from wrangler --json output. Returns null when there is no row. */
export function firstRow(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("wrangler output was not JSON (not printed)");
  }
  const rows = Array.isArray(data) ? data[0]?.results : data?.results;
  return Array.isArray(rows) ? rows : [];
}

/** Keep only allowlisted non-negative integers from the aggregate row. */
export function parseMetrics(stdout) {
  const row = firstRow(stdout)[0];
  if (!row || typeof row !== "object") throw new Error("wrangler returned no result row");
  const keys = ["purchases_in_window", "paid_in_window", "refunded_in_window", "refunds_dated_in_window", "purchases_all_time"];
  const out = {};
  for (const key of keys) {
    const value = row[key];
    if (!Number.isInteger(value) || value < 0) throw new Error(`metric ${key} was not a non-negative integer`);
    out[key] = value;
  }
  return out;
}

/** Reason rows as counts. Non-allowlisted or blank reasons are grouped, never printed. */
export function parseReasons(stdout) {
  const counts = new Map();
  for (const row of firstRow(stdout)) {
    const n = Number.isInteger(row?.n) && row.n >= 0 ? row.n : 0;
    let label = "not_answered";
    if (typeof row?.reason === "string" && row.reason.length > 0) {
      label = REASON.test(row.reason) ? row.reason : "other_text_not_shown";
    }
    counts.set(label, (counts.get(label) ?? 0) + n);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function renderMarkdown(metrics, reasons, { range, generatedAt, commit }) {
  const lines = [
    `Window ${range.from} to ${range.to} (UTC, inclusive), generated ${generatedAt} from D1 \`${DATABASE}\` (production, read-only) at commit \`${commit}\`.`,
    "",
    "| Measure | Count |",
    "|---|---:|",
    `| Purchases created in window | ${metrics.purchases_in_window} |`,
    `| Of those, still paid | ${metrics.paid_in_window} |`,
    `| Of those, refunded | ${metrics.refunded_in_window} |`,
    `| Refunds dated in window (any purchase date) | ${metrics.refunds_dated_in_window} |`,
    `| Purchases all time | ${metrics.purchases_all_time} |`,
    "",
    "Reasons given in window (from the success page question):",
    "",
    "| Reason | Count |",
    "|---|---:|",
    ...(reasons.length ? reasons.map(([reason, n]) => `| ${reason} | ${n} |`) : ["| (none) | 0 |"]),
    "",
    "Notes: counts only. Windows use purchase time for purchases and refund time for refunds. Sales and clicks come from GA4 events, not this script.",
  ];
  return lines.join("\n");
}

export function renderMissingTable() {
  return [
    `Table \`${TABLE}\` is not in production D1 \`${DATABASE}\`.`,
    "Migration 0003 is not applied yet, so there are no plan purchases to count. Nothing was changed.",
    "Apply it with the launch checklist (plan8-launch-checklist.md), then run this again.",
  ].join("\n");
}

function runWrangler(sql, cwd) {
  const command = `npx --yes ${WRANGLER} d1 execute ${DATABASE} --remote --env production --json --command "${assertSafe(sql)}"`;
  try {
    return execSync(command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 20 });
  } catch (error) {
    // stderr can carry account details; report the exit status only.
    console.error(`wrangler failed with status ${error.status ?? "unknown"}. Check \`npx ${WRANGLER} whoami\` for the production account.`);
    process.exit(1);
  }
}

function run() {
  let range;
  try {
    range = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("Usage: node scripts/plan-readout.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
    process.exit(2);
  }
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const present = firstRow(runWrangler(tableCheckSql(), cwd))[0]?.present;
  if (present !== 1) {
    console.log(renderMissingTable());
    return;
  }
  const metrics = parseMetrics(runWrangler(metricsSql(range), cwd));
  const reasons = parseReasons(runWrangler(reasonsSql(range), cwd));
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {}
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  console.log(renderMarkdown(metrics, reasons, { range, generatedAt, commit }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) run();
