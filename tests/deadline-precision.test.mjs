import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build, deadlineLabel} from '../scripts/build.mjs';
import {deadlineTime} from '../scripts/data.mjs';
import {isExpired} from '../assets/discovery.js';
import {writeSources} from './helpers.mjs';

test('visible closing time describes the same instant used for expiry', () => {
  const offset = '2026-10-16T00:30:00+14:00';
  assert.equal(deadlineLabel(offset), '2026-10-15 10:30:00 UTC');
  const instant = deadlineTime(offset);
  assert.equal(isExpired(instant, Date.parse('2026-10-15T10:29:59Z')), false);
  assert.equal(isExpired(instant, Date.parse('2026-10-15T10:30:01Z')), true);
  assert.equal(deadlineLabel('2026-10-15T23:59:00+02:00'),
      '2026-10-15 21:59:00 UTC');
  assert.equal(deadlineLabel('2026-10-15T21:59:59.999999Z'),
      '2026-10-15 21:59:59.999 UTC');
  assert.equal(deadlineLabel('2026-10-15'), '2026-10-15 (time not provided)');
  assert.equal(deadlineTime('2026-10-15'), Date.parse('2026-10-15T23:59:59.999Z'));
  assert.equal(deadlineLabel(null), 'Not provided');
});

test('listings, details and search indexes preserve deadline precision', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'youthopp-precision-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const input = path.join(dir, 'datas');
  const out = path.join(dir, 'site');
  const base = {
    source: 'fixture', summary: 'Fixture only', category: 'training',
    host_countries: ['DK'], eligible_countries: [],
    url: 'https://example.org/apply', status: 'unknown', kind: 'opportunity',
  };
  const records = [
    {...base, id: 'offset', title: 'Offset closing instant',
      deadline: '2026-10-16T00:30:00+14:00'},
    {...base, id: 'precise', title: 'Precise closing instant',
      deadline: '2026-10-15T23:59:00+02:00'},
    {...base, id: 'calendar', title: 'Calendar closing date', deadline: '2026-10-15'},
    {...base, id: 'unknown', title: 'Unspecified deadline', deadline: null},
  ];
  await writeSources(input, {opportunities: records, sources: [
    {source: 'fixture', website_url: 'https://example.org/', publisher_country: 'DK'},
  ]});
  const result = await build({input, out});
  assert.equal(result.records, records.length);
  const listing = await fs.readFile(path.join(out, 'opportunities/index.html'), 'utf8');
  const asset = listing.match(/data-index="([^"]+)"/)[1];
  const index = JSON.parse(await fs.readFile(path.join(out, asset.slice(1)), 'utf8'));
  for (const record of records) {
    const detail = await fs.readFile(path.join(out, 'opportunity', record.id, 'index.html'), 'utf8');
    const item = index.find(value => value.id === record.id);
    assert.ok(item, record.id);
    assert.equal(item.deadline, record.deadline ? deadlineTime(record.deadline) : null);
    const expected = deadlineLabel(record.deadline);
    assert.ok(item.html.includes(expected), record.id);
    assert.ok(detail.includes(expected), record.id);
    assert.ok(listing.includes(expected), record.id);
    if (record.deadline) {
      assert.ok(detail.includes(`datetime="${record.deadline}"`));
      assert.ok(detail.includes(`data-deadline="${deadlineTime(record.deadline)}"`));
    }
  }
  for (const route of ['opportunities/training', 'countries/dk',
    'opportunities/from/dk', 'sources/publisher/fixture']) {
    const html = await fs.readFile(path.join(out, route, 'index.html'), 'utf8');
    assert.ok(html.includes('2026-10-15 21:59:00 UTC'), route);
    assert.ok(html.includes('2026-10-15 (time not provided)'), route);
  }
});
