// Preview a daily index update using the public collection and previously seen identities.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function identity(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid collection identity');
  return value;
}

export function preview(index, previous, names, language = 'en') {
  if (!['en', 'tr'].includes(language)) throw new Error('Supported languages are en and tr');
  if (!Array.isArray(index) || !names || Array.isArray(names) || typeof names !== 'object') {
    throw new Error('Expected an index array and a source name map');
  }
  if (previous !== null && (previous?.version !== 1 || !Array.isArray(previous.seen))) {
    throw new Error('Invalid previous baseline');
  }
  const keys = new Set();
  const sources = new Set();
  for (const pair of previous?.seen ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid previous identity');
    pair.forEach(identity);
    keys.add(JSON.stringify(pair));
    sources.add(pair[0]);
  }
  const newSources = new Set();
  let count = 0;
  for (const record of index) {
    const source = identity(record.source);
    const key = JSON.stringify([source, identity(record.id)]);
    if (!keys.has(key)) {
      keys.add(key);
      count++;
    }
    if (!sources.has(source)) newSources.add(source);
  }
  const baseline = { version: 1, seen: [...keys].sort().map(key => JSON.parse(key)) };
  if (previous === null || !count) return { action: previous === null ? 'seed' : 'skip', baseline };
  const labels = [...newSources].sort().map(source => {
    if (!Object.hasOwn(names, source)) throw new Error('Missing source name: ' + source);
    return identity(names[source]);
  });
  const title = language === 'tr' ? `${count} yeni fırsat indekslendi.`
    : `${count} new ${count === 1 ? 'opportunity' : 'opportunities'} indexed.`;
  const sourceLine = labels.length ? [(language === 'tr' ? 'Yeni kaynaklar: ' : 'New sources: ') + labels.join(', ')] : [];
  return { action: 'preview', count, sources: labels, text: [title, ...sourceLine, 'https://youthopps.org'].join('\n'), baseline };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [indexPath, baselinePath, namesPath, language] = process.argv.slice(2);
  if (!indexPath || !baselinePath || !namesPath) throw new Error('Usage: node scripts/linkedin-preview.mjs INDEX BASELINE|--seed SOURCE_NAMES [en|tr]');
  const read = async path => JSON.parse(await readFile(path, 'utf8'));
  const prior = baselinePath === '--seed' ? null : await read(baselinePath);
  if (baselinePath !== '--seed' && prior === null) throw new Error('Explicit --seed required');
  console.log(JSON.stringify(preview(await read(indexPath), prior, await read(namesPath), language)));
}
