import { useEffect, useState } from "react";
import { enquiryBody, gymErrorMessage } from "../lib/gym-client.mjs";
import { jsonBody, programmeRequest } from "../lib/programme-client.mjs";
import { trackTrainingEvent } from "../scripts/training-events.js";

/** Public enquiry form. Success is shown only after the server confirms the write. */
export default function GymEnquiry() {
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState({ gymName: "", contactName: "", email: "", location: "", members: "", message: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setHydrated(true), []);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const checked = enquiryBody({ ...form, consent });
    if (checked.error) { setError(checked.error); return; }
    setBusy(true);
    try {
      const data: any = await programmeRequest("/api/gym/enquiry", jsonBody("POST", checked.body));
      if (data.saved === true) {
        trackTrainingEvent("gym_pilot_requested", { source: "gym_page" });
        setDone(true);
      } else setError("That did not save. Nothing was recorded. Try again.");
    } catch (e: any) {
      setError(e.status === 404 ? "The pilot is not open yet. Nothing was saved." : gymErrorMessage(e));
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="prg-card" role="status" aria-live="polite">
        <h2 style={{ fontSize: "1.3rem", margin: 0 }}>Thank you, your enquiry is saved.</h2>
        <p>I will reply by email about a gym challenge pilot. Nothing has been built or charged.</p>
      </div>
    );
  }
  return (
    <form className="prg-card prg-form" onSubmit={submit} noValidate aria-labelledby="gym-form-title">
      <h2 id="gym-form-title" style={{ fontSize: "1.3rem", margin: 0 }}>Ask about a pilot</h2>
      <div className="prg-field">
        <label htmlFor="gym-name">Gym name</label>
        <input id="gym-name" type="text" autoComplete="organization" required maxLength={120} disabled={!hydrated || busy} value={form.gymName} onChange={set("gymName")} />
      </div>
      <div className="prg-field">
        <label htmlFor="gym-contact">Your name</label>
        <input id="gym-contact" type="text" autoComplete="name" required maxLength={120} disabled={!hydrated || busy} value={form.contactName} onChange={set("contactName")} />
      </div>
      <div className="prg-field">
        <label htmlFor="gym-email">Email</label>
        <input id="gym-email" type="email" inputMode="email" autoComplete="email" required maxLength={254} disabled={!hydrated || busy} value={form.email} onChange={set("email")} />
      </div>
      <div className="prg-field">
        <label htmlFor="gym-location">Town or city <span className="prg-hint">(optional)</span></label>
        <input id="gym-location" type="text" autoComplete="address-level2" maxLength={120} disabled={!hydrated || busy} value={form.location} onChange={set("location")} />
      </div>
      <div className="prg-field">
        <label htmlFor="gym-members">Rough member count <span className="prg-hint">(optional)</span></label>
        <input id="gym-members" type="text" inputMode="numeric" maxLength={40} disabled={!hydrated || busy} value={form.members} onChange={set("members")} />
      </div>
      <div className="prg-field">
        <label htmlFor="gym-message">Message <span className="prg-hint">(optional)</span></label>
        <textarea id="gym-message" maxLength={1000} disabled={!hydrated || busy} value={form.message} onChange={set("message")} />
      </div>
      <div className="prg-hp" aria-hidden="true">
        <label htmlFor="gym-website">Leave this field empty</label>
        <input id="gym-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>
      <label className="prg-check" htmlFor="gym-consent">
        <input id="gym-consent" type="checkbox" required disabled={!hydrated || busy} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Contact me about a gym challenge pilot. Nothing else.</span>
      </label>
      <button type="submit" className="prg-btn" disabled={!hydrated || busy}>Send enquiry</button>
      <div className="prg-live" role="status" aria-live="polite" />
      {error && <p className="prg-msg is-error" role="alert">{error}</p>}
    </form>
  );
}
