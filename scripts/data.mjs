import fs from 'node:fs/promises';
import path from 'node:path';
import {compareDeadlineTimes} from '../assets/discovery.js';

const categories = ['scholarships','internships','volunteering','training','jobs','competitions','grants','fellowships','other'];
const safeUrl = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };
const secretKey = /password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key|email|phone/i;
function validDate(value) {
 if(typeof value!=='string')return false;
 const match=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/);
 if(!match)return false;
 const [,year,month,day,hour,minute,second,zone]=match;
 const calendar=new Date(`${year}-${month}-${day}T00:00:00Z`);
 if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==`${year}-${month}-${day}`)return false;
 if(hour!=null && (+hour>23||+minute>59||+(second||0)>59|| (zone!=='Z'&&(+zone.slice(1,3)>23||+zone.slice(4)>59))))return false;
 return Number.isFinite(Date.parse(value));
}
export function publicMetadata(value) {
 if (Array.isArray(value)) return value.map(publicMetadata);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).map(([key,item]) => [key,publicMetadata(item)]));
 if (typeof value !== 'string') return value;
 return value.replace(/https?:\/\/[^\s<>"']+/gi, raw => { try { const url = new URL(raw); url.username=''; url.password=''; for (const [key,item] of [...url.searchParams]) if (secretKey.test(key)||/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(item)) url.searchParams.set(key,'[redacted]'); return url.href; } catch { return '[redacted URL]'; } })
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[redacted email]')
  .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi,'[redacted credential]')
  .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\r\n&,;]+)/gi,'$1[redacted]');
}

// A date-only application deadline remains valid through the end of that UTC day.
export function deadlineTime(value) {
 if (!validDate(value)) return Infinity;
 const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
 return Number.isFinite(time) ? time : Infinity;
}
export function compareDeadlines(a, b, now = Date.now()) {
  return compareDeadlineTimes(deadlineTime(a.deadline),
      deadlineTime(b.deadline), now) || a.id.localeCompare(b.id);
}

async function readJson(file) {
 try { if((await fs.lstat(file)).isSymbolicLink())throw new Error('Source file symlinks are not supported'); return JSON.parse(await fs.readFile(file,'utf8')); }
 catch(error) { throw new Error(`Cannot read required source input ${file}: ${error.message}`,{cause:error}); }
}
function validateRecord(record, ids, file) {
 if (!record || typeof record.id!=='string' || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(record.id) || ids.has(record.id.toLowerCase())) throw new Error(`Duplicate or unsafe record ID in ${file}`);
 if (typeof record.title!=='string' || !record.title.trim() || typeof record.summary!=='string' || record.summary.length>600 || !safeUrl(record.url) || !categories.includes(record.category) || !['open','expired','unknown'].includes(record.status) || !Array.isArray(record.host_countries) || !Array.isArray(record.eligible_countries) || [...record.host_countries,...record.eligible_countries].some(code=>typeof code!=='string'||! /^[A-Z]{2}$/.test(code))) throw new Error(`Malformed opportunity contract in ${file} (${record.id})`);
 if (Object.hasOwn(record, 'summary_language') && (typeof record.summary_language !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(record.summary_language))) throw new Error(`Invalid opportunity summary language in ${file} (${record.id})`);
 for(const key of ['deadline','published_at','last_checked_at']) if(record[key]!=null && !validDate(record[key])) throw new Error(`Invalid opportunity date ${key} in ${file}; use a calendar date or an ISO timestamp with timezone`);
 ids.add(record.id.toLowerCase());
}
export async function loadData(datasPath) {
 let entries;
 try { if((await fs.lstat(datasPath)).isSymbolicLink())throw new Error('The datas directory must not be a symlink'); entries=await fs.readdir(datasPath,{withFileTypes:true}); }
 catch(error) { throw new Error(`Required datas directory is unavailable: ${datasPath}. Initialize the data-source snapshot or set DATA_PATH.`,{cause:error}); }
 const opportunities=[], sources=[], ids=new Set();
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
  if(entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${entry.name}`);
  if(!entry.isDirectory()) continue;
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) throw new Error(`Unsafe source folder: ${entry.name}`);
  const folder=path.join(datasPath,entry.name), file=path.join(folder,'data.json');
  const [records,metadata]=await Promise.all([readJson(file),readJson(path.join(folder,'metadata.json'))]);
  if(!Array.isArray(records)) throw new Error(`Expected an opportunity array in ${file}`);
  if(!metadata || Array.isArray(metadata) || typeof metadata!=='object' || !['success','fail'].includes(metadata.status)) throw new Error(`Invalid source metadata/status in ${folder}/metadata.json`);
  for(const key of ['last_attempt_at','last_success_at','last_checked_at'])if(metadata[key]!=null&&!validDate(metadata[key]))throw new Error(`Invalid source metadata date ${key} in ${folder}/metadata.json`);
  const clean=publicMetadata(metadata);
  const website=[clean.website_url,clean.official_website,clean.official_site,clean.url,clean.source_url].find(safeUrl)||null;
  const displayName = typeof clean.display_name === 'string' ?
    clean.display_name.trim() : '';
  const name = displayName || (website ? new URL(website).hostname.replace(/^www\./i, '') :
    [clean.name, clean.title, clean.page_title, entry.name]
        .find(value => typeof value === 'string' && value.trim()));
  const country=[clean.publisher_country,clean.country].find(value=>typeof value==='string'&&/^[A-Z]{2}$/.test(value))||null;
  sources.push({...clean,id:entry.name,source:entry.name,name,description:typeof clean.description==='string'?clean.description:null,website_url:website,publisher_country:country});
  for(const record of records) {
   validateRecord(record,ids,file);
   opportunities.push({...record,source:entry.name,publisher_country:record.publisher_country??country});
  }
 }
 const now = Date.now();
 return {
   opportunities: opportunities.sort((a, b) => compareDeadlines(a, b, now)),
   sources,
   generated_at: new Date(now).toISOString(),
 };
}
