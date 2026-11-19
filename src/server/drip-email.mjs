import { TIMER_PRESETS } from '../lib/timer-preset.mjs';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function dripLink(path, origin, step) {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries({ utm_source: 'email', utm_medium: 'email', utm_campaign: 'e2', utm_content: 'step' + step })) url.searchParams.set(key, value);
  return url.href;
}

/** The E2 series. Compliance headers and footer are added at delivery. */
export function dripEmail(origin, step) {
  if (step !== 0 && step !== 1) throw new Error('Invalid drip step');
  const link = (path) => dripLink(path, origin, step);
  const timer = link(TIMER_PRESETS.find((preset) => preset.name === 'Level 1 session').path);
  const pro = link('/pro/');
  const subject = step === 0 ? 'Your next hang session' : 'Take your training log with you';
  const preview = step === 0 ? 'Open the free timer and make time for your next session.' : 'Pro keeps your cloud history ready across devices.';
  const paragraphs = step === 0 ? [
    'Ready for your next session?',
    'The free Level 1 timer is set for three 15 second hangs, with 90 seconds of rest between hangs and five seconds to get ready.',
    'Use a secure bar. Keep your feet close to the floor so you can step down. Stop if you feel pain. Shorten the holds or keep your feet supported if you need to.',
    'Open the free Level 1 timer: ' + timer,
    'When you reach four weeks from your first test, re-test using the same setup. Log the result so you can compare it with your first hold.',
    'Sunny',
  ] : [
    'Want your training history on another device?',
    'Pro lets you merge your device log into your account after Google sign-in. It stores up to 200 cloud entries. Sync is manual. On another device, sign in with the same Google account and copy your cloud log. Compare your progress history by date.',
    'The timer and your local training log stay free.',
    'Pro costs GBP 4.99 a month or GBP 39 a year. Cancel any time from the billing portal in your account.',
    'See what Pro includes: ' + pro,
    'Sunny',
  ];
  const actionIndex = step === 0 ? 3 : 4;
  const actionUrl = step === 0 ? timer : pro;
  const actionLabel = step === 0 ? 'Open the free Level 1 timer' : 'See what Pro includes';
  return {
    subject, preview,
    bodyText: paragraphs.join('\n\n'),
    bodyHtml: `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>` + paragraphs.map((p, index) => index === actionIndex
      ? `<p><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionLabel)}</a></p>`
      : `<p>${escapeHtml(p)}</p>`).join('\n'),
  };
}
