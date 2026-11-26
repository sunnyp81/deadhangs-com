#!/usr/bin/env node
// Owner-only: prepares one private gym campaign as a SQL file plus the organiser's one-use invite link.
// It changes nothing by itself. Review the file, then apply it with the command it prints.
// Usage: node scripts/gym-campaign.mjs --gym "Gym name" --title "December hang" --start 2026-12-01 --end 2026-12-31
//          --bar "Rig bar 3" --grip "Overhand" --chalk "Chalk allowed" [--note "..."] [--board members] [--origin https://deadhangs.com]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCampaign } from '../src/server/gym-store.mjs';

const literal = (value) => (value === null || value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`);

/** Runs the real createCampaign validation against a recording database, then renders the statements as SQL. */
export async function campaignSql(input, now = Math.floor(Date.now() / 1000)) {
  const statements = [];
  const db = { prepare(sql) { return { bind(...values) { return { async run() { statements.push({ sql, values }); return { meta: { changes: 1 } }; } }; } }; } };
  const created = await createCampaign(db, input, now);
  const sql = statements.map(({ sql: text, values }) => { let i = 0; return `${text.replace(/\?/g, () => literal(values[i++]))};`; }).join('\n');
  return { ...created, sql };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument near ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const origin = a.origin || 'https://deadhangs.com';
  const { campaignId, organiserToken, sql } = await campaignSql({
    gymName: a.gym, title: a.title, startsOn: a.start, endsOn: a.end, boardVisibility: a.board,
    rule: { bar: a.bar, grip: a.grip, chalk: a.chalk, note: a.note },
  });
  const file = resolve(`gym-campaign-${campaignId}.sql`);
  writeFileSync(file, `-- Gym campaign ${campaignId}. Contains a hashed invite only; the link below is shown once.\n${sql}\n`);
  console.log(`SQL written to ${file}`);
  console.log(`Apply (owner authorisation needed): npx wrangler@4.158.0 d1 execute deadhangs-accounts --remote --env production --file "${file}"`);
  console.log(`Organiser invite (one use, 14 days; send it to the organiser yourself, never post it): ${origin}/gym/join/?t=${organiserToken}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.code || error.message); process.exit(1); });
