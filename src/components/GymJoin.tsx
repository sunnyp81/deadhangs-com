import { useEffect, useRef, useState } from "react";
import { signInBody, trustedRedirect } from "../lib/account-client.mjs";
import { DISPLAY_NAME_MAX, campaignPath, gymErrorMessage, inviteTokenFrom, joinPath, validateJoin } from "../lib/gym-client.mjs";
import { jsonBody, programmeRequest, withKey } from "../lib/programme-client.mjs";
import "../styles/programme.css";
import "../styles/gym.css";

type Phase = "loading" | "noinvite" | "signedout" | "ready" | "unavailable" | "error";

/** Join a private gym challenge from an invite link. The invite token stays in the address bar only; nothing is stored in the browser. */
export default function GymJoin() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [token, setToken] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [showOnBoard, setShowOnBoard] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = inviteTokenFrom(window.location.search);
    if (!t) { setPhase("noinvite"); return; }
    setToken(t);
    programmeRequest("/api/account")
      .then((account: any) => { setKey(account.accountKey); setPhase("ready"); })
      .catch((e: any) => {
        if (e.status === 401) setPhase("signedout");
        else if (e.status === 404 || e.status === 503) setPhase("unavailable");
        else { setError(gymErrorMessage(e)); setPhase("error"); }
      });
  }, []);

  async function signIn() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result: any = await programmeRequest("/api/auth/sign-in/social", jsonBody("POST", signInBody(false, joinPath(token))));
      window.location.assign(trustedRedirect(result.url, "google"));
    } catch (e: any) { setError(gymErrorMessage(e)); setBusy(false); }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const checked = validateJoin({ displayName: name, shareConsent: consent });
    if (checked.error) { setError(checked.error); return; }
    setBusy(true);
    try {
      const res: any = await programmeRequest("/api/gym/join", withKey(key, jsonBody("POST", { token, displayName: checked.name, showOnBoard, shareConsent: true })));
      window.location.assign(campaignPath(res.campaignId));
      return;
    } catch (e: any) {
      if (e.status === 401) setPhase("signedout");
      else setError(gymErrorMessage(e));
    }
    setBusy(false);
  }

  if (phase === "loading") return <div className="prg-card gym-skeleton" aria-busy="true"><p>Loading.</p></div>;
  if (phase === "noinvite") {
    return (
      <div className="prg-card">
        <h2 style={{ margin: 0 }}>This page needs an invite link</h2>
        <p>Ask the gym organiser for the join link or scan the poster. A link that was cut short will not work.</p>
      </div>
    );
  }
  if (phase === "unavailable") {
    return <div className="prg-card"><h2 style={{ margin: 0 }}>Not available</h2><p>The gym challenge is not available right now. Nothing was changed.</p></div>;
  }
  if (phase === "error") {
    return <div className="prg-card"><h2 style={{ margin: 0 }}>Could not load this page</h2><p>{error || "Nothing was changed."}</p></div>;
  }
  if (phase === "signedout") {
    return (
      <div className="prg-card prg-stack">
        <h2 style={{ margin: 0 }}>Sign in to join the challenge</h2>
        <p>Signing in is free. It keeps your results on your account. You choose what the gym can see on the next step.</p>
        <div className="prg-actions"><button type="button" className="prg-btn prg-btn-google" disabled={busy} onClick={signIn}>Sign in with Google</button></div>
        <p className="prg-small">By continuing, you agree to the <a href="/terms/">terms</a> and acknowledge the <a href="/privacy/">privacy policy</a>.</p>
        {error && <p className="prg-msg is-error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <form className="prg-card prg-form" onSubmit={join} noValidate aria-labelledby="gym-join-title">
      <h2 id="gym-join-title" style={{ margin: 0 }}>Join the challenge</h2>
      <p style={{ margin: 0 }}>The organiser sees the results you record in this challenge. Nobody else does unless you choose to show your best result on the gym board. You can leave at any time.</p>
      <div className="prg-field">
        <label htmlFor="gym-display">Display name <span className="prg-hint">(up to {DISPLAY_NAME_MAX} characters)</span></label>
        <input id="gym-display" type="text" maxLength={DISPLAY_NAME_MAX} autoComplete="nickname" required disabled={busy} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <label className="prg-check" htmlFor="gym-board">
        <input id="gym-board" type="checkbox" disabled={busy} checked={showOnBoard} onChange={(e) => setShowOnBoard(e.target.checked)} />
        <span>Show my best result on the gym board</span>
      </label>
      <label className="prg-check" htmlFor="gym-share">
        <input id="gym-share" type="checkbox" required disabled={busy} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Share my results in this challenge with the organiser</span>
      </label>
      <button type="submit" className="prg-btn" disabled={busy}>Join</button>
      {error && <p className="prg-msg is-error" role="alert">{error}</p>}
    </form>
  );
}
