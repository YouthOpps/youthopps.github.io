import {filterItems, pageNumbers, pageSlice, isExpired, sortOpportunities} from './discovery.js';

const compactLayout = window.matchMedia('(max-width: 1000px)');
const compactBrowse = () => {
 if (compactLayout.matches) for (const section of document.querySelectorAll('.filters details')) section.open = false;
};
compactBrowse();
compactLayout.addEventListener('change', compactBrowse);

function updateExpiry() {
 const now = Date.now();
 for (const item of document.querySelectorAll('[data-deadline]')) {
  const expired = isExpired(item.dataset.deadline, now);
  item.classList.toggle('expired', expired);
  for (const label of item.querySelectorAll('.expiry-label')) label.hidden = !expired;
 }
}
updateExpiry();
const refreshListings = [];
function refreshDeadlines() {
  updateExpiry();
  for (const refresh of refreshListings) {
    refresh();
  }
}
setInterval(refreshDeadlines, 30_000);
document.addEventListener('visibilitychange', refreshDeadlines);
window.addEventListener('pageshow', refreshDeadlines);

for (const preview of document.querySelectorAll('[data-preview-index]')) {
  let request;
  let previousHtml;
  async function refresh() {
    try {
      if (!request) {
        request = fetch(preview.dataset.previewIndex).then(response => {
          if (!response.ok) {
            throw new Error('Preview index unavailable');
          }
          return response.json();
        });
      }
      const items = sortOpportunities(await request).slice(0, 12);
      const html = items.map(item => item.html).join('');
      if (html !== previousHtml) {
        preview.innerHTML = html;
        previousHtml = html;
      }
      updateExpiry();
    } catch {
      request = null;
    }
  }
  refreshListings.push(refresh);
  refresh();
}

for (const collection of document.querySelectorAll('.collection')) {
 const form = collection.querySelector('form');
 const results = collection.querySelector('.collection-results');
 const status = collection.querySelector('.filter-status');
 const navigation = collection.querySelector('.pagination');
 const fields = [...form.querySelectorAll('input[name],select[name]')];
 let currentPage = Number(collection.dataset.page);
 let expiryState;
 let request;
 let generation = 0;
 const readState = () => Object.fromEntries(fields.map(field => [field.name, field.value]));
 const subscription = collection.querySelector('.rss-subscription');
 const feedRoot = subscription ? new URL(subscription.querySelector('.rss-link').href).pathname.split('/feeds/')[0] : '';
 const updateSubscription = () => {
  if (!subscription) return;
  const filters = readState();
  const link = subscription.querySelector('.rss-link');
  link.hidden = ['q', 'category', 'destination', 'eligible'].some(key => filters[key]);
  const country = filters.country || subscription.dataset.feedCountry;
  const source = filters.source || subscription.dataset.feedSource;
  const conflict = (filters.country && subscription.dataset.feedCountry &&
      filters.country !== subscription.dataset.feedCountry) ||
      (filters.source && subscription.dataset.feedSource &&
      filters.source !== subscription.dataset.feedSource);
  const route = conflict ? '/feeds/empty.xml' : '/feeds/' +
      (country ? `countries/${encodeURIComponent(country)}/` : '') +
      (source ? `sources/${encodeURIComponent(source)}.xml` : 'all.xml');
  link.href = new URL(feedRoot + route, location.origin).href;
 };
 const restore = () => {
  const params = new URLSearchParams(location.search);
  for (const field of fields) field.value = params.get(field.name) || '';
  currentPage = Number(params.get('page')) || Number(location.pathname.match(/\/page\/(\d+)\/$/)?.[1]) || 1;
 };
 const urlFor = page => {
  const url = new URL(collection.dataset.base, location.origin);
  for (const [key,value] of Object.entries(readState())) if(value) url.searchParams.set(key,value);
  if(page > 1) url.searchParams.set('page',String(page));
  return url;
 };
 const load = () => {
  if (!request) request = fetch(collection.dataset.index).then(response => {
   if (!response.ok) throw new Error('Search index unavailable');
   return response.json();
  }).catch(error => {request = null; throw error;});
  return request;
 };
 async function render(historyMode) {
  updateSubscription();
  const version = ++generation;
  status.textContent = 'Searching…';
  collection.setAttribute('aria-busy','true');
  try {
   const items = await load();
   if (version !== generation) return;
   const now = Date.now();
   expiryState = items.map(item => isExpired(item.deadline, now)).join(',');
   const filtered = filterItems(sortOpportunities(items, now), readState());
   const page = pageSlice(filtered, currentPage, Number(collection.dataset.pageSize));
   currentPage = page.current;
   // These fragments are generated and escaped by our build, not browser input.
   results.innerHTML = page.items.map(item => item.html).join('');
   collection.querySelector('.result-count').textContent = `${filtered.length} results`;
   collection.querySelector('.page-count').textContent = `Page ${currentPage} of ${page.total}`;
   collection.querySelector('.no-results').hidden = filtered.length !== 0;
   navigation.replaceChildren();
   const addLink = (number, title) => {
    const link = document.createElement('a');
    link.href = urlFor(number).href;
    link.textContent = title || String(number);
    if (number === currentPage) link.setAttribute('aria-current','page');
    link.addEventListener('click', event => {
     if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
     event.preventDefault(); currentPage=number; render('push');
    });
    navigation.append(link);
   };
   if(currentPage>1) addLink(currentPage-1,'← Previous');
   for(const number of pageNumbers(page.total,currentPage)) {
    if(number===null) { const ellipsis=document.createElement('span');ellipsis.textContent='…';ellipsis.setAttribute('aria-hidden','true');navigation.append(ellipsis); }
    else addLink(number);
   }
   if(currentPage<page.total) addLink(currentPage+1,'Next →');
   if(historyMode) history[historyMode==='push'?'pushState':'replaceState'](null,'',urlFor(currentPage));
   status.textContent = `${filtered.length} results. Page ${currentPage} of ${page.total}.`;
   updateExpiry();
  } catch {
   if(version===generation) status.textContent='Search could not load. The original page remains available. Try Search again.';
  } finally {if(version===generation)collection.removeAttribute('aria-busy');}
 }
 form.addEventListener('submit',event=>{event.preventDefault();currentPage=1;render('push');});
 let debounce;
 form.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>{currentPage=1;render('replace');},180);});
 form.addEventListener('change',()=>{clearTimeout(debounce);currentPage=1;render('push');});
 form.addEventListener('reset',()=>{clearTimeout(debounce);setTimeout(()=>{currentPage=1;render('push');},0);});
 window.addEventListener('popstate',()=>{restore();render();});
 restore();
 refreshListings.push(async () => {
   try {
     const items = await load();
     const now = Date.now();
     const nextState = items.map(item => isExpired(item.deadline, now)).join(',');
     if (nextState !== expiryState) {
       render();
     }
   } catch {
     // Static listings stay available when the index cannot be loaded.
   }
 });
 render();
}
