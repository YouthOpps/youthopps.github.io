import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from '../scripts/build.mjs';
import {writeFeeds} from '../scripts/feeds.mjs';
import {writeSources} from './helpers.mjs';

test('RSS retains stable identities, factual dates and publisher-country intersections', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'youthopp-rss-'));
  try {
    const input = path.join(dir, 'datas');
    const out = path.join(dir, 'out');
    const record = {
      title: 'Grant & <study>', summary: '<img src=x onerror=alert(1)> & facts',
      category: 'grants', kind: 'opportunity', host_countries: ['US'],
      eligible_countries: [], status: 'unknown', url: 'https://example.org/apply',
    };
    const sources = [
      {source: 'first', publisher_country: 'DE', name: 'Publisher & Co'},
      {source: 'second', publisher_country: 'FR', name: 'Other publisher'},
    ];
    const opportunities = [
      {...record, id: 'dated', source: 'first', published_at: '2026-10-01'},
      {...record, id: 'unknown-date', source: 'second', last_checked_at: '2026-10-17T01:00:00Z'},
    ];
    await writeSources(input, {sources, opportunities});
    await build({input, out, config: {url: 'https://example.org/project'}});
    const read = route => fs.readFile(path.join(out, 'feeds', route), 'utf8');
    const global = await read('all.xml');
    assert.equal((global.match(/<item>/g) || []).length, 2);
    assert.ok(global.includes('https://example.org/project/opportunity/dated/'));
    assert.ok(global.includes('<dc:date>2026-10-01</dc:date>'));
    assert.equal((global.match(/<pubDate>/g) || []).length, 0);
    assert.ok(global.includes('&amp;lt;img src=x onerror=alert(1)&amp;gt;'));
    assert.ok(global.includes('<title>Grant &amp; &lt;study&gt;</title>'));
    assert.ok((await read('countries/DE/sources/first.xml')).includes('/opportunity/dated/'));
    assert.ok(!(await read('countries/DE/sources/second.xml')).includes('<item>'));
    assert.ok(!(await read('countries/US/all.xml').catch(() => '')).includes('<item>'));
    assert.ok(!(await read('countries/unknown/all.xml')).includes('<item>'));
    assert.ok(!(await read('empty.xml')).includes('<item>'));
    await build({input, out, config: {url: 'https://example.org/project'}});
    assert.equal(await read('all.xml'), global);
    await writeSources(input, {sources, opportunities: [
      ...opportunities, {...record, id: 'new', source: 'first'},
    ]});
    await build({input, out, config: {url: 'https://example.org/project'}});
    const updated = await read('all.xml');
    assert.equal((updated.match(/<item>/g) || []).length, 3);
    assert.equal((updated.match(/<guid isPermaLink="true">https:\/\/example.org\/project\/opportunity\/dated\//g) || []).length, 1);
    const listing = await fs.readFile(path.join(out, 'opportunities/index.html'), 'utf8');
    assert.ok(listing.includes('href="/project/feeds/all.xml"'));
    assert.ok(listing.includes('Publisher country and source only'));
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});


test('RSS rejects ambiguous and impossible update dates in both output and order', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'youthopp-rss-dates-'));
  try {
    const dates = [
      {id: 'zoneless', updated_at: '2099-10-01T12:00:00', published_at: '2026-10-01'},
      {id: 'impossible', updated_at: '2099-02-30T12:00:00Z', published_at: '2026-10-02'},
      {id: 'invalid-leap', updated_at: '2026-02-29'},
      {id: 'explicit-zone', updated_at: '2027-01-01T01:00:00+02:00'},
      {id: 'leap-date', updated_at: '2024-02-29'},
      {id: 'bad-hour', updated_at: '2026-10-01T24:00:00Z'},
      {id: 'epoch', published_at: '1970-01-01T00:00:00Z'},
    ];
    await writeFeeds({
      out, records: dates.map(date => ({
        ...date, title: date.id, summary: '', source: 'fixture',
      })), sources: [{id: 'fixture', name: 'Fixture'}], countries: [],
      config: {url: 'https://example.org', title: 'Fixture'},
    });
    const xml = await fs.readFile(path.join(out, 'feeds/all.xml'), 'utf8');
    const items = xml.match(/<item>.*?<\/item>/g);
    assert.deepEqual(items.map(item => item.match(/<title>(.*?)<\/title>/)[1]), [
      'explicit-zone', 'impossible', 'zoneless', 'leap-date', 'epoch',
      'bad-hour', 'invalid-leap',
    ]);
    assert.ok(items[0].includes('<pubDate>Thu, 31 Dec 2026 23:00:00 GMT</pubDate>'));
    assert.ok(items[1].includes('<dc:date>2026-10-02</dc:date>'));
    assert.ok(items[2].includes('<dc:date>2026-10-01</dc:date>'));
    assert.ok(items[3].includes('<dc:date>2024-02-29</dc:date>'));
    assert.ok(items[4].includes('<pubDate>Thu, 01 Jan 1970 00:00:00 GMT</pubDate>'));
    for (const item of items.slice(5)) {
      assert.ok(!item.includes('<pubDate>') && !item.includes('<dc:date>'));
    }
    assert.ok(!xml.includes('2099'));
  } finally {
    await fs.rm(out, {recursive: true, force: true});
  }
});
