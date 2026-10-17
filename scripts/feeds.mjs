import fs from 'node:fs/promises';
import path from 'node:path';

/** XML 1.0 text; source strings are always text, never markup. */
export function xmlText(value) {
  return String(value ?? '')
      .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '')
      .replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
      })[character]);
}

export function feedPath(country = '', source = '') {
  return '/feeds/' + (country ? `countries/${encodeURIComponent(country)}/` : '') +
      (source ? `sources/${encodeURIComponent(source)}.xml` : 'all.xml');
}

/** Select only a real calendar date or a timestamp with an explicit zone. */
function publicationValue(record) {
  for (const value of [record.updated_at, record.published_at]) {
    if (typeof value !== 'string') continue;
    const parts = value.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/);
    if (!parts) continue;
    const [, calendar, hour, minute, second, zone] = parts;
    const day = new Date(`${calendar}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) ||
        day.toISOString().slice(0, 10) !== calendar) continue;
    if (hour != null && (Number(hour) > 23 || Number(minute) > 59 ||
        Number(second || 0) > 59 || (zone !== 'Z' &&
        (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)))) continue;
    if (Number.isFinite(Date.parse(value))) return value;
  }
  return '';
}

function publicationDate(record) {
  // A collection check is not a publication or content update.
  const value = publicationValue(record);
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `<dc:date>${xmlText(value)}</dc:date>`;
  }
  return `<pubDate>${xmlText(new Date(value).toUTCString())}</pubDate>`;
}

/** Build static RSS from the same normalized opportunity collection as the UI. */
export async function writeFeeds({out, records, sources, countries, config}) {
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const publisherCountry = record => {
    const country = record.publisher_country;
    if (/^[A-Z]{2}$/.test(country || '')) return country;
    return sourceById.get(record.source)?.publisher_country || 'unknown';
  };
  const countryValues = [...new Set([...countries, 'unknown'])];
  const items = new Map(records.map(record => {
    const canonical = config.url + '/opportunity/' +
        record.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-').replace(/^-|-$/g, '') + '/';
    const source = sourceById.get(record.source);
    const country = publisherCountry(record);
    const date = publicationDate(record);
    const description = String(record.summary || '').slice(0, 500);
    const xml = '<item>' +
        `<title>${xmlText(record.title)}</title>` +
        `<link>${xmlText(canonical)}</link>` +
        `<guid isPermaLink="true">${xmlText(canonical)}</guid>` +
        date +
        `<source url="${xmlText(config.url + feedPath('', record.source))}">` +
        `${xmlText(source?.name || record.source)}</source>` +
        `<category domain="publisher-country">${xmlText(country)}</category>` +
        `<description>${xmlText(xmlText(description))}</description></item>`;
    return [record.id, xml];
  }));
  let count = 0;
  async function write(route, selected, title) {
    const link = config.url + route;
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        `<channel><title>${xmlText(config.title + ' — ' + title)}</title>` +
        `<link>${xmlText(config.url + '/opportunities/')}</link>` +
        '<description>Opportunity links from original publishers. ' +
        'Country means publisher country, not destination or eligibility.</description>' +
        `<atom:link href="${xmlText(link)}" rel="self" ` +
        'type="application/rss+xml"/>' +
        selected.map(record => items.get(record.id)).join('') +
        '</channel></rss>\n';
    const file = path.join(out, route.slice(1));
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, xml);
    count++;
  }
  // Newest known publication first; unknown dates have stable ID order.
  const sorted = [...records].sort((first, second) =>
    (publicationValue(second) ? Date.parse(publicationValue(second)) : -Infinity) -
    (publicationValue(first) ? Date.parse(publicationValue(first)) : -Infinity) ||
    first.id.localeCompare(second.id));
  await write(feedPath(), sorted, 'All opportunities');
  await write('/feeds/empty.xml', [], 'No matching opportunities');
  for (const country of countryValues) {
    await write(feedPath(country), sorted.filter(record =>
      publisherCountry(record) === country), `Publisher country: ${country}`);
  }
  for (const source of sources) {
    const selected = sorted.filter(record => record.source === source.id);
    await write(feedPath('', source.id), selected, source.name);
    for (const country of countryValues) {
      await write(feedPath(country, source.id), selected.filter(record =>
        publisherCountry(record) === country), `${source.name} · ${country}`);
    }
  }
  return count;
}
