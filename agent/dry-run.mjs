import { readFile } from 'node:fs/promises';
import { SchoolClient } from './school.mjs';
import { beijingDate } from '../src/visitor-model.ts';
import { shiftDate } from '../src/renewal.ts';
const dataDir = process.env.DATA_DIR || '/data';
const config = JSON.parse(await readFile(`${dataDir}/config.json`, 'utf8'));
const school = new SchoolClient({ dataDir, mailbox: process.env.MAILBOX_ADDRESS, proxy: process.env.SCHOOL_PROXY,
  api: async () => { throw new Error('Dry run requires an existing login; refresh the service first'); } });
try {
  await school.start(); await school.snapshot();
  const { maxSpanDays, maxAdvanceDays } = school.metadata.limits;
  const plan = { start: beijingDate(), end: shiftDate(beijingDate(), Math.min(maxSpanDays - 1, maxAdvanceDays)) };
  const result = await school.book(plan, config, { dryRun: true });
  if (!result.validated) throw new Error('Form did not reach the submission boundary');
  console.log(JSON.stringify({ ...result, start: plan.start, end: plan.end, submission: 'aborted' }));
} catch (error) { console.error(error.message === 'booking_validation' ? 'booking_validation' : 'dry_run_failed'); process.exitCode = 1; }
finally { await school.close(); }
