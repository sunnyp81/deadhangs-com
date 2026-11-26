import { useEffect, useRef, useState } from "react";
import { AccountError, accountRequest, signInBody, trustedRedirect } from "../lib/account-client.mjs";
import { PROGRAMME_ID, PROGRAMME_PRICE_LABEL, jsonBody, programmeErrorMessage, programmeRequest, requestCheckout } from "../lib/programme-client.mjs";
import { trackTrainingEvent } from "../scripts/training-events.js";

type Availability = { open: boolean; test: boolean };

/** The sales page action. Server-rendered closed (interest form); upgrades to Buy only when availability says open. */
export default function ProgrammeOffer() {
  const [hydrated, setHydrated] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ open: false, test: false });
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const viewed = useRef(false);

  useEffect(() => {
    setHydrated(true);
    if (!viewed.current) {
      viewed.current = true;
      trackTrainingEvent("programme_viewed", { source: "programme_page" });
    }
    let live = true;
    programmeRequest(`/api/programme/availability?programme=${PROGRAMME_ID}`)
      .then((data: any) => { if (live && data && data.open === true) setAvailability({ open: true, test: data.test === true }); })
      .catch(() => { /* stays closed */ });
    return () => { live = false; };
  }, []);

  async function submitInterest(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setMessage("");
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (!consent) { setError("Tick the box to say you want the one email."); return; }
    setBusy(true);
    try {
      const data: any = await programmeRequest("/api/programme/interest", jsonBody("POST", { email: email.trim(), programme: PROGRAMME_ID, consent: true, website, source: "programme_page" }));
      if (data.saved === true) {
        trackTrainingEvent("programme_interest_submitted", { source: "programme_page" });
        setMessage(data.existing ? "You were already on the list. You will get one email when the programme opens." : "You are on the list. You will get one email when the programme opens, and nothing else.");
        setEmail(""); setConsent(false);
      } else setError("That did not save. Nothing was recorded. Try again.");
    } catch (e: any) {
      if (e.status === 503) setError("The sign-up is not available right now. Nothing was saved.");
      else if (e.code === "invalid_email") setError("That email address does not look right. Check it and try again.");
      else if (e.code === "consent_required") setError("Tick the box to say you want the one email.");
      else if (e.code === "network") setError("Could not reach the server. Nothing was saved. Try again.");
      else setError("That did not save. Nothing was recorded. Refresh the page and try again.");
    } finally { setBusy(false); }
  }

  async function buy() {
    if (busy) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      let account: any;
      try { account = await accountRequest("/api/account"); } catch (e: any) {
        if (e.status === 401) {
          const result: any = await programmeRequest("/api/auth/sign-in/social", jsonBody("POST", signInBody(false, "/programme/app/?buy=1")));
          window.location.assign(trustedRedirect(result.url, "google"));
          return;
        }
        throw e;
      }
      const url = await requestCheckout(account.accountKey, "programme_page");
      trackTrainingEvent("programme_checkout_started", { source: "programme_page" });
      window.location.assign(url);
      return;
    } catch (e: any) {
      setError(e instanceof AccountError || e?.code ? programmeErrorMessage(e) : "That could not be started. Nothing was charged.");
    }
    setBusy(false);
  }

  const price = PROGRAMME_PRICE_LABEL;
  if (availability.open) {
    return (
      <div className="prg-card" aria-labelledby="prg-action-title">
        <h2 id="prg-action-title" style={{ fontSize: "1.3rem" }}>Buy the programme</h2>
        {availability.test && <p className="prg-msg is-note">Checkout is in test mode, so no real payment is taken.</p>}
        <p className="prg-small">Sign in with Google first if you are not already. {price}, one payment, no subscription.</p>
        <div className="prg-actions"><button type="button" className="prg-btn" onClick={buy} disabled={!hydrated || busy}>Buy for {price}</button></div>
        <div className="prg-live" role="status" aria-live="polite">{message}</div>
        {error && <p className="prg-msg is-error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <form className="prg-card prg-form" onSubmit={submitInterest} noValidate aria-labelledby="prg-action-title">
      <h2 id="prg-action-title" style={{ fontSize: "1.3rem", margin: 0 }}>Hear when it opens</h2>
      <p className="prg-status" style={{ margin: 0 }}>Not on sale yet. It opens after a qualified fitness professional has checked it.</p>
      <div className="prg-field">
        <label htmlFor="prg-email">Your email</label>
        <input id="prg-email" type="email" name="email" inputMode="email" autoComplete="email" required disabled={!hydrated || busy} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="prg-hp" aria-hidden="true">
        <label htmlFor="prg-website">Leave this field empty</label>
        <input id="prg-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <label className="prg-check" htmlFor="prg-consent">
        <input id="prg-consent" type="checkbox" required disabled={!hydrated || busy} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Email me once when this programme opens. Nothing else, and no newsletter.</span>
      </label>
      <button type="submit" className="prg-btn" disabled={!hydrated || busy}>Email me when it opens</button>
      <div className="prg-live" role="status" aria-live="polite">{message}</div>
      {error && <p className="prg-msg is-error" role="alert">{error}</p>}
    </form>
  );
}
