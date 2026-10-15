import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {build,escapeHtml,safeUrl,paginate} from '../scripts/build.mjs';
import {writeSources} from './helpers.mjs';
test('source escaping and safe schemes',()=>{assert.equal(escapeHtml('<script>"&'),'&lt;script&gt;&quot;&amp;');assert.equal(safeUrl('javascript:alert(1)'),'#');});
test('pagination bounds list pages',()=>assert.deepEqual(paginate(Array.from({length:61},(_,i)=>i),30).map(a=>a.length),[30,30,1]));

test('build output cannot erase source input',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-output-'));
 try{
  const input=path.join(dir,'datas');await fs.mkdir(input);
  await assert.rejects(build({input,out:path.join(input,'output')}),/must not overlap/);
  await fs.access(input);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('source names and mixed-case record IDs cannot overwrite directory routes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-routes-'));
 try{
  const input=path.join(dir,'datas'),out=path.join(dir,'site');
  await writeSources(input,{sources:[{source:'countries',name:'Country publisher'}],opportunities:[{id:'Mixed-Case',title:'A record',summary:'',url:'https://example.org/',source:'countries',category:'training',host_countries:[],eligible_countries:[],status:'unknown'}]});
  const result=await build({input,out});
  assert.ok(result.routes.includes('/sources/countries/'));
  assert.ok(result.routes.includes('/sources/publisher/countries/'));
  assert.ok(result.routes.includes('/opportunity/mixed-case/'));
  assert.equal(new Set(result.routes).size,result.routes.length);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('per-source pages preserve provenance, escape input and leave eligibility unknown',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-'));const input=path.join(dir,'datas');const out=path.join(dir,'site');await writeSources(input,{opportunities:Array.from({length:31},(_,i)=>({id:`test-${i}`,title:'Example <script>alert(1)</script>',summary:'Fixture only',category:'scholarships',host_countries:['DE'],eligible_countries:[],source:'fixture',url:'https://example.org/real',language:'de',status:'unknown'})),sources:[{source:'fixture',name:'Fixture Publisher',website_url:'https://example.org'}]});const result=await build({input,out});assert.equal(result.records,31);assert.ok(result.routes.includes('/countries/de/'));assert.ok(result.routes.includes('/opportunities/scholarships/page/2/'));const html=await fs.readFile(path.join(out,'opportunity/test-0/index.html'),'utf8');assert.ok(html.includes('https://example.org/real'));assert.ok(html.includes('Not provided — check the source'));assert.ok(html.includes('lang="de"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert'));const list=await fs.readFile(path.join(out,'opportunities/index.html'),'utf8');assert.equal((list.match(/class="opportunity"/g)||[]).length,30);assert.ok(list.includes('rel="canonical"'));await fs.rm(dir,{recursive:true,force:true});});


test('project Pages subpath prefixes every internal asset and navigation URL',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-subpath-'));const result=await build({input:await writeSources(path.join(dir,'datas')),out:path.join(dir,'site'),config:{url:'https://example.org/project/'}});const html=await fs.readFile(path.join(dir,'site/index.html'),'utf8');assert.ok(html.includes('href="/project/opportunities/"'));assert.ok(html.includes('src="/project/assets/youthopp-icon-v1.png"'));const css=html.match(/href="\/project\/assets\/(style\.[a-f0-9]{16}\.css)"/);assert.ok(css);assert.ok((await fs.readFile(path.join(dir,'site/assets',css[1]),'utf8')).includes('.source-status.active'));assert.ok(html.includes('https://example.org/project/'));assert.ok(!/\b(?:href|src)="\/(?!project\/)/.test(html));const sitemap=await fs.readFile(path.join(dir,'site/sitemap-pages.xml'),'utf8');assert.ok(sitemap.includes('https://example.org/project/docs/'));assert.ok(result.routes.includes('/'));await fs.rm(dir,{recursive:true,force:true});});

test('project identity, catalog breadcrumbs and social metadata use the configured public endpoint',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-discovery-'));
 try{
  await build({input:await writeSources(path.join(dir,'datas')),out:path.join(dir,'site'),config:{url:'https://example.org/project',description:'A source-first <script>index</script>'}});
  const html=await fs.readFile(path.join(dir,'site/opportunities/scholarships/unknown/index.html'),'utf8');
  const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const project=graph.find(n=>n['@type']==='Organization');const website=graph.find(n=>n['@type']==='WebSite');
  assert.equal(project.url,'https://example.org/project/');assert.equal(website.publisher['@id'],project['@id']);
  assert.equal(project.nonprofitStatus,undefined);
  const breadcrumbs=graph.find(n=>n['@type']==='BreadcrumbList').itemListElement;
  assert.deepEqual(breadcrumbs.map(n=>n.name),['Home','Opportunities','Scholarships','Scholarships — location not provided']);
  assert.deepEqual(breadcrumbs.map(n=>n.position),[1,2,3,4]);
  assert.ok(breadcrumbs.every(n=>n.item.startsWith('https://example.org/project/')));
  assert.ok(html.includes('name="twitter:image" content="https://example.org/project/assets/social-preview.png"'));
  assert.ok(html.includes('property="og:image:alt"'));assert.ok(html.includes('name="twitter:description"'));
  const doc=await fs.readFile(path.join(dir,'site/docs/ai-rules/index.html'),'utf8');
  const docGraph=JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.equal(docGraph.find(n=>n['@type']==='BreadcrumbList').itemListElement[1].item,'https://example.org/project/docs/');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('failed source without last-good collection remains distinct from successful source',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-source-health-'));const input=path.join(dir,'datas');const out=path.join(dir,'site');
 try{
  await writeSources(input,{opportunities:[],sources:[
   {source:'manual-fixture',name:'Recent manual candidate',website_url:'https://example.org/manual',status:'fail',last_checked_at:'2026-10-04T18:00:00Z'},
   {source:'connected-fixture',name:'Connected source fixture',website_url:'https://example.org/connected',status:'success',last_success_at:'2026-10-03T18:00:00Z',last_checked_at:'2026-10-04T18:00:00Z'}
  ]});
  await build({input,out});
  const html=await fs.readFile(path.join(out,'sources/index.html'),'utf8');
  const cards=[...html.matchAll(/<article class="source-card publisher-card">([\s\S]*?)<\/article>/g)].map(m=>m[1]);
  const candidate=cards.find(card=>card.includes('href="/sources/publisher/manual-fixture/"'));
  assert.ok(candidate.includes('fail'));assert.ok(candidate.includes('No successful collection yet'));
  assert.ok(candidate.includes('2026-10-04T18:00:00Z'));
  assert.ok(!candidate.includes('source-status active'));
  const connected=cards.find(card=>card.includes('href="/sources/publisher/connected-fixture/"'));
  assert.ok(connected.includes('2026-10-03 18:00 UTC'));assert.ok(connected.includes('source-status active'));
  assert.ok(connected.includes('2026-10-04T18:00:00Z'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});



test('programme and institutional records show accurate kind notices on catalog cards and detail pages',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-record-kind-'));const input=path.join(dir,'datas');const out=path.join(dir,'site');
 try{
  const base={summary:'',host_countries:[],eligible_countries:[],source:'fixture',url:'https://example.org/information',language:'cs',status:'unknown',deadline:null};
  await writeSources(input,{sources:[],opportunities:[
   {...base,id:'programme',title:'Programme fixture',category:'scholarships',tags:['programme-overview']},
   {...base,id:'institutional',title:'Institutional fixture',category:'grants',tags:['institutional-grant']},
   {...base,id:'regular',title:'Regular fixture',summary:'Original listing summary',category:'scholarships',tags:[]}
  ]});
  await build({input,out});const catalog=await fs.readFile(path.join(out,'opportunities/index.html'),'utf8');
  assert.ok(catalog.includes('<span class="tag">Programme overview</span>'));assert.ok(catalog.includes('<span class="tag">Institutional grant</span>'));
  assert.ok(catalog.includes('Confirm current application calls and dates with the publisher.'));
  assert.ok(catalog.includes('Funding for institutions or organisations.'));
  const programme=await fs.readFile(path.join(out,'opportunity/programme/index.html'),'utf8');
  const institutional=await fs.readFile(path.join(out,'opportunity/institutional/index.html'),'utf8');
  const regular=await fs.readFile(path.join(out,'opportunity/regular/index.html'),'utf8');
  assert.ok(programme.includes('<span class="tag">Programme overview</span>'));assert.ok(programme.includes('View programme information ↗'));
  assert.ok(institutional.includes('<span class="tag">Institutional grant</span>'));assert.ok(institutional.includes('View institutional grant details ↗'));
  for(const [html,description] of [[programme,'Programme information. Confirm current application calls and dates with the publisher.'],[institutional,'Funding for institutions or organisations. Confirm eligible applicants and current calls with the publisher.']]){
   assert.ok(html.includes(`<meta name="description" content="${description}">`));
   assert.ok(html.includes(`<meta property="og:description" content="${description}">`));
   assert.ok(html.includes(`<meta name="twitter:description" content="${description}">`));
   const graph=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
   assert.equal(graph.find(node=>node['@type']==='WebPage').description,description);
  }
  assert.ok(regular.includes('Read the original &amp; apply ↗'));assert.ok(!regular.includes('Programme overview'));assert.ok(!regular.includes('Institutional grant'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('source directory uses per-folder metadata without additional registry input',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-embedded-sources-'));const input=path.join(dir,'datas');
 try {
  await writeSources(input,{opportunities:[],sources:[{source:'adapter-one',name:'Runtime publisher',website_url:'https://example.org/',status:'fail',last_success_at:null,error:'Collection failed'}]});
  await build({input,out:path.join(dir,'out')});
  const html=await fs.readFile(path.join(dir,'out/sources/index.html'),'utf8');
  assert.equal((html.match(/<article class="source-card publisher-card">/g)||[]).length,1);
  assert.ok(html.includes('fail'));assert.ok(html.includes('No successful collection yet'));
  assert.ok(html.includes('<h2>example.org</h2>'));assert.ok(html.includes('Collection failed'));assert.ok(!html.includes('grants.at'));
  assert.ok(!html.includes('grants.at'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('multi-category records appear once in every relevant category and country listing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-multi-category-'));const input=path.join(dir,'datas');
 try{
  await writeSources(input,{sources:[],opportunities:[{id:'multi-record',title:'Combined opportunity',summary:'Discovery record',url:'https://example.org/programme',category:'scholarships',categories:['scholarships','training','training'],host_countries:['DE'],eligible_countries:[],status:'unknown'}]});
  const result=await build({input,out:path.join(dir,'out')});assert.equal(result.records,1);
  for(const route of ['opportunities/scholarships','opportunities/training','opportunities/training/de']){
   const html=await fs.readFile(path.join(dir,'out',route,'index.html'),'utf8');assert.equal((html.match(/class="opportunity"/g)||[]).length,1);
  }
  const unrelated=await fs.readFile(path.join(dir,'out/opportunities/jobs/index.html'),'utf8');assert.ok(!unrelated.includes('Combined opportunity'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('canonical record kinds override legacy tags and preserve information-only application actions',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-canonical-kind-'));const input=path.join(dir,'datas');const out=path.join(dir,'site');
 try{
  const base={summary:'',category:'scholarships',host_countries:[],eligible_countries:[],source:'fixture',url:'https://example.org/information',status:'unknown'};
  await writeSources(input,{sources:[],opportunities:[
   {...base,id:'programme-kind',title:'Programme kind only',kind:'programme-overview',tags:[]},
   {...base,id:'institutional-kind',title:'Institutional kind only',kind:'institutional-grant',category:'grants',tags:[]},
   {...base,id:'programme-conflict',title:'Programme wins conflicting tag',kind:'programme-overview',tags:['institutional-grant']},
   {...base,id:'institutional-conflict',title:'Institutional wins conflicting tag',kind:'institutional-grant',category:'grants',tags:['programme-overview']},
   {...base,id:'opportunity-conflict',title:'Opportunity wins conflicting tags',kind:'opportunity',tags:['programme-overview','institutional-grant']},
   {...base,id:'unknown-conflict',title:'Unknown wins conflicting tags',kind:'unknown',tags:['programme-overview','institutional-grant']}
  ]});
  await build({input,out});
  const listing=await fs.readFile(path.join(out,'opportunities/index.html'),'utf8');
  for(const [id,label,action,description] of [
   ['programme-kind','Programme overview','View programme information ↗','Programme information. Confirm current application calls and dates with the publisher.'],
   ['programme-conflict','Programme overview','View programme information ↗','Programme information. Confirm current application calls and dates with the publisher.'],
   ['institutional-kind','Institutional grant','View institutional grant details ↗','Funding for institutions or organisations. Confirm eligible applicants and current calls with the publisher.'],
   ['institutional-conflict','Institutional grant','View institutional grant details ↗','Funding for institutions or organisations. Confirm eligible applicants and current calls with the publisher.']
  ]){
   const row=(listing.match(/<tr class="opportunity"[^>]*>[\s\S]*?<\/tr>/g)||[]).find(row=>row.includes('/opportunity/'+id+'/"'));
   assert.ok(row?.includes('<span class="tag">'+label+'</span>'),id+' listing kind');
   const html=await fs.readFile(path.join(out,'opportunity',id,'index.html'),'utf8');
   assert.ok(html.includes('<span class="tag">'+label+'</span>'),id+' detail kind');
   assert.ok(html.includes(action),id+' information action');
   assert.ok(!html.includes('Read the original &amp; apply'),id+' never implies an application');
   assert.ok(!html.includes('<span class="tag">'+(label==='Programme overview'?'Institutional grant':'Programme overview')+'</span>'),id+' ignores conflicting tag');
   for(const meta of ['<meta name="description"','<meta property="og:description"','<meta name="twitter:description"'])assert.ok(html.includes(meta+' content="'+description+'">'),id+' metadata description');
  }
  for(const id of ['opportunity-conflict','unknown-conflict']){
   const html=await fs.readFile(path.join(out,'opportunity',id,'index.html'),'utf8');
   assert.ok(html.includes(id==='unknown-conflict'?'Visit the original source ↗':'Read the original &amp; apply ↗'),id+' accurate discovery action');
   if(id==='unknown-conflict'){assert.ok(html.includes('Indexed source page'));assert.ok(!html.includes('Read the original &amp; apply'));}
   assert.ok(!html.includes('Programme overview'));assert.ok(!html.includes('Institutional grant'));
   const row=(listing.match(/<tr class="opportunity"[^>]*>[\s\S]*?<\/tr>/g)||[]).find(row=>row.includes('/opportunity/'+id+'/"'));
   if(id==='unknown-conflict')assert.equal(row,undefined,'unclassified publisher pages are not opportunity listings');
   else {assert.ok(row);assert.ok(!row.includes('Programme overview'));assert.ok(!row.includes('Institutional grant'));}
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('publisher attribution is escaped wherever source titles appear without inventing missing notices',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-attribution-'));const input=path.join(dir,'datas');const out=path.join(dir,'site');
 const base={title:'Programme fixture',summary:'',category:'scholarships',host_countries:[],eligible_countries:[],url:'https://example.org/programme',language:'en',status:'unknown'};
 try{
  await writeSources(input,{sources:[{source:'credited',name:'OeAD',website_url:'https://example.org/credited',attribution:'© OeAD <script>alert(1)</script>'},{source:'ordinary',name:'Ordinary publisher',website_url:'https://example.org/ordinary'}],opportunities:[{...base,id:'credited-record',source:'credited'},{...base,id:'ordinary-record',source:'ordinary'}]});
  await build({input,out});const sources=await fs.readFile(path.join(out,'sources/index.html'),'utf8');const detail=await fs.readFile(path.join(out,'opportunity/credited-record/index.html'),'utf8');
  const listingRoutes=['index.html','opportunities/index.html','opportunities/scholarships/index.html','countries/unknown/index.html','opportunities/scholarships/unknown/index.html'];
  const listings=await Promise.all(listingRoutes.map(route=>fs.readFile(path.join(out,route),'utf8')));
  for(const html of [sources,detail]){assert.ok(html.includes('Source attribution: © OeAD &lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));}
  for (const html of listings) {
    const creditedRow = (html.match(/<tr class="opportunity"[^>]*>[\s\S]*?<\/tr>/g) || [])
        .find(row => row.includes('/opportunity/credited-record/'));
    assert.ok(creditedRow.includes('<a class="row-source" href="/sources/publisher/credited/">© OeAD &lt;script&gt;alert(1)&lt;/script&gt;</a>'));
    assert.ok(!creditedRow.includes('row-source-country'));
    assert.ok(creditedRow.includes('class="row-source-website" href="https://example.org/credited"'));
    assert.ok(!creditedRow.includes('Source attribution:'));
    assert.ok(!creditedRow.includes('source-attribution'));
    assert.ok(!creditedRow.includes('<script>alert(1)</script>'));
    const ordinaryRow = (html.match(/<tr class="opportunity"[^>]*>[\s\S]*?<\/tr>/g) || [])
        .find(row => row.includes('/opportunity/ordinary-record/'));
    assert.ok(ordinaryRow.includes('href="/sources/publisher/ordinary/">Institution not provided</a>'));
  }
  const listing = listings[1];
  const indexPath = listing.match(/data-index="([^"]+)"/)[1];
  const index = JSON.parse(await fs.readFile(path.join(out, indexPath), 'utf8'));
  assert.ok(index.find(item => item.id === 'credited-record').search.includes('© OeAD'));

  for(const html of listings){const ordinaryRow=(html.match(/<tr class="opportunity"[^>]*>[\s\S]*?<\/tr>/g)||[]).find(row=>row.includes('/opportunity/ordinary-record/'));assert.ok(ordinaryRow);assert.ok(!ordinaryRow.includes('source-attribution'));}
  const ordinary=await fs.readFile(path.join(out,'opportunity/ordinary-record/index.html'),'utf8');assert.ok(!ordinary.includes('source-attribution'));assert.equal((sources.match(/class="small source-attribution"/g)||[]).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('five guides link authoritative rules and keep removal links accessible',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-docs-'));
 try{
  const out=path.join(dir,'site');
  const result=await build({input:await writeSources(path.join(dir,'datas')),out,config:{url:'https://example.org/project/'}});
  assert.deepEqual(result.routes.filter(route=>route.startsWith('/docs/')).sort(),['/docs/','/docs/ai-rules/','/docs/architecture/','/docs/contributing/','/docs/start-here/','/docs/trust/']);
  for(const route of ['index.html','sources/index.html','docs/trust/index.html']){
   const html=await fs.readFile(path.join(out,route),'utf8');
   assert.ok(html.includes('<a href="/project/docs/trust/#source-removal">Request source removal</a>'));
  }
  const rules=await fs.readFile(path.join(out,'docs/ai-rules/index.html'),'utf8');
  assert.equal((rules.match(/<details class="doc-details">/g)||[]).length,0);
  assert.equal((rules.match(/<h1 /g)||[]).length,1);
  for (const file of ['AGENTS.md', 'docs/WORKFLOW.md',
    'skills/website/SKILL.md', 'skills/adapter/SKILL.md',
    'skills/adapter/references/development.md',
    'skills/adapter/references/testing.md']) {
    assert.ok(rules.includes(
        `href="https://github.com/YouthOpps/ai-workspace/blob/main/${file}"`));
  }
  const architecture=await fs.readFile(path.join(out,'docs/architecture/index.html'),'utf8');
  assert.equal((architecture.match(/<figure class="doc-flow">/g)||[]).length,2);
  const trust=await fs.readFile(path.join(out,'docs/trust/index.html'),'utf8');
  assert.ok(trust.includes('id="source-removal"'));assert.ok(trust.includes('href="mailto:contact@youthopps.org"'));
  const redirects=await fs.readFile(path.join(out,'_redirects'),'utf8');
  assert.ok(redirects.includes('/project/docs/contributor-scoring/ /project/docs/ 301'));
  assert.ok(redirects.includes('/project/docs/privacy/ /project/docs/trust/ 301'));
  await assert.rejects(fs.access(path.join(out,'docs/contributor-scoring/index.html')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

 test('central settings drive shared branding and canonical discovery on every route',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-settings-'));const out=path.join(dir,'site');
 try{
  const result=await build({input:await writeSources(path.join(dir,'datas')),out,config:{title:'Shared <brand>',tagline:'Shared tagline',brandCaption:'Shared caption',mission:'Shared mission',repositoryUrl:'https://github.com/example/project',organizationUrl:'https://github.com/example',googleAnalyticsId:'G-EXAMPLE123',googleVerification:'google-token',bingVerification:'bing-token'}});
  for(const route of result.routes){const html=await fs.readFile(path.join(out,route,'index.html'),'utf8');
   assert.ok(html.includes('content="https://youthopps.org'+route+'"'));
   assert.ok(html.includes('<span>Shared &lt;brand&gt;</span>'));assert.ok(html.includes('Shared tagline'));assert.ok(html.includes('Shared caption'));assert.ok(html.includes('Shared mission'));
   assert.ok(html.includes('href="https://github.com/example"'));assert.ok(html.includes('data-id="G-EXAMPLE123"'));
   assert.ok(html.includes('name="google-site-verification" content="google-token"'));assert.ok(html.includes('name="msvalidate.01" content="bing-token"'));
   const graph=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(graph['@graph'][0].name,'Shared <brand>');assert.equal(graph['@graph'][1].name,'Shared <brand>');
  }
  for(const file of ['robots.txt','sitemap.xml','llms.txt']){const text=await fs.readFile(path.join(out,file),'utf8');assert.ok(text.includes('https://youthopps.org'));assert.ok(!text.includes('fmarslan.github.io'));}
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('deadline order retains expired records and collection indexes include later pages',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-deadlines-'));
 try{
  const base={source:'fixture',summary:'',category:'scholarships',host_countries:['DE'],eligible_countries:['FR'],url:'https://example.org/apply',status:'unknown'};
  const opportunities=[{...base,id:'unknown-date',title:'Unknown deadline',deadline:null},{...base,id:'late-date',title:'Future deadline',deadline:'2099-10-10'},{...base,id:'expired-date',title:'Expired deadline',deadline:'2000-01-01',status:'expired'},...Array.from({length:31},(_,i)=>({...base,id:'middle-'+i,title:'Searchable '+i,deadline:'2099-01-01'}))];
  const input=await writeSources(path.join(dir,'datas'),{opportunities});const out=path.join(dir,'site');
  await build({input,out,config:{url:'https://example.org/project/'}});
  const html=await fs.readFile(path.join(out,'opportunities/index.html'),'utf8');
  assert.ok(html.includes('data-deadline='));assert.ok(!html.includes('Expired deadline'));
  const lastPage = await fs.readFile(path.join(out,'opportunities/page/2/index.html'),'utf8');
  assert.ok(lastPage.indexOf('Unknown deadline') < lastPage.indexOf('Expired deadline'));
  const index=JSON.parse(await fs.readFile(path.join(out,html.match(/data-index="([^"]+)"/)[1].replace('/project/','')),'utf8'));
  assert.equal(index.length,34);assert.ok(index[0].html.includes('Searchable'));assert.ok(index.at(-2).html.includes('Unknown deadline'));assert.ok(index.at(-1).html.includes('Expired deadline'));
  assert.equal(index.at(-1).deadline,Date.parse('2000-01-01T23:59:59.999Z'));
  assert.equal(index.at(-2).deadline,null);
  const home = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  assert.ok(home.includes('data-preview-index='));
  assert.ok(!home.includes('Expired deadline'));
  const scriptName = home.match(/src="\/project\/assets\/(index\.[a-f0-9]{16}\.js)"/)[1];
  const script = await fs.readFile(path.join(out, 'assets', scriptName), 'utf8');
  const discoveryName = script.match(/'\.\/(discovery\.[a-f0-9]{16}\.js)'/)[1];
  assert.ok((await fs.readFile(path.join(out, 'assets', discoveryName), 'utf8'))
      .includes('export function sortOpportunities'));

  assert.ok(index.some(item=>item.search.includes('Searchable 30')));assert.ok(index.every(item=>item.html.includes('/project/opportunity/')));
  assert.deepEqual(index[0].destination,['DE']);assert.deepEqual(index[0].eligible,['FR']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('detail summaries have independent language without changing title languages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'youthopp-languages-'));
  try {
    const input = path.join(dir, 'datas');
    const out = path.join(dir, 'site');
    const base = {
      summary: 'A factual description', category: 'training',
      host_countries: [], eligible_countries: [], source: 'fixture',
      url: 'https://example.org/real', status: 'unknown',
    };
    await writeSources(input, {opportunities: [
      {...base, id: 'mixed', title: 'Izvorni naslov', language: 'hr', summary_language: 'en'},
      {...base, id: 'localized', title: 'Програма', language: 'bg', summary_language: 'bg'},
      {...base, id: 'legacy', title: 'Alter Titel', language: 'de'},
      {...base, id: 'unspecified', title: 'Unknown language'},
    ]});
    await build({input, out});
    for (const [id, titleLanguage, summaryLanguage] of [
      ['mixed', 'hr', 'en'], ['localized', 'bg', 'bg'],
      ['legacy', 'de', 'de'], ['unspecified', 'und', 'und'],
    ]) {
      const html = await fs.readFile(path.join(out, 'opportunity', id, 'index.html'), 'utf8');
      assert.ok(html.includes(`<h1 class="page-title" lang="${titleLanguage}">`));
      assert.ok(html.includes(`<p class="lede" lang="${summaryLanguage}">`));
    }
    const listing = await fs.readFile(path.join(out, 'opportunities/index.html'), 'utf8');
    assert.match(listing, /lang="hr"[^>]*>Izvorni naslov/);
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('homepage country cloud retains small countries with bounded sizing and counts',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-cloud-'));
 try{
  const base={summary:'',category:'training',eligible_countries:[],url:'https://example.org',status:'unknown'};
  const opportunities=[...Array.from({length:10},(_,i)=>({...base,id:'de-'+i,title:'German '+i,source:'germany',host_countries:['DE']})),{...base,id:'at-1',title:'Austria example',source:'austria',host_countries:['AT']}];
  const input=await writeSources(path.join(dir,'datas'),{sources:[{source:'germany',name:'German publisher',publisher_country:'DE'},{source:'austria',name:'Austrian publisher',publisher_country:'AT'}],opportunities});
  await build({input,out:path.join(dir,'site')});
  const html=await fs.readFile(path.join(dir,'site/index.html'),'utf8');
  assert.match(html,/aria-label="Austria, 1 opportunities"/);
  assert.match(html,/aria-label="Germany, 10 opportunities"/);
  assert.ok(html.indexOf('aria-label="Austria, 1 opportunities"')<html.indexOf('aria-label="Germany, 10 opportunities"'));
  const sizes=[...html.matchAll(/href="\/opportunities\/from\/(?:at|de)\/" style="font-size:(\d+)px"/g)].map(match=>Number(match[1]));
  assert.equal(sizes.length,2);assert.ok(sizes.every(size=>size>=13&&size<=22));assert.ok(sizes[0]<sizes[1]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('source directories are alphabetized by visible publisher name',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-alpha-'));
 try{
  const sources=[{source:'zeta',name:'Zulu Foundation',publisher_country:'DE'},{source:'beta',name:'beta Institute',publisher_country:'DE'},{source:'alpha',name:'Alpha Academy',publisher_country:'DE'}];
  await build({input:await writeSources(path.join(dir,'datas'),{sources}),out:path.join(dir,'site')});
  for(const route of ['sources/index.html','sources/countries/de/index.html']){
   const html=await fs.readFile(path.join(dir,'site',route),'utf8');
   const names=[...html.matchAll(/<article class="source-card publisher-card">[\s\S]*?<h2>([^<]+)<\/h2>/g)].map(match=>match[1]);
   assert.deepEqual(names,['Alpha Academy','beta Institute','Zulu Foundation']);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('homepage displays ten most recently attempted sources and statuses',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'youthopp-recent-'));
 try{
  const sources=Array.from({length:12},(_,i)=>({source:'source-'+i,name:'Publisher '+i,status:i===11?'fail':'success',last_attempt_at:new Date(Date.UTC(2026,9,i+1)).toISOString()}));
  await build({input:await writeSources(path.join(dir,'datas'),{sources}),out:path.join(dir,'site')});
  const html=await fs.readFile(path.join(dir,'site/index.html'),'utf8');
  const section=html.split('<div class="publisher-list">')[1].split('</div><a href="/sources/">')[0];
  assert.equal((section.match(/href="\/sources\/publisher\//g)||[]).length,10);
  assert.ok(section.includes('/sources/publisher/source-11/'));
  assert.ok(!section.includes('/sources/publisher/source-0/'));
  assert.ok(section.includes('source-status issue')&&section.includes('Fail'));
  assert.match(section,/<div class="publisher-list-heading"><a href="\/sources\/publisher\/source-11\/">Publisher 11<\/a><span class="source-status issue">Fail<\/span><\/div>/);
  assert.match(section,/<p>International \/ unspecified · <time datetime="2026-10-12T00:00:00.000Z">/);
  assert.ok(section.includes('<time datetime="2026-10-12T00:00:00.000Z">'));
  assert.ok(html.includes('Explore all sources'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
