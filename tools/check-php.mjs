#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP = process.env.EGOE_PHP_BIN || 'php';
const expected = [
  'api/leads/index.php',
  'api/leads/lib/LeadBackend.php',
  'api/leads/lib/EmailDelivery.php',
  'api/leads/lib/DailyAnalytics.php',
  'api/leads/cli/leads.php',
  'api/leads/cli/daily-report.php',
  'api/telegram/index.php',
  'api/telegram/lib/TelegramHistory.php',
  'api/telegram/cli/telegram.php'
];

function run(args) {
  const result = spawnSync(PHP, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${PHP} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result.stdout.trim();
}

run(['-r', `
  exit(PHP_VERSION_ID >= 80200
    && extension_loaded('pdo_sqlite')
    && extension_loaded('sqlite3')
    && extension_loaded('mbstring')
    && extension_loaded('curl') ? 0 : 1);
`]);

for (const rel of expected) {
  await fs.access(path.join(ROOT, rel));
  process.stdout.write(`${run(['-l', rel])}\n`);
}

console.log(`PHP runtime and ${expected.length} allowlisted files are valid.`);
