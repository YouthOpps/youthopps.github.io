import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const code = await fs.readFile(new URL('../assets/analytics.js', import.meta.url), 'utf8');
const categoryIds = ['scholarships','internships','volunteering','training','jobs','competitions','grants','fellowships','other'];
const countryIds = ['us','at','be','bg','hr','cy','cz','dk','ee','fi','fr','de','gr','hu','ie','it','lv','lt','lu','mt','nl','pl','pt','ro','sk','si','es','se','unknown'];
function session({choice='allow', route='/opportunities/', base='', id='G-MGW77TH5Z3'}={}) {
 const listeners = {}; const panelListeners = {}; const inserted = [];
 const panel = {setAttribute(){},querySelector(){return {prepend(){}}},addEventListener(name,handler){panelListeners[name]=handler},remove(){}};
 const context = {URL,window:{location:new URL('https://youthopps.org'+base+route+'?q=private-search#private-fragment')},localStorage:{getItem(){return choice},setItem(){}},document:{referrer:'https://youthopps.org/search/?q=private-query#private',currentScript:{dataset:{id,base,siteName:'YouthOpp',categories:categoryIds.join(' '),countries:countryIds.join(' ')}},createElement(kind){return kind==='div'?panel:{}},createTextNode(value){return value},addEventListener(name,handler){listeners[name]=handler},head:{append(value){inserted.push(value)}},body:{append(){}}}};
 vm.runInNewContext(code,context);
 const events=()=>JSON.parse(JSON.stringify((context.window.dataLayer||[]).map(args=>Array.from(args)).filter(args=>args[0]==='event')));
 const click=href=>listeners.click?.({target:{closest(){return {href}}}});
 const filter=value=>listeners.change?.({target:{name:'country',value,closest(){return {}}}});
 return {context,events,inserted,click,filter,allow(){panelListeners.click({target:{dataset:{choice:'allow'}}})}};
}
test('every category and target country emits bounded catalog view and navigation parameters',()=>{
 for(const category of categoryIds){const s=session({route:`/opportunities/${category}/`});assert.deepEqual(s.events(),[['event','catalog_view',{category,country:'all',page_number:1}]]);s.click(`https://youthopps.org/opportunities/${category}/`);assert.equal(s.events().at(-1)[1],'category_select');}
 for(const country of countryIds){const s=session({route:`/countries/${country}/`});assert.deepEqual(s.events(),[['event','catalog_view',{category:'all',country,page_number:1}]]);s.click(`https://youthopps.org/countries/${country}/`);assert.equal(s.events().at(-1)[1],'country_select');}
 for(const category of categoryIds)for(const country of countryIds){const s=session({route:`/opportunities/${category}/${country}/page/2/`});assert.deepEqual(s.events()[0][2],{category,country,page_number:2});}
});
test('consent discards previous interactions and prevents scripts/events while declined',()=>{
 for(const choice of ['deny',null]){const s=session({choice,route:'/countries/de/'});s.click('https://youthopps.org/opportunities/jobs/');s.filter('FR');assert.equal(s.inserted.length,0);assert.deepEqual(s.events(),[]);if(choice===null){s.allow();assert.equal(s.inserted.length,1);assert.deepEqual(s.events(),[['event','catalog_view',{category:'all',country:'de',page_number:1}]]);}}
});
test('country filter is validated and page configuration excludes free text',()=>{
 const s=session({route:'/opportunities/training/de/page/2/'});s.filter('FR');assert.deepEqual(s.events().at(-1),['event','country_filter',{category:'training',country:'fr',page_number:2}]);
 const count=s.events().length;s.filter('private-email@example.com');s.click('https://external.example/countries/de/');s.click('https://youthopps.org/opportunities/private-search/');s.click('https://youthopps.org/opportunities/training/de/page/2/#main');assert.equal(s.events().length,count);
 const config=Array.from(s.context.window.dataLayer[1]);assert.equal(config[2].page_location,'https://youthopps.org/opportunities/training/de/page/2/');assert.equal(config[2].page_referrer,'https://youthopps.org/search/');assert.ok(!JSON.stringify(s.events()).includes('private'));
});
test('event routing supports deliberate local subpaths and ignores invalid identifiers',()=>{
 const s=session({base:'/project',route:'/opportunities/jobs/us/page/3/'});assert.deepEqual(s.events()[0][2],{category:'jobs',country:'us',page_number:3});s.click('https://youthopps.org/countries/us/');assert.equal(s.events().length,1);
 const noId=session({id:'invalid'});assert.deepEqual(noId.events(),[]);assert.equal(noId.inserted.length,0);
});
