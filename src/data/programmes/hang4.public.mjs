// Public metadata for the paid four-week guided programme. Session content is server-only (src/server/programmes/).
// Changing status to approved/published needs a real qualified reviewer recorded below for this exact version;
// tests reject an approved status without complete review fields. The production flag is a second, separate key.

export const HANG4 = Object.freeze({
  id: 'hang4',
  version: '0.1.0',
  status: 'draft', // draft | ready_for_review | approved | published
  name: 'Four-week guided hang programme',
  shortName: 'Guided four weeks',
  price: Object.freeze({ amount: 2900, currency: 'gbp' }),
  billing: Object.freeze({ product: 'programme_hang4', priceEnv: 'STRIPE_PROGRAMME_PRICE_ID' }),
  eligibility: Object.freeze({
    standard: 'A hold you can repeat for three clean sets of about 5 to 20 seconds.',
    supported: 'Not yet able to hold about 5 seconds: a feet-supported route.',
    outside: 'If you can already repeat 20 seconds or more, this programme is not built for you.',
  }),
  audience: Object.freeze([
    'Adults with access to a pull-up bar or similar bar who have tried hanging.',
    'People who want a short, structured plan and a record of their own progress.',
  ]),
  notFor: Object.freeze([
    'Anyone told by a clinician not to hang, or with shoulder hypermobility or instability who has not asked a clinician first.',
    'Anyone looking for personal coaching or a diagnosis.',
  ]),
  equipment: Object.freeze([
    'A secure bar you can grip, with your feet able to reach the floor or a step.',
    'A soft surface underneath, such as a rubber mat, carpet or grass.',
  ]),
  timePerWeek: 'Three short sessions a week, with a rest day between sessions.',
  // Inclusions shown on the sales page. Only `promised: true` items may be shown or sold; each needs its feature or asset available.
  inclusions: Object.freeze([
    Object.freeze({ id: 'route', promised: true, text: 'A starting route matched to your own repeatable hold, including a feet-supported route.' }),
    Object.freeze({ id: 'sessions', promised: true, text: 'Twelve guided sessions over four weeks, plus a start session and a test day.' }),
    Object.freeze({ id: 'timer', promised: true, text: 'Every session opens the free timer with your set times and rest already filled in.' }),
    Object.freeze({ id: 'record', promised: true, text: 'Record what you actually held, set by set, separate from the planned target.' }),
    Object.freeze({ id: 'reviews', promised: true, text: 'A short review after each week: carry on, or repeat the week.' }),
    Object.freeze({ id: 'final', promised: true, text: 'A final comparison with your start test, only when the setup matches.' }),
    Object.freeze({ id: 'devices', promised: true, text: 'Your programme progress is saved to your account, so it works on any device you sign in on.' }),
    Object.freeze({ id: 'demos', promised: true, asset: 'illustrations', text: 'Illustrated demonstrations of setup, grip and getting on and off the bar.' }),
    Object.freeze({ id: 'videos', promised: false, asset: 'videos', text: 'Short demonstration videos.' }),
    Object.freeze({ id: 'reminders', promised: false, feature: 'reminders', text: 'Optional email reminders on the days you choose.' }),
  ]),
  assets: Object.freeze([
    Object.freeze({ id: 'illustrations', kind: 'illustration', available: true, note: 'HangFigure poses and demo loops already on the site.' }),
    Object.freeze({ id: 'videos', kind: 'video', available: false, note: 'Not filmed. See the filming brief in the harness programme folder.' }),
  ]),
  // Owner decisions still open are written as null and block sales until set.
  terms: Object.freeze({
    access: null, // e.g. 'Access for at least 12 months from purchase.'
    support: null, // e.g. 'Email support about using the programme, reply within 3 working days. Not personal coaching.'
    refund: null, // e.g. '14-day full refund if you ask.'
  }),
  author: Object.freeze({ name: null, role: null }),
  review: Object.freeze({
    reviewerName: null,
    reviewerRole: null,
    qualification: null,
    qualificationVerifiedBy: null,
    scope: null,
    reviewedVersion: null,
    approvedAt: null, // YYYY-MM-DD
    evidence: null, // where the signed review is kept
  }),
  sample: Object.freeze({ route: 'standard', sessionKey: 'w1s1' }),
});

export const PROGRAMMES = Object.freeze({ hang4: HANG4 });
