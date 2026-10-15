import {compactJsonOutput} from './json-output.mjs';
import {markdown} from './docs.mjs';
export {markdown} from './docs.mjs';
import {writeSitemaps} from './sitemaps.mjs';
import {loadData, compareDeadlines, deadlineTime} from './data.mjs';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'#';}catch{return '#';}};
export const slug=value=>String(value??'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
export function paginate(records,size){return Array.from({length:Math.max(1,Math.ceil(records.length/size))},(_,i)=>records.slice(i*size,(i+1)*size));}
export function sourceCollectionState(source){
 if(source.status==='success')return {label:'Success',tone:'active',note:'The latest data collection succeeded. Application availability is separate.'};
 if(source.status==='fail')return {label:'Fail',tone:'issue',note:'The latest collection failed. Last successful records remain available.'};
 return {label:'Unknown',tone:'neutral',note:'Collection status is not provided.'};
}
export function collectionTime(value){
 if(!value||!Number.isFinite(Date.parse(value)))return null;
 return new Date(value).toISOString().slice(0,16).replace('T',' ')+' UTC';
}
/** Formats deadlines at the consumer's existing precision. */
export function deadlineLabel(value) {
  const time = deadlineTime(value);
  if (!Number.isFinite(time)) {
    return 'Not provided';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value} (time not provided)`;
  }
  const instant = new Date(time).toISOString();
  const clock = instant.slice(11, -1).replace(/\.000$/, '');
  return `${instant.slice(0, 10)} ${clock} UTC`;
}
async function physicalPath(value){
 const resolved=path.resolve(value);
 try{return await fs.realpath(resolved);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const parent=path.dirname(resolved);
  if(parent===resolved)throw error;
  return path.join(await physicalPath(parent),path.basename(resolved));
 }
}
async function checkOutput(out,input){
 const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
 const output=normalize(await physicalPath(out));
 const isWithin=(candidate,parent)=>candidate===parent||candidate.startsWith(parent+path.sep);
 const sourceRoots=[input,path.join(root,'data-source'),path.join(root,'../data-source')];
 if(path.basename(path.resolve(input))==='datas'){const parent=path.dirname(path.resolve(input));try{await fs.access(path.join(parent,'.git'));sourceRoots.push(parent);}catch{}}
 const project=normalize(await physicalPath(root));
 if(isWithin(project,output))throw new Error('Unsafe build output directory');
 for(const source of sourceRoots){
  const protectedPath=normalize(await physicalPath(source));
  if(isWithin(output,protectedPath)||isWithin(protectedPath,output))throw new Error('Build output must not overlap a data-source checkout');
 }
}
export async function build(options={}){
const discoveryScript = await fs.readFile(path.join(root, 'assets/discovery.js'));
const discoveryName = `discovery.${createHash('sha256').update(discoveryScript).digest('hex').slice(0,16)}.js`;
const indexScript = (await fs.readFile(path.join(root, 'assets/index.js'), 'utf8'))
    .replace("'./discovery.js'", `'./${discoveryName}'`);
const stylesheet=await fs.readFile(path.join(root,'assets/style.css'));
const stylesheetName=`style.${createHash('sha256').update(stylesheet).digest('hex').slice(0,16)}.css`;
const indexScriptName=`index.${createHash('sha256').update(indexScript).digest('hex').slice(0,16)}.js`;
const config={...JSON.parse(await fs.readFile(path.join(root,'site.config.json'),'utf8')),...(process.env.SITE_URL?{url:process.env.SITE_URL}:{}),...options.config};
config.url=config.url.replace(/\/$/,'');const basePath=new URL(config.url).pathname.replace(/\/$/,'');
const catalog=await loadData(options.input||process.env.DATA_PATH||path.join(root,'data-source/datas'));
if(!Number.isInteger(config.pageSize)||config.pageSize<1)throw new Error('Invalid page size');
const now = Date.now();
const records=[...catalog.opportunities].sort((a, b) => compareDeadlines(a, b, now));
const browseRecords=records.filter(r=>r.kind!=='unknown');
const sources=catalog.sources;const directory=sources;
const out=options.out||path.join(root,'dist');
await checkOutput(out,options.input||process.env.DATA_PATH||path.join(root,'data-source/datas'));
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(path.join(out,'assets'),{recursive:true});
const routes=[];const e=escapeHtml;const fallbackCategories=['scholarships','internships','volunteering','training','jobs','competitions','grants','fellowships','other'];
const taxonomy=Array.isArray(catalog.taxonomy?.categories)?catalog.taxonomy.categories.filter(c=>fallbackCategories.includes(c.id)&&typeof c.label==='string'):[];
const categories=[...new Set([...taxonomy.map(c=>c.id),...fallbackCategories])];
const recordCategories=r=>Array.isArray(r.categories)&&r.categories.length?r.categories.filter(c=>categories.includes(c)):[r.category];
const label=s=>taxonomy.find(c=>c.id===s)?.label||s.charAt(0).toUpperCase()+s.slice(1);const date=s=>s?e(String(s).slice(0,10)):'Not provided';
const countryName=code=>{try{return new Intl.DisplayNames(['en'],{type:'region'}).of(code)||code;}catch{return code;}};
const publisherCountry=s=>/^[A-Z]{2}$/.test(s?.publisher_country||s?.country||'')?(s.publisher_country||s.country):null;
const publisherCountries=[...new Set([...directory.map(publisherCountry),...records.map(r=>r.publisher_country)].filter(c=>/^[A-Z]{2}$/.test(c||'')))].sort((a,b)=>countryName(a).localeCompare(countryName(b)));
const directoryCountryLinks=publisherCountries.map(c=>`<a href="/sources/countries/${slug(c)}/">${e(countryName(c))}</a>`).join('');
const publisherCountryLinks=publisherCountries.map(c=>`<a href="/opportunities/from/${slug(c)}/">${e(countryName(c))}</a>`).join('');
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const navigation=config.navigation;
const socialAlt=`${config.title} — ${config.tagline}`;
const header=(route)=>`<header class="site-header"><div class="wrap header-inner"><a class="brand" href="/"><img src="${e(config.logoPath)}" width="34" height="34" alt=""><span>${e(config.title)}</span></a><span class="brand-caption">${e(config.brandCaption)}</span><nav aria-label="Main navigation">${navigation.map(([url,text])=>`<a href="${e(url)}" ${route.startsWith(url)&&!navigation.some(([other])=>other.length>url.length&&route.startsWith(other))?'aria-current="page"':''}>${e(text)}</a>`).join('')}</nav><a class="github-link" href="${e(config.organizationUrl)}">Contribute</a></div></header>`;
async function page(route,title,description,body,structured={}){
const canonical=config.url+route;
const organizationId=config.url+'/#organization';const websiteId=config.url+'/#website';
const crumbs=[{name:'Home',route:'/'}];
if(route!=='/'){
 if(route.startsWith('/sources/')&&route!=='/sources/')crumbs.push({name:'Sources',route:'/sources/'});
 else if(route.startsWith('/docs/')&&route!=='/docs/')crumbs.push({name:'Docs',route:'/docs/'});
 else if(route.startsWith('/opportunity/')||route.startsWith('/countries/')||(route.startsWith('/opportunities/')&&route!=='/opportunities/'))crumbs.push({name:'Opportunities',route:'/opportunities/'});
 const category=categories.find(c=>route.startsWith(`/opportunities/${c}/`));
 if(category&&route!==`/opportunities/${category}/`)crumbs.push({name:label(category),route:`/opportunities/${category}/`});
 const pageNumber=route.match(/^(.*\/)page\/(\d+)\/$/);
 if(pageNumber&&!crumbs.some(c=>c.route===pageNumber[1]))crumbs.push({name:title,route:pageNumber[1]});
 crumbs.push({name:pageNumber?`Page ${pageNumber[2]}`:title,route});
}
const breadcrumb={'@type':'BreadcrumbList','@id':canonical+'#breadcrumbs',itemListElement:crumbs.map((c,index)=>({'@type':'ListItem',position:index+1,name:c.name,item:config.url+c.route}))};
const graph={'@context':'https://schema.org','@graph':[
 {'@type':'Organization','@id':organizationId,name:config.title,url:config.url+'/',description:config.organizationDescription,logo:config.url+config.logoPath,sameAs:[config.organizationUrl]},
 {'@type':'WebSite','@id':websiteId,name:config.title,url:config.url+'/',publisher:{'@id':organizationId},inLanguage:'en'},
 {'@type':route.includes('/opportunities/')||route.startsWith('/countries/')||route.startsWith('/sources/')?'CollectionPage':'WebPage','@id':canonical+'#webpage',name:title,url:canonical,description,isPartOf:{'@id':websiteId},publisher:{'@id':organizationId},...(route!=='/'?{breadcrumb:{'@id':breadcrumb['@id']}}:{}),...structured},
 ...(route!=='/'?[breadcrumb]:[])
]};
let html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(config.title)}</title><meta name="description" content="${e(description)}"><link rel="canonical" href="${e(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="${e(config.title)}"><meta property="og:title" content="${e(title)} · ${e(config.title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(canonical)}"><meta property="og:image" content="${e(config.url+config.socialImagePath)}"><meta property="og:image:alt" content="${e(socialAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)} · ${e(config.title)}"><meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(config.url+config.socialImagePath)}"><meta name="twitter:image:alt" content="${e(socialAlt)}"><link rel="icon" href="${e(config.logoPath)}" type="${config.logoPath.endsWith('.svg')?'image/svg+xml':'image/png'}"><link rel="stylesheet" href="/assets/${stylesheetName}">${config.googleVerification?`<meta name="google-site-verification" content="${e(config.googleVerification)}">`:''}${config.bingVerification?`<meta name="msvalidate.01" content="${e(config.bingVerification)}">`:''}<script type="application/ld+json">${json(graph)}</script></head><body><a class="skip" href="#main">Skip to content</a>${header(route)}<main id="main">${body}</main><footer><div class="wrap footer-grid"><div><a class="brand" href="/"><img src="${e(config.logoPath)}" width="30" height="30" alt=""><span>${e(config.title)}</span></a><p>${e(config.tagline)}</p><p class="small">${e(config.mission)}</p></div><div>${config.footerLinks.map(([url,text])=>`<a href="${e(url)}">${e(text)}</a>`).join('')}<a href="${e(config.organizationUrl)}">GitHub ↗</a></div></div><div class="wrap small footer-note">Independent index of factual links. No publisher endorsement; verify details with the publisher. <a href="/docs/trust/#source-removal">Request source removal</a>.</div></footer>${/^G-[A-Z0-9]+$/.test(config.googleAnalyticsId||'')?`<script src="/assets/analytics.js" data-id="${e(config.googleAnalyticsId)}" data-base="${e(basePath)}" data-site-name="${e(config.title)}" data-categories="${e(categories.join(' '))}" data-countries="${e([...new Set([...records.flatMap(r=>r.host_countries.map(c=>c.toLowerCase())),...publisherCountries.map(c=>c.toLowerCase())]),'unknown'].join(' '))}" defer></script>`:''}<script type="module" src="/assets/${indexScriptName}"></script></body></html>`;
html=html.replace(/(href|src|action)="\/(?!\/)/g,`$1="${e(basePath)}/`);
const dest=path.join(out,route,'index.html');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,html);routes.push(route);
}
const recordSource=r=>sources.find(s=>(s.id||s.source)===r.source);
const recordPublisherCountry=r=>/^[A-Z]{2}$/.test(r.publisher_country||'')?r.publisher_country:publisherCountry(recordSource(r));
const sourceName=r=>recordSource(r)?.name||r.source||'Original source';
const sourceInstitution = record => {
  const attribution = recordSource(record)?.attribution;
  if (typeof attribution !== 'string' || !attribution.trim()) {
    return '';
  }
  const credit = attribution.trim().replace(/^Source:\s*/i, '');
  for (const name of [sourceName(record), `www.${sourceName(record)}`]) {
    if (credit.startsWith(`${name} / `)) {
      return credit.slice(name.length + 3).trim();
    }
    if (credit === name) {
      return '';
    }
  }
  return credit;
};
const sourceCell = record => {
  const institution = sourceInstitution(record) || 'Institution not provided';
  const website = safeUrl(recordSource(record)?.website_url);
  const websiteLine = website === '#' ?
    '<span class="row-source-website">Website not provided</span>' :
    `<a class="row-source-website" href="${e(website)}" rel="noopener noreferrer">${e(sourceName(record))}</a>`;
  return `<a class="row-source" href="/sources/publisher/${slug(record.source)}/">${e(institution)}</a>` +
    websiteLine;
};
const sourceAttribution=s=>typeof s?.attribution==='string'&&s.attribution.trim()?`<p class="small source-attribution">Source attribution: ${e(s.attribution)}</p>`:'';
const kindDefinitions={
 'unknown':{label:'Indexed source page',note:'Source information only. Youth eligibility and current applications have not been verified.',action:'Visit the original source ↗'},
 'programme-overview':{label:'Programme overview',note:'Programme information. Confirm current application calls and dates with the publisher.',action:'View programme information ↗'},
 'institutional-grant':{label:'Institutional grant',note:'Funding for institutions or organisations. Confirm eligible applicants and current calls with the publisher.',action:'View institutional grant details ↗'}
};
const recordKinds=r=>{
 const kinds=['opportunity','programme-overview','institutional-grant','unknown'].includes(r.kind)?[r.kind]:(Array.isArray(r.tags)?r.tags:[]);
 return kinds.filter(kind=>Object.hasOwn(kindDefinitions,kind)).map(kind=>kindDefinitions[kind]);
};
const kindNotice=r=>recordKinds(r).map(kind=>`<p class="small"><span class="tag">${e(kind.label)}</span> ${e(kind.note)}</p>`).join('');
const detailAction=r=>recordKinds(r)[0]?.action||'Read the original & apply ↗';
const detailDescription=r=>r.summary.trim()||recordKinds(r)[0]?.note||'Original-source opportunity information. Confirm dates, eligibility and application details with the publisher.';
const deadline=r=>`${r.deadline?`<time datetime="${e(r.deadline)}">${e(deadlineLabel(r.deadline))}</time>`:'<span>Not provided</span>'}<span class="expiry-label" hidden>Expired</span>`;
const expiry=r=>Number.isFinite(deadlineTime(r.deadline))?` data-deadline="${deadlineTime(r.deadline)}"`:'';
const row=r=>`<tr class="opportunity"${expiry(r)}><td><a class="row-title" lang="${e(r.language||'und')}" href="/opportunity/${slug(r.id)}/">${e(r.title)}</a><span class="row-category">${e(label(r.category))}${recordKinds(r).map(kind=>` · <span class="tag">${e(kind.label)}</span><span class="sr-only"> ${e(kind.note)}</span>`).join('')}</span></td><td data-label="Source">${sourceCell(r)}</td><td data-label="Destination">${r.host_countries.length?e(r.host_countries.map(countryName).join(', ')):'Not provided'}</td><td data-label="Deadline">${deadline(r)}</td></tr>`;
const rows=items=>`<div class="index-table"><table><caption class="sr-only">Opportunities with sources, destinations and deadlines</caption><thead><tr><th scope="col">Opportunity</th><th scope="col">Source</th><th scope="col">Destination</th><th scope="col">Deadline</th></tr></thead><tbody class="collection-results">${items.map(row).join('')}</tbody></table></div>`;
const option=(value,text)=>`<option value="${e(value)}">${e(text)}</option>`;
function controls(items,isSources=false){
 const countries=[...new Set(items.map(r=>isSources?publisherCountry(r):recordPublisherCountry(r)).filter(Boolean))].sort();
 const select=(name,title,values)=>`<label>${title}<select name="${name}">${option('','All')}${values}</select></label>`;
 const countryOptions=countries.map(c=>option(c,countryName(c))).join('')+option('unknown','Not provided');
 return `<form class="index-search" role="search"><label class="search-field">Search ${isSources?'sources':'opportunities'}<input name="q" type="search" placeholder="Search this collection…" autocomplete="off"></label>${select('country','Publisher country',countryOptions)}${isSources?select('status','Collection status',option('success','Success')+option('fail','Fail')):select('destination','Destination',[...new Set(items.flatMap(r=>r.host_countries))].sort().map(c=>option(c,countryName(c))).join('')+option('unknown','Not provided'))}<button class="button" type="submit">Search</button>${isSources?'':`<details class="more-filters"><summary>More filters</summary><div>${select('category','Category',categories.map(c=>option(c,label(c))).join(''))}${select('source','Source',sources.filter(s=>items.some(r=>r.source===s.id)).map(s=>option(s.id,s.name)).join(''))}${select('eligible','Applicant country',[...new Set(items.flatMap(r=>r.eligible_countries))].sort().map(c=>option(c,countryName(c))).join('')+option('unknown','Not provided'))}</div></details>`}<button type="reset" class="reset-filters">Clear filters</button></form><p class="search-note">Search covers this entire collection. Country of the publisher, destination and applicant eligibility are separate.</p><noscript><p class="notice">Enable JavaScript to search and filter. All listings and numbered pages remain available below.</p></noscript>`;
}
const indexedRecord = record => {
  const time = deadlineTime(record.deadline);
  return {
    id: record.id,
    deadline: Number.isFinite(time) ? time : null,
    html: row(record),
    search: [record.title, record.summary, sourceName(record),
      recordSource(record)?.attribution, record.source,
      record.category, ...record.host_countries.map(countryName)].join(' '),
    category: recordCategories(record),
    source: record.source,
    country: recordPublisherCountry(record) || 'unknown',
    destination: record.host_countries.length ? record.host_countries : ['unknown'],
    eligible: record.eligible_countries.length ? record.eligible_countries : ['unknown'],
  };
};
async function indexFile(items){
 const content=JSON.stringify(items.map(item=>({...item,html:item.html.replace(/(href|src|action)="\/(?!\/)/g,`$1="${e(basePath)}/`)})));
 const name=`collection.${createHash('sha256').update(content).digest('hex').slice(0,16)}.json`;
 await fs.writeFile(path.join(out,'assets',name),content);
 return `${basePath}/assets/${name}`;
}
const collectionAttrs=(base,index,current=0)=>`class="collection" data-base="${e(basePath+base)}" data-index="${e(index)}" data-page="${current+1}" data-page-size="${config.pageSize}"`;
function pagination(total,current,base){const link=(index,label=index+1)=>`<a ${index===current?'aria-current="page"':''} href="${index===0?base:`${base}page/${index+1}/`}">${label}</a>`;const visible=new Set([0,total-1]);for(let n=Math.max(0,current-2);n<=Math.min(total-1,current+2);n++)visible.add(n);let previous=-1;const parts=[];if(current>0)parts.push(link(current-1,'← Previous'));for(const n of [...visible].sort((a,b)=>a-b)){if(n-previous>1)parts.push('<span class="pagination-ellipsis" aria-hidden="true">…</span>');parts.push(link(n));previous=n;}if(current<total-1)parts.push(link(current+1,'Next →'));return parts.join('');}
const resultsStatus=(length,current,total)=>`<div class="result-bar"><strong class="result-count">${length} results</strong><span class="page-count">Page ${current+1} of ${total}</span></div><p class="filter-status small" role="status" aria-live="polite"></p><p class="no-results" ${length?'hidden':''}>No matching results. Try another search or clear the filters.</p>`;
const latest=browseRecords.slice(0,12);
const previewIndex = await indexFile(browseRecords.map(indexedRecord));
await page('/','Find your next opportunity',config.description,`<section class="wrap home-intro"><h1>Find your next opportunity.</h1><p>Scholarships, internships and programmes. Independent sources, one shared index.</p><form class="home-search" action="/opportunities/" method="get" role="search"><label class="sr-only" for="home-query">Search all opportunities</label><input id="home-query" name="q" type="search" placeholder="Search all opportunities…"><button class="button">Search</button></form><nav class="category-tabs" aria-label="Opportunity categories"><a href="/opportunities/">All</a>${categories.filter(c=>c!=='other').map(c=>`<a href="/opportunities/${c}/">${label(c)}</a>`).join('')}</nav></section><section class="wrap home-directory"><div class="directory-main"><div class="section-heading"><h2>Opportunity index</h2><span class="small">Deadline order · ${browseRecords.length} listings</span></div>${rows(latest).replace('class="collection-results"', `class="collection-results" data-preview-index="${e(previewIndex)}"`)}${latest.length?'':'<p>No published opportunities yet.</p>'}<a class="index-more" href="/opportunities/">Explore all opportunities →</a></div><aside class="directory-aside"><h2>Opportunities by country</h2><nav class="publisher-countries" aria-label="Publisher countries">${publisherCountryLinks}</nav><h2>Source directory</h2><p>Original publishers and collection updates.</p><div class="publisher-list">${sources.slice(0,4).map(s=>`<div><a href="/sources/publisher/${slug(s.id)}/">${e(s.name)}</a><p>${e(publisherCountry(s)?countryName(publisherCountry(s)):'International / unspecified')} · ${e(sourceCollectionState(s).label)}</p></div>`).join('')}</div><a href="/sources/">Explore all sources →</a><div class="community-panel"><p class="eyebrow">COMMUNITY</p><h2>Built together.</h2><p>Discover a source. Improve the index. Share your skills.</p><a class="button outline" href="/docs/contributing/">Get involved</a></div></aside></section>`);
async function listing(base,title,items,intro=''){
 const selectedCategory=categories.find(c=>base.startsWith(`/opportunities/${c}/`));const countryBase=selectedCategory?`/opportunities/${selectedCategory}/`:'/countries/';
 const chunks=paginate(items,config.pageSize);const index=await indexFile(items.map(indexedRecord));
 for(let i=0;i<chunks.length;i++){
  const route=i===0?base:`${base}page/${i+1}/`;
  await page(route,title,`Explore ${title.toLowerCase()} with original publisher links.`,`<section class="wrap section"><p class="eyebrow">EXPLORE THE INDEX</p><h1 class="page-title">${e(title)}</h1>${intro}${base.includes('/from/')?'<p class="notice">Publisher country describes the source. Destinations and applicant eligibility may differ.</p>':''}<div class="catalog-layout"><aside class="filters" aria-label="Browse opportunities"><details class="filter-section" open><summary>Categories</summary><div class="filter-links"><a href="/opportunities/">All opportunities</a>${categories.map(c=>`<a href="/opportunities/${c}/">${label(c)}</a>`).join('')}</div></details><details class="filter-section"><summary>Publisher country</summary><div class="filter-links">${publisherCountries.map(c=>`<a href="${selectedCategory?`/opportunities/${selectedCategory}/from/`:'/opportunities/from/'}${slug(c)}/">${e(countryName(c))}</a>`).join('')}</div></details><details class="filter-section"><summary>Destination</summary><div class="filter-links">${[...new Set(items.flatMap(r=>r.host_countries))].sort().map(c=>`<a href="${countryBase}${slug(c)}/">${e(countryName(c))}</a>`).join('')}<a href="${countryBase}unknown/">Location not provided</a></div></details></aside><div ${collectionAttrs(base,index,i)}>${controls(items)}${resultsStatus(items.length,i,chunks.length)}${rows(chunks[i])}<nav class="pagination" aria-label="Catalog pages">${pagination(chunks.length,i,base)}</nav></div></div></section>`);
 }
}
await listing('/opportunities/','All opportunities',browseRecords);for(const c of categories)await listing(`/opportunities/${c}/`,label(c),browseRecords.filter(r=>recordCategories(r).includes(c)));for(const c of [...new Set(browseRecords.flatMap(r=>r.host_countries||[]))])await listing(`/countries/${slug(c)}/`,countryName(c),browseRecords.filter(r=>(r.host_countries||[]).includes(c)));await listing('/countries/unknown/','Location not provided',browseRecords.filter(r=>!(r.host_countries||[]).length));
for(const c of categories){const categoryRecords=browseRecords.filter(r=>recordCategories(r).includes(c));for(const country of [...new Set(categoryRecords.flatMap(r=>r.host_countries||[]))])await listing(`/opportunities/${c}/${slug(country)}/`,`${label(c)} in ${countryName(country)}`,categoryRecords.filter(r=>r.host_countries.includes(country)));await listing(`/opportunities/${c}/unknown/`,`${label(c)} — location not provided`,categoryRecords.filter(r=>!r.host_countries.length));}

await page('/opportunities/countries/','Opportunities by country','Browse collected opportunities and programmes by publisher country.',`<section class="wrap section"><h1 class="page-title">Opportunities by country</h1><p class="lede">Browse by destination or publisher country.</p><h2>Opportunity destinations</h2><div class="source-grid">${[...new Set(browseRecords.flatMap(r=>r.host_countries))].sort().map(c=>`<a class="source-card doc-card" href="/countries/${slug(c)}/"><h2>${e(countryName(c))}</h2><span>${browseRecords.filter(r=>r.host_countries.includes(c)).length} collected listings →</span></a>`).join('')}<a class="source-card doc-card" href="/countries/unknown/"><h2>Destination not provided</h2><span>${browseRecords.filter(r=>!r.host_countries.length).length} collected listings →</span></a></div><h2>Publisher countries</h2><div class="source-grid">${publisherCountries.map(c=>`<a class="source-card doc-card" href="/opportunities/from/${slug(c)}/"><h2>${e(countryName(c))}</h2><span>${browseRecords.filter(r=>recordPublisherCountry(r)===c).length} collected listings →</span></a>`).join('')}<a class="source-card doc-card" href="/opportunities/from/unknown/"><h2>International / unspecified</h2><span>${browseRecords.filter(r=>!recordPublisherCountry(r)).length} collected listings →</span></a></div><p><a href="/collection/">View collection coverage and source errors →</a></p></section>`);
for(const country of [...publisherCountries,'unknown']){
 const countryRecords=browseRecords.filter(r=>country==='unknown'?!recordPublisherCountry(r):recordPublisherCountry(r)===country);
 await listing(`/opportunities/from/${slug(country)}/`,country==='unknown'?'International / unspecified listings':`Listings from ${countryName(country)} publishers`,countryRecords);
 for(const category of categories)await listing(`/opportunities/${category}/from/${slug(country)}/`,`${label(category)} — ${country==='unknown'?'international publishers':countryName(country)+' publishers'}`,countryRecords.filter(r=>recordCategories(r).includes(category)));
}
await page('/collection/','Collection coverage','Measured source collection and extracted records.',`<section class="wrap section"><h1 class="page-title">Collection coverage</h1><p class="lede">${sources.filter(s=>s.status==='success').length} of ${catalog.sources.length} source collections succeeded. A reachable publisher page does not mean opportunity listings were extracted.</p><p>Website built: ${date(catalog.generated_at)} · <a href="/sources/">Source directory</a></p><div class="table-scroll"><table><thead><tr><th>Source</th><th>Collection</th><th>Opportunity / programme records</th><th>Unclassified records</th><th>Latest error</th></tr></thead><tbody>${sources.map(source=>{const items=records.filter(r=>r.source===(source.source||source.id));return `<tr><td>${e(source.name)}</td><td>${e(source.status||'unknown')}</td><td>${items.filter(r=>r.kind&&r.kind!=='unknown').length}</td><td>${items.filter(r=>!r.kind||r.kind==='unknown').length}</td><td>${e(source.error||'')}</td></tr>`;}).join('')}</tbody></table></div></section>`);

for(const r of records)await page(`/opportunity/${slug(r.id)}/`,r.title,detailDescription(r),`<section class="wrap section narrow"${expiry(r)}><a class="text-link" href="/opportunities/">← Back to opportunities</a><p class="eyebrow">${e(label(r.category||'other'))}</p><h1 class="page-title" lang="${e(r.language||'und')}">${e(r.title)}</h1><p class="lede" lang="${e(r.summary_language||r.language||'und')}">${e(r.summary)}</p>${kindNotice(r)}<dl class="detail-grid"><dt>Destination</dt><dd>${(r.host_countries||[]).length?e(r.host_countries.map(countryName).join(', ')):'Not provided'}</dd><dt>Who may apply</dt><dd>${(r.eligible_countries||[]).length?e(r.eligible_countries.map(countryName).join(', ')):'Not provided — check the source'}</dd><dt>Deadline</dt><dd>${deadline(r)}</dd><dt>Published</dt><dd>${date(r.published_at)}</dd><dt>Last checked</dt><dd>${date(r.last_checked_at)}</dd><dt>Publisher</dt><dd>${e(sourceName(r))}</dd></dl>${sourceAttribution(recordSource(r))}<a class="button" href="${e(safeUrl(r.url))}">${e(detailAction(r))}</a><p class="notice">This is a discovery record. A recent collection does not guarantee that applications remain open. Confirm all information with the publisher.</p></section>`);
const metadataValue=value=>{
 if(value==null||value==='')return 'Not provided';
 if(typeof value==='object')return `<pre>${e(JSON.stringify(value,null,2))}</pre>`;
 if(typeof value==='string'&&/^https?:\/\//.test(value)&&safeUrl(value)!=='#')return `<a href="${e(safeUrl(value))}">${e(value)}</a>`;
 return e(value);
};
const sourceCard=s=>{
 const state=sourceCollectionState(s);const last=collectionTime(s.last_success_at);const website=safeUrl(s.website_url);
 const extra=Object.entries(s).filter(([key])=>!['id','source','name','description','website_url','publisher_country'].includes(key));
 return `<article class="source-card publisher-card"><div class="source-card-top"><span class="small">${e(publisherCountry(s)?countryName(publisherCountry(s)):'International / unspecified')}</span><span class="source-status ${state.tone}">${e(state.label)}</span></div><h2>${e(s.name)}</h2><p class="source-description">${e(s.description||'Description not provided by the source.')}</p>${sourceAttribution(s)}<div class="source-collection"><p><span>Last data received</span><strong>${last?`<time datetime="${e(s.last_success_at)}">${e(last)}</time>`:'No successful collection yet'}</strong></p><p class="small">${e(state.note)}</p></div><div class="source-actions"><a href="/sources/publisher/${slug(s.id)}/">Browse opportunities →</a>${website!=='#'?`<a class="source-website" href="${e(website)}" rel="noopener noreferrer">Official website ↗</a>`:'<span>Official website not provided</span>'}</div><details class="source-metadata"><summary>Source details and collection history</summary><dl><dt>Source identifier</dt><dd>${e(s.id)}</dd>${extra.map(([key,value])=>`<dt>${e(key.replaceAll('_',' '))}</dt><dd>${metadataValue(value)}</dd>`).join('')}</dl></details></article>`;
};
async function sourceListing(base,title,items){
 const index=await indexFile(items.map(s=>({html:sourceCard(s),search:JSON.stringify(s),country:publisherCountry(s)||'unknown',status:s.status})));
 const chunks=paginate(items,config.pageSize);
 for(let i=0;i<chunks.length;i++)await page(i===0?base:`${base}page/${i+1}/`,title,'Explore original publishers by their country.',`<section class="wrap section"><p class="eyebrow">FOLLOW THE ORIGINAL</p><h1 class="page-title">${e(title)}</h1><p class="lede">Original publishers, their public information and collection results. A successful collection does not mean applications are open.</p><nav class="publisher-countries" aria-label="Publisher countries"><a href="/sources/">All sources</a>${directoryCountryLinks}<a href="/sources/countries/international/">International / unspecified</a></nav><div ${collectionAttrs(base,index,i)}>${controls(items,true)}${resultsStatus(items.length,i,chunks.length)}<div class="source-grid collection-results">${chunks[i].map(sourceCard).join('')}</div><nav class="pagination" aria-label="Source pages">${pagination(chunks.length,i,base)}</nav></div><p>Publishers can <a href="/docs/trust/#source-removal">request removal or correction</a>.</p></section>`);
}
await sourceListing('/sources/','A world of sources.',directory);
await page('/sources/countries/','Sources by country','Find opportunity publishers by country.',`<section class="wrap section"><h1 class="page-title">Sources by country</h1><p class="lede">Country describes the publisher, not the destination or eligibility of every opportunity.</p><div class="source-grid">${publisherCountries.map(c=>`<a class="source-card doc-card" href="/sources/countries/${slug(c)}/"><h2>${e(countryName(c))}</h2><span>${directory.filter(s=>publisherCountry(s)===c).length} sources →</span></a>`).join('')}<a class="source-card doc-card" href="/sources/countries/international/"><h2>International / unspecified</h2><span>${directory.filter(s=>!publisherCountry(s)).length} sources →</span></a></div></section>`);
for(const country of publisherCountries)await sourceListing(`/sources/countries/${slug(country)}/`,`${countryName(country)} — sources`,directory.filter(s=>publisherCountry(s)===country));
await sourceListing('/sources/countries/international/','International / unspecified sources',directory.filter(s=>!publisherCountry(s)));
for(const source of sources)await listing(`/sources/publisher/${slug(source.id)}/`,`${source.name} — opportunities`,browseRecords.filter(r=>r.source===source.id),sourceCard(source));
await page('/contact/','Contact','How to contact and collaborate with YouthOpp.',`<section class="wrap section narrow"><p class="eyebrow">CONTACT & SUPPORT</p><h1 class="page-title">Start in public when you can.</h1><p class="lede">GitHub is our primary communication channel so questions, decisions and improvements stay visible and reusable.</p><div class="prose"><h2>youthopps.org</h2><p>For the site, search, design and documentation: <a href="https://github.com/YouthOpps/youthopps.github.io/discussions">Discussions — questions and ideas</a> · <a href="https://github.com/YouthOpps/youthopps.github.io/issues/new">Report a site bug</a>.</p><h2>data-pipeline</h2><p>For source integrations and data collection: <a href="https://github.com/YouthOpps/data-pipeline/discussions">Discussions — questions and ideas</a> · <a href="https://github.com/YouthOpps/data-pipeline/issues/new">Report a collection bug or data correction</a>.</p><h2>Email</h2><p>When GitHub is not suitable, especially for private or sensitive communication, email <a href="mailto:contact@youthopps.org">contact@youthopps.org</a>.</p><p>Do not publish personal, confidential or sensitive information in Discussions or Issues.</p></div></section>`);
await page('/bot/', 'YouthOppsBot',
    'How YouthOppsBot indexes public opportunities and how to contact us.',
    `<section class="wrap section narrow">
      <p class="eyebrow">FOR PUBLISHERS</p>
      <h1 class="page-title">YouthOppsBot</h1>
      <p class="lede">A transparent crawler for public opportunities.</p>
      <div class="prose">
        <p>YouthOpp is an independent project run by an individual.
          It is not a registered nonprofit organization.</p>
        <h2>What we index</h2>
        <p>We collect factual information about scholarships, programmes,
          internships and other early-career opportunities from public pages
          and feeds. We credit and link to original publishers. Publishers
          remain the authority for eligibility, deadlines and applications;
          we do not reproduce full articles.</p>
        <h2>Identify our requests</h2>
        <p>Our crawler uses this HTTP User-Agent:</p>
        <pre><code>YouthOppsBot/1.0 (+https://youthopps.org/bot/)</code></pre>
        <h2>How we collect</h2>
        <p>We review robots.txt and applicable source terms before integrating
          a source. Collection uses public routes and respects access refusals;
          it does not bypass authentication or access restrictions.</p>
        <p>Our collection policy requires each adapter to space publisher
          requests at least six seconds apart and allow no more than ten
          request starts in any rolling minute.
          Stricter source limits take priority. Publisher-wide request budgets
          are shared where required.</p>
        <p>We back off after rate limits and temporary errors, honor applicable
          Retry-After instructions, and stop when access is refused or a
          source requires permission. Collection status and the last successful
          update are available on our <a href="/sources/">source pages</a>.</p>
        <h2>Questions, corrections and removal</h2>
        <p>Email <a href="mailto:contact@youthopps.org">contact@youthopps.org</a>
          for crawler questions, private concerns, or requests to correct or
          remove a link or source. Include the affected URLs; a reason is
          optional. Please do not post sensitive information publicly.</p>
        <p>A maintainer reviews requests; submitting a request does not
          automatically remove content. Current listings and historical Git
          copies are separate. See our
          <a href="/docs/trust/#source-removal">source-removal policy</a>
          and <a href="/contact/">contact options</a>.</p>
      </div>
    </section>`);
const overview=await fs.readFile(path.join(root,'docs/start-here.md'),'utf8');
const missionSections = overview.split(/(?=^## )/m).filter((section) =>
  /^## Our (mission|vision|approach)\r?\n/.test(section));
const missionContent = '# Our mission\n\n' +
  'More opportunity. Less searching.\n\n' + missionSections.join('\n');
await page('/about/', 'Our mission', 'Our purpose, vision and values.',
    `<section class="wrap section"><article class="prose">` +
    `${markdown(missionContent)}</article></section>`);
const docsDir=path.join(root,'docs');
const docOrder=['start-here','architecture','contributing','ai-rules','trust'];
const docFiles=(await fs.readdir(docsDir)).filter(f=>f.endsWith('.md')).sort((a,b)=>docOrder.indexOf(a.replace('.md',''))-docOrder.indexOf(b.replace('.md','')));
const docItems=await Promise.all(docFiles.map(async filename=>{
 const text=await fs.readFile(path.join(docsDir,filename),'utf8');
 return {text,title:text.match(/^# (.+)$/m)?.[1]||filename,route:`/docs/${slug(filename.replace('.md',''))}/`,summary:text.split(/\r?\n\r?\n/)[1]||''};
}));
for(const doc of docItems){
 const navigation=`<nav class="docs-nav" aria-label="Documentation">${docItems.map(item=>`<a href="${item.route}" ${item.route===doc.route?'aria-current="page"':''}>${e(item.title)}</a>`).join('')}</nav>`;
 await page(doc.route,doc.title,doc.summary,`<section class="wrap section docs-page"><a href="/docs/" class="text-link">← All guides</a>${navigation}<article class="prose">${markdown(doc.text)}</article></section>`);
}
await page('/docs/','Project documentation','Five clear guides to YouthOpp: purpose, architecture, contributions, AI rules and trust.',`<section class="wrap section"><p class="eyebrow">UNDERSTAND THE PROJECT</p><h1 class="page-title">A few guides. The whole picture.</h1><p class="lede">Start with the purpose. Follow the data. Find your place to contribute.</p><div class="docs-grid">${docItems.map((d,i)=>`<a class="source-card doc-card" href="${d.route}"><span class="doc-number">0${i+1}</span><h2>${e(d.title)}</h2><p>${e(d.summary)}</p><span>${d.route.includes('ai-rules')?'View authoritative GitHub references':'Read the guide'} →</span></a>`).join('')}</div></section>`);
await page('/404/','Page not found','This page could not be found.',`<section class="wrap section narrow"><h1>That opportunity is somewhere else.</h1><p>This page could not be found. Explore our current opportunities or return home.</p><a class="button" href="/">Back to home</a></section>`);routes.pop();await fs.rename(path.join(out,'404/index.html'),path.join(out,'404.html'));await fs.rm(path.join(out,'404'),{recursive:true});
await fs.copyFile(path.join(root,'_headers'),path.join(out,'_headers'));
const replacedDocs={
 'mission-and-product':'start-here','ai-governance':'ai-rules',
 'accessibility':'trust','privacy':'trust','source-removal':'trust','security':'trust','design-and-rights':'trust',
 'adapter-contract':'architecture','cloudflare-pages':'architecture','data-model':'architecture','data-quality':'architecture','operations':'architecture','pipeline-adapters':'architecture','pipeline-operations':'architecture','site-settings':'architecture',
 'source-research':'architecture','quality-review':'architecture','access-review-2026-10-05':'architecture','country-renewal-2026-10-05':'architecture','oead-access-review-2026-10-05':'architecture','spain-access-review-2026-10-05':'architecture',
 'contributor-scoring':''
};
const redirects=[`${basePath}/contributors ${basePath}/ 301`,`${basePath}/contributors/* ${basePath}/ 301`,...Object.entries(replacedDocs).flatMap(([old,target])=>[`${basePath}/docs/${old} ${basePath}/docs/${target?target+'/':''} 301`,`${basePath}/docs/${old}/ ${basePath}/docs/${target?target+'/':''} 301`])];
await fs.writeFile(path.join(out,'_redirects'),redirects.join('\n')+'\n');
await fs.cp(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});await fs.writeFile(path.join(out,'assets',discoveryName),discoveryScript);await fs.writeFile(path.join(out,'assets',indexScriptName),indexScript);await fs.writeFile(path.join(out,'assets',stylesheetName),stylesheet);await fs.writeFile(path.join(out,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${config.url}/sitemap.xml\n`);await writeSitemaps({out,siteUrl:config.url,routes,records});await fs.writeFile(path.join(out,'llms.txt'),`# ${config.title}\n\n${config.description}\n\n${config.title} is a discovery index. Original publishers are the authority. Titles preserve source language. Missing eligibility is unknown.\n\n- [Mission](${config.url}/about/)\n- [Opportunities](${config.url}/opportunities/)\n- [Sources](${config.url}/sources/)\n- [Documentation](${config.url}/docs/)\n`);await fs.writeFile(path.join(out,'build-report.json'),JSON.stringify({generated_at:catalog.generated_at,records:records.map(r=>({id:r.id,source:r.source,publisher_country:recordPublisherCountry(r),host_countries:r.host_countries,kind:r.kind||'unknown'})),routes})+'\n');await fs.writeFile(path.join(out,'.nojekyll'),'');await compactJsonOutput(out);return{routes,records:records.length,out};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(await build());

