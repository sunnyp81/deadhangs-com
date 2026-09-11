// Record outbound intent only after the site's existing analytics consent.
// Never change the destination or add link text, search terms, or visitor identifiers.
export function trackAffiliateClick(event, browser = window) {
  if (!((event.type === 'click' && event.button === 0) ||
        (event.type === 'auxclick' && event.button === 1))) return;
  try {
    if (browser.localStorage.getItem('cookieConsent') !== 'accepted' ||
        typeof browser.gtag !== 'function') return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    const destination = new URL(anchor.href);
    const stores = new Map([
      ['amazon.co.uk', 'UK'], ['www.amazon.co.uk', 'UK'],
      ['amazon.com', 'US'], ['www.amazon.com', 'US'],
    ]);
    const store = stores.get(destination.hostname);
    const tag = destination.searchParams.get('tag');
    if (destination.protocol !== 'https:' || !store ||
        !tag || !/^[a-z0-9-]{1,64}$/i.test(tag)) return;
    browser.gtag('event', 'affiliate_click', {
      send_to: 'G-YBPRQVR2Y3',
      affiliate_partner: 'amazon',
      affiliate_store: store,
      affiliate_tag: tag,
      page_path: browser.location.pathname,
    });
  } catch {
    // Storage restrictions or analytics failures must not interrupt a purchase.
  }
}
