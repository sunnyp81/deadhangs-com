// /pro/ copy that both the visible page and its JSON-LD read, so the two cannot drift apart.
export const PRO_PRICES = { monthly: '4.99', yearly: '39' };

export const PRO_FAQ = [
  {
    q: 'Is my training log uploaded when I sign in?',
    html: 'No. Signing in uploads nothing. Holds move from this device to your account only when you choose “Merge device entries into cloud” on your account page while Pro is active.',
  },
  {
    q: 'What happens when I cancel?',
    html: 'Cancel renewal in Manage billing on your account page, or email the address on the <a href="/terms/">terms page</a>. Pro normally continues until the end of the period you have paid for. After Pro ends, your cloud log stays in your account and you can export or delete it, but merging new holds needs Pro again. Your device log is not touched. Cancelling renewal does not itself request a refund; your rights to cancel during any applicable cooling-off period and to a refund required by law are unaffected. Deleting your account ends a subscription and paid access straight away.',
  },
  {
    q: 'What is the 200-entry limit?',
    html: 'Your cloud log holds up to 200 entries, the same as the free log in your browser. A merge that would go over the limit is refused rather than cut short, so nothing is silently dropped. Your account page shows how many entries are stored.',
  },
  {
    q: 'Why is sign-in Google only?',
    html: 'Google is the only sign-in option today, so DeadHangs never stores a password. It receives your name, email address and a Google account identifier, as the <a href="/privacy/">privacy policy</a> explains.',
  },
  {
    q: 'How do I pay?',
    html: 'Payment runs through Stripe’s checkout: card, plus any other methods Stripe shows at checkout. Prices are in GBP. Check the final total, billing interval and seller details in checkout before you pay. There is no free trial; the timer and device log are free to use first.',
  },
  {
    q: 'Does Pro include coaching?',
    html: 'No. Pro is software for recording your own training. It does not include coaching, personalised training advice, medical advice or a promise of results.',
  },
  {
    q: 'I only train on one device. Is Pro still useful?',
    html: 'Progress history from your cloud entries still works, and your account keeps a copy if this browser’s storage is cleared. If you never change device and export your log regularly, the free log may be all you need.',
  },
  {
    q: 'Who runs DeadHangs Pro?',
    html: 'DeadHangs is operated by ND Media Ltd. Support and cancellation contact details are on the <a href="/terms/">terms page</a>.',
  },
];

const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function offer(price, duration, name, url) {
  return {
    '@type': 'Offer',
    name,
    price,
    priceCurrency: 'GBP',
    url,
    priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'GBP', billingDuration: duration, unitCode: duration === 'P1M' ? 'MON' : 'ANN' },
  };
}

/** SoftwareApplication with the two real subscription prices, plus FAQPage built from the visible FAQ. No ratings or reviews. */
export function proSchema(url) {
  const app = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'DeadHangs Pro',
    url,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web browser',
    description: 'Cloud sync and progress history for the free DeadHangs dead hang timer and training log.',
    provider: { '@id': 'https://deadhangs.com/#organization' },
    offers: [offer(PRO_PRICES.monthly, 'P1M', 'DeadHangs Pro monthly', url), offer(PRO_PRICES.yearly, 'P1Y', 'DeadHangs Pro yearly', url)],
  };
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PRO_FAQ.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: text(item.html) } })),
  };
  const tag = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
  return tag(app) + tag(faq);
}
