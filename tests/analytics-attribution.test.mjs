import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

// Runs the exact inline script shipped in Analytics.astro against a stub browser.
const source = await fs.readFile(new URL("../src/components/Analytics.astro", import.meta.url), "utf8");
const code = source.slice(source.indexOf("<script is:inline>") + "<script is:inline>".length, source.lastIndexOf("</script>"));

function page({
  href = "https://deadhangs.com/dead-hang-time-by-age/",
  referrer = "",
  consent = null,
  canonical = "https://deadhangs.com/dead-hang-time-by-age/",
} = {}) {
  const url = new URL(href);
  const listeners = {};
  const store = new Map(consent ? [["cookieConsent", consent]] : []);
  const appended = [];
  const cookieWrites = [];
  const ctx = {
    URL,
    URLSearchParams,
    Date,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
    location: { href, origin: url.origin, pathname: url.pathname, search: url.search, hostname: url.hostname },
    document: {
      referrer,
      querySelector: (sel) => (sel === 'link[rel="canonical"]' && canonical ? { href: canonical } : null),
      createElement: () => ({}),
      head: { appendChild: (el) => appended.push(el) },
      get cookie() {
        return "_ga=GA1.1.1; _ga_YBPRQVR2Y3=GS1; other=keep";
      },
      set cookie(value) {
        cookieWrites.push(value);
      },
    },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    dispatchEvent: (event) => (listeners[event.type] || []).forEach((fn) => fn(event)),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const calls = () => (ctx.dataLayer || []).map((args) => Array.from(args));
  return {
    ctx,
    appended,
    cookieWrites,
    calls,
    configs: () => calls().filter((c) => c[0] === "config").map((c) => c[2]),
    choose(choice) {
      store.set("cookieConsent", choice);
      ctx.dispatchEvent(new ctx.CustomEvent("deadhangs:consent", { detail: choice }));
    },
  };
}

const configFor = (opts) => {
  const p = page({ consent: "accepted", ...opts });
  const configs = p.configs();
  assert.equal(configs.length, 1);
  return configs[0];
};

test("nothing loads or queues before consent", () => {
  for (const consent of [null, "declined"]) {
    const p = page({ consent, referrer: "https://www.google.com/", href: "https://deadhangs.com/?utm_source=reddit&utm_medium=social" });
    assert.equal(p.ctx.dataLayer, undefined);
    assert.equal(typeof p.ctx.gtag, "undefined");
    assert.equal(p.appended.length, 0);
  }
});

test("genuine search and external referrers become an origin only", () => {
  assert.equal(configFor({ referrer: "https://www.google.com/" }).page_referrer, "https://www.google.com/");
  assert.equal(configFor({ referrer: "https://www.google.co.uk/search?q=dead+hang+45+seconds" }).page_referrer, "https://www.google.co.uk/");
  assert.equal(configFor({ referrer: "https://www.bing.com/search?q=dead+hang+age&form=QBLH" }).page_referrer, "https://www.bing.com/");
  assert.equal(
    configFor({ referrer: "https://user:secret@forum.example.org/t/my-hang-45s?email=a%40b.com#post-9" }).page_referrer,
    "https://forum.example.org/",
  );
});

test("page_location is the canonical path with no query, hash or hold", () => {
  const c = configFor({ href: "https://deadhangs.com/training-log/?hold=45&measured=1#x", canonical: "https://deadhangs.com/training-log/?a=1#b" });
  assert.equal(c.page_location, "https://deadhangs.com/training-log/");
  const fallback = configFor({ href: "https://deadhangs.com/training-log/?hold=45", canonical: null });
  assert.equal(fallback.page_location, "https://deadhangs.com/training-log/");
});

test("same-site, preview and hostile referrers never become acquisition", () => {
  const cases = [
    ["https://deadhangs.com/training-log/?hold=31", "https://deadhangs.com/dead-hang-time-by-age/"],
    ["https://www.deadhangs.com/x/", "https://deadhangs.com/dead-hang-time-by-age/"],
    ["https://cdn.deadhangs.com/", "https://deadhangs.com/dead-hang-time-by-age/"],
    ["https://abc.deadhangs-com-bew.pages.dev/x/?hold=3", "https://abc.deadhangs-com-bew.pages.dev/dead-hang-time-by-age/"],
    ["javascript:alert(1)", undefined],
    ["data:text/html,hi", undefined],
    ["file:///C:/secret.txt", undefined],
    ["not a url", undefined],
    ["", undefined],
    [`https://${"a".repeat(130)}.example.com/`, undefined],
  ];
  for (const [referrer, href] of cases) {
    const c = configFor({ referrer, ...(href ? { href } : {}) });
    assert.ok(Object.hasOwn(c, "page_referrer"), referrer);
    assert.equal(c.page_referrer, "", referrer);
  }
});

test("only a complete, validated utm source and medium set is used", () => {
  const ok = configFor({ canonical: "https://deadhangs.com/", href: "https://deadhangs.com/?utm_source=Reddit&utm_medium=social&utm_campaign=bf-2026&gclid=abc123&utm_term=45+seconds" });
  assert.equal(ok.campaign_source, "reddit");
  assert.equal(ok.campaign_medium, "social");
  assert.equal(ok.campaign_name, "bf-2026");
  assert.equal(ok.page_location, "https://deadhangs.com/");
  assert.ok(!("campaign_term" in ok) && !("campaign_id" in ok));
  const sourceOnly = configFor({ href: "https://deadhangs.com/?utm_source=t.co&utm_medium=referral" });
  assert.equal(sourceOnly.campaign_source, "t.co");
  assert.ok(!("campaign_name" in sourceOnly));
});

test("hostile, personal or numeric campaign values are refused whole", () => {
  const bad = [
    "?utm_source=john.smith&utm_medium=email",
    "?utm_source=mary-smith&utm_medium=social",
    "?utm_source=reddit&utm_medium=social&utm_campaign=cohort-alice",
    "?utm_source=john%40example.com&utm_medium=email",
    "?utm_source=reddit&utm_medium=made-up",
    "?utm_source=reddit",
    "?utm_medium=social",
    "?utm_source=1234&utm_medium=social",
    "?utm_source=reddit&utm_medium=social&utm_campaign=hold-45s",
    "?utm_source=reddit&utm_medium=social&utm_campaign=age-52",
    "?utm_source=reddit&utm_medium=social&utm_campaign=8f3a9c2e7b1d4f60",
    "?utm_source=reddit&utm_medium=social&utm_campaign=",
    "?utm_source=reddit&utm_source=x&utm_medium=social",
    "?utm_source=%3Cscript%3E&utm_medium=social",
    "?utm_source=reddit&utm_medium=constructor",
    `?utm_source=${"a".repeat(41)}&utm_medium=social`,
  ];
  for (const search of bad) {
    const c = configFor({ href: `https://deadhangs.com/${search}` });
    assert.ok(!Object.keys(c).some((k) => k.startsWith("campaign_")), search);
  }
});

test("consent given later on the landing page still carries the safe referrer", () => {
  const p = page({ referrer: "https://www.google.com/search?q=x", href: "https://deadhangs.com/?utm_source=reddit&utm_medium=social" });
  assert.equal(p.configs().length, 0);
  p.choose("accepted");
  assert.deepEqual(JSON.parse(JSON.stringify(p.configs())), [{
    page_location: "https://deadhangs.com/dead-hang-time-by-age/",
    page_referrer: "https://www.google.com/",
    campaign_source: "reddit",
    campaign_medium: "social",
  }]);
  assert.equal(p.appended.length, 1);
});

test("revoke disables and clears GA cookies; re-accept re-enables without a second config", () => {
  const p = page({ consent: "accepted", referrer: "https://www.bing.com/" });
  assert.equal(p.ctx["ga-disable-G-YBPRQVR2Y3"], false);
  p.choose("declined");
  assert.equal(p.ctx["ga-disable-G-YBPRQVR2Y3"], true);
  assert.ok(p.cookieWrites.some((w) => w.startsWith("_ga=;max-age=0")));
  assert.ok(p.cookieWrites.some((w) => w.startsWith("_ga_YBPRQVR2Y3=;max-age=0")));
  assert.ok(!p.cookieWrites.some((w) => w.startsWith("other=")));
  p.choose("accepted");
  assert.equal(p.ctx["ga-disable-G-YBPRQVR2Y3"], false);
  assert.equal(p.configs().length, 1);
  assert.equal(p.appended.length, 1);
});

test("no referrer path, query, training value or full URL reaches the data layer", () => {
  const p = page({
    consent: "accepted",
    referrer: "https://forum.example.org/thread?hold=45&age=52&email=a%40b.com",
    href: "https://deadhangs.com/training-log/?hold=45&measured=1&session=level-2&utm_source=reddit&utm_medium=social",
    canonical: "https://deadhangs.com/training-log/",
  });
  const text = JSON.stringify(p.calls().filter((c) => c[0] !== "js"));
  for (const leaked of ["hold", "45", "age=", "52", "email", "thread", "measured", "level-2", "?"]) {
    assert.ok(!text.includes(leaked), leaked);
  }
});
