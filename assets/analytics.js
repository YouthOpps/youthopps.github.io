// Only explicit consent activates Google tracking and catalog events.
const settings = document.currentScript?.dataset || {};
const analyticsId = settings.id;
const siteName = settings.siteName || 'this site';
const basePath = settings.base || '';
const categories = new Set((settings.categories || '').split(' ').filter(Boolean));
const countries = new Set((settings.countries || '').split(' ').filter(Boolean));
let enabled = false;

function catalogContext(pathname) {
  if (basePath && !pathname.startsWith(basePath + '/')) return null;
  const route = pathname.slice(basePath.length).replace(/\/$/, '').split('/').filter(Boolean);
  let category = 'all';
  let country = 'all';
  let remaining;
  if (route[0] === 'opportunities') {
    remaining = route.slice(1);
    if (categories.has(remaining[0])) category = remaining.shift();
    if (countries.has(remaining[0])) country = remaining.shift();
  } else if (route[0] === 'countries' && countries.has(route[1])) {
    country = route[1];
    remaining = route.slice(2);
  } else return null;
  let pageNumber = 1;
  if (remaining.length) {
    if (remaining.length !== 2 || remaining[0] !== 'page' || !/^[1-9]\d*$/.test(remaining[1])) return null;
    pageNumber = Number(remaining[1]);
    if (!Number.isSafeInteger(pageNumber)) return null;
  }
  return {category, country, page_number: pageNumber};
}

function track(name, parameters) {
  if (enabled) window.gtag('event', name, parameters);
}

if (/^G-[A-Z0-9]+$/.test(analyticsId || '')) {
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    let destination;
    try { destination = new URL(anchor.href, window.location.href); } catch { return; }
    if (destination.origin !== window.location.origin || destination.hash) return;
    const context = catalogContext(destination.pathname);
    if (!context) return;
    if (context.country === 'all') track('category_select', context);
    else track('country_select', context);
  });
  document.addEventListener('change', event => {
    const field = event.target;
    if (field.name !== 'country' || !field.closest?.('.index-search')) return;
    const country = field.value || 'all';
    if (country !== 'all' && !countries.has(country.toLowerCase())) return;
    const context = catalogContext(window.location.pathname) || {category: 'all', page_number: 1};
    track('country_filter', {...context, country: country.toLowerCase()});
  });
  const panel = document.createElement('div');
  panel.className = 'analytics-consent';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Optional analytics');
  const enable = () => {
    if (enabled) return;
    enabled = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // Strip queries and fragments from both URLs before sending a page view.
    let referrer = '';
    if (document.referrer) {
      const url = new URL(document.referrer);
      referrer = url.origin + url.pathname;
    }
    window.gtag('config', analyticsId, {page_location: window.location.origin + window.location.pathname, page_referrer: referrer});
    const context = catalogContext(window.location.pathname);
    if (context) track('catalog_view', context);
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${analyticsId}`;
    script.async = true;
    document.head.append(script);
  };
  let choice;
  try { choice = localStorage.getItem('youthopp-analytics'); } catch {}
  if (choice === 'allow') enable();
  else if (choice !== 'deny') {
    panel.innerHTML = `<p><a href="${basePath}/docs/trust/">Privacy details</a></p><button type="button" data-choice="deny">Decline</button><button type="button" data-choice="allow">Allow analytics</button>`;
    panel.querySelector('p').prepend(document.createTextNode(`Allow optional Google Analytics to help improve ${siteName}? `));
    panel.addEventListener('click', event => {
      const selected = event.target.dataset.choice;
      if (!['allow', 'deny'].includes(selected)) return;
      try { localStorage.setItem('youthopp-analytics', selected); } catch {}
      panel.remove();
      if (selected === 'allow') enable();
    });
    document.body.append(panel);
  }
}
