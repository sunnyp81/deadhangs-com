import { useEffect, useRef, useState } from "react";
import { signInBody, trustedRedirect } from "../lib/account-client.mjs";
import {
  campaignIdFrom, campaignPath, correctionInput, effectiveSeconds, formatDay, gymErrorMessage, gymShouldRefetch, joinUrl, parseSeconds, rankBoard, resultDateBounds, ruleLines,
} from "../lib/gym-client.mjs";
import { jsonBody, newResultId, programmeRequest, withKey } from "../lib/programme-client.mjs";
import { toLocalDateString } from "../lib/training-log.mjs";
import "../styles/programme.css";
import "../styles/gym.css";

type Phase = "loading" | "noid" | "signedout" | "notfound" | "unavailable" | "error" | "ready" | "left";

function RuleBlock({ rule }: { rule: any }) {
  const { lines, note } = ruleLines(rule);
  return (
    <div>
      <ul className="gym-rule">
        {lines.map((l: any) => <li key={l.label}><span className="gym-rule-label">{l.label}</span> {l.value}</li>)}
      </ul>
      {note && <p className="prg-small" style={{ marginTop: 6 }}>{note}</p>}
    </div>
  );
}

function ConfirmRow({ label, yes, no, busy, onYes, onNo }: { label: string; yes: string; no: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="prg-confirm" role="group" aria-label={label}>
      <p style={{ margin: "0 0 10px" }}>{label}</p>
      <div className="prg-actions">
        <button type="button" className="prg-btn" disabled={busy} onClick={onYes}>{yes}</button>
        <button type="button" className="prg-btn-quiet" disabled={busy} onClick={onNo}>{no}</button>
      </div>
    </div>
  );
}

function AddResult({ campaign, busy, onSave }: { campaign: any; busy: boolean; onSave: (body: any) => Promise<boolean> }) {
  const today = toLocalDateString();
  const bounds = resultDateBounds(campaign, today);
  const [id, setId] = useState(() => newResultId());
  const [seconds, setSeconds] = useState("");
  const [date, setDate] = useState(bounds.value);
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState("");
  if (!bounds.open) return <p className="prg-msg is-note">This challenge starts on {formatDay(campaign.startsOn)}. You can add results from then.</p>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem("");
    const n = parseSeconds(seconds);
    if (n === null) { setProblem("Enter whole seconds from 1 to 3600."); return; }
    if (date < bounds.min || date > bounds.max) { setProblem(`Choose a date from ${formatDay(bounds.min)} to ${formatDay(bounds.max)}.`); return; }
    if (!confirmed) { setProblem("Tick the box to say you followed the rule above."); return; }
    // The same client id is sent again on a retry, so a dropped connection cannot save the result twice.
    const ok = await onSave({ campaignId: campaign.id, id, seconds: n, localDate: date, ruleConfirmed: true });
    if (ok) { setId(newResultId()); setSeconds(""); setConfirmed(false); }
  }
  return (
    <form className="prg-form" onSubmit={submit} noValidate aria-labelledby="gym-add-title">
      <h3 id="gym-add-title" style={{ margin: 0 }}>Add a result</h3>
      <div className="gym-two">
        <div className="prg-field">
          <label htmlFor="gym-seconds">Hold time, seconds</label>
          <input id="gym-seconds" className="prg-num" type="text" inputMode="numeric" autoComplete="off" disabled={busy} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        </div>
        <div className="prg-field">
          <label htmlFor="gym-date">Date</label>
          <input id="gym-date" type="date" min={bounds.min} max={bounds.max} disabled={busy} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label className="prg-check" htmlFor="gym-rule-ok">
        <input id="gym-rule-ok" type="checkbox" disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I followed the rule above</span>
      </label>
      <div className="prg-actions"><button type="submit" className="prg-btn" disabled={busy}>Save result</button></div>
      {problem && <p className="prg-msg is-error" role="alert">{problem}</p>}
    </form>
  );
}

function Organiser({ data, busy, act }: { data: any; busy: boolean; act: (body: any, ok?: string) => Promise<any> }) {
  const campaign = data.campaign;
  const manage = data.manage;
  const [invite, setInvite] = useState<{ url: string; qr: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [editing, setEditing] = useState("");
  const [secondsText, setSecondsText] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [confirming, setConfirming] = useState("");
  const closed = campaign.status !== "active";

  async function createInvite() {
    setCopied("");
    const res = await act({ campaignId: campaign.id, op: "invite" });
    if (!res || typeof res.token !== "string") return;
    const url = joinUrl(window.location.origin, res.token);
    let qr = "";
    try {
      // @ts-ignore qrcode ships no type declarations
      const QR: any = await import("qrcode");
      qr = await (QR.default || QR).toDataURL(url, { margin: 2, width: 320, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
    } catch { /* the link still works without the picture */ }
    setInvite({ url, qr });
  }
  async function copy() {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite.url); setCopied("Link copied."); } catch { setCopied("Copying was blocked. Select the link and copy it."); }
  }
  function startEdit(row: any) { setEditing(row.id); setConfirming(""); setProblem(""); setSecondsText(String(effectiveSeconds(row))); setNote(""); }
  async function saveCorrection(row: any) {
    const checked = correctionInput(secondsText, note);
    if (checked.error) { setProblem(checked.error); return; }
    setProblem("");
    const res = await act({ campaignId: campaign.id, op: "correct", resultId: row.id, seconds: checked.seconds, note: checked.note }, "Correction saved.");
    if (res) setEditing("");
  }
  async function confirmed(body: any, ok: string) { const res = await act({ campaignId: campaign.id, ...body }, ok); if (res) setConfirming(""); }

  return (
    <>
    <section className="prg-section gym-screen" aria-labelledby="gym-org-title">
      <h2 id="gym-org-title">Organiser</h2>

      <div className="prg-card prg-stack">
        <h3>Invite participants</h3>
        <p className="prg-small">Each invite is one link and QR code for the whole gym. It works for 60 days or until you revoke it.</p>
        <div className="prg-actions">
          <button type="button" className="prg-btn" disabled={busy || closed} onClick={createInvite}>Create participant invite</button>
          <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => setConfirming("revoke")}>Revoke all invites</button>
        </div>
        {confirming === "revoke" && <ConfirmRow label="Revoke every participant invite? Links and posters already shared stop working. People who have joined stay in." yes="Revoke invites" no="Keep invites" busy={busy} onYes={() => confirmed({ op: "revoke_invites" }, "All participant invites revoked.")} onNo={() => setConfirming("")} />}
        {invite && (
          <div className="gym-invite">
            <p className="prg-small" style={{ margin: 0 }}>Shown once. Copy it now or print the poster. Create another invite if you need it again.</p>
            <div className="prg-field">
              <label htmlFor="gym-invite-url">Join link</label>
              <input id="gym-invite-url" type="text" readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <div className="prg-actions">
              <button type="button" className="prg-btn-quiet" onClick={copy}>Copy link</button>
              <button type="button" className="prg-btn-quiet" onClick={() => window.print()}>Print a poster</button>
            </div>
            <div className="prg-live" role="status" aria-live="polite">{copied}</div>
            {invite.qr && <img className="gym-qr" src={invite.qr} width={200} height={200} alt="QR code that opens the join link" />}
          </div>
        )}
      </div>

      <div className="prg-card prg-stack" style={{ marginTop: 20 }}>
        <h3>Gym board</h3>
        <p className="prg-small">Currently visible to: <strong>{campaign.boardVisibility === "members" ? "all members" : "you only"}</strong>. Members appear only if they chose to show their best result.</p>
        <div className="prg-actions">
          {campaign.boardVisibility === "members"
            ? <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => act({ campaignId: campaign.id, op: "board", boardVisibility: "organiser" }, "The board is now visible to you only.")}>Show the board to me only</button>
            : <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => act({ campaignId: campaign.id, op: "board", boardVisibility: "members" }, "The board is now visible to members.")}>Show the board to members</button>}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>All results</h3>
        {manage.results.length === 0 ? <p>No results yet.</p> : (
          <div className="prg-table-wrap">
            <table>
              <caption className="prg-visually-hidden">All results in this challenge, self-reported</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Date</th><th scope="col">Seconds</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {manage.results.map((row: any) => {
                  const removed = row.status !== "active";
                  return (
                    <tr key={row.id}>
                      <th scope="row">{row.display_name}</th>
                      <td>{formatDay(row.local_date)}</td>
                      <td className="prg-num">{effectiveSeconds(row)}{row.corrected_seconds != null && <span className="prg-small"> (reported {row.seconds})</span>}{row.correction_note && <div className="prg-small">{row.correction_note}</div>}</td>
                      <td>{removed ? "Removed" : row.corrected_seconds != null ? "Corrected" : "Self-reported"}</td>
                      <td>
                        {!removed && editing !== row.id && confirming !== `r:${row.id}` && (
                          <div className="prg-actions">
                            <button type="button" className="prg-btn-quiet gym-small" disabled={busy} onClick={() => startEdit(row)}>Correct</button>
                            <button type="button" className="prg-btn-quiet gym-small" disabled={busy} onClick={() => { setConfirming(`r:${row.id}`); setEditing(""); }}>Remove</button>
                          </div>
                        )}
                        {editing === row.id && (
                          <div className="prg-form">
                            <div className="prg-field"><label htmlFor={`c-s-${row.id}`}>Corrected seconds</label><input id={`c-s-${row.id}`} className="prg-num" type="text" inputMode="numeric" value={secondsText} disabled={busy} onChange={(e) => setSecondsText(e.target.value)} /></div>
                            <div className="prg-field"><label htmlFor={`c-n-${row.id}`}>Note (required)</label><input id={`c-n-${row.id}`} type="text" maxLength={200} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} /></div>
                            {problem && <p className="prg-msg is-error" role="alert">{problem}</p>}
                            <div className="prg-actions">
                              <button type="button" className="prg-btn gym-small" disabled={busy} onClick={() => saveCorrection(row)}>Save correction</button>
                              <button type="button" className="prg-btn-quiet gym-small" disabled={busy} onClick={() => { setEditing(""); setProblem(""); }}>Cancel</button>
                            </div>
                          </div>
                        )}
                        {confirming === `r:${row.id}` && <ConfirmRow label="Remove this result from the challenge?" yes="Remove result" no="Keep it" busy={busy} onYes={() => confirmed({ op: "remove_result", resultId: row.id }, "Result removed.")} onNo={() => setConfirming("")} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="prg-small">Results are self-reported. Nobody has checked any hold.</p>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Members</h3>
        <div className="prg-table-wrap">
          <table>
            <caption className="prg-visually-hidden">Members of this challenge</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">On the board</th><th scope="col">Joined</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {manage.members.map((m: any) => (
                <tr key={m.memberRef}>
                  <th scope="row">{m.display_name}</th>
                  <td>{m.role === "organiser" ? "Organiser" : "Participant"}</td>
                  <td>{m.show_on_board ? "Yes" : "No"}</td>
                  <td>{formatDay(new Date(m.joined_at * 1000).toISOString().slice(0, 10))}</td>
                  <td>
                    {m.role !== "organiser" && confirming !== `m:${m.memberRef}` && <button type="button" className="prg-btn-quiet gym-small" disabled={busy} onClick={() => setConfirming(`m:${m.memberRef}`)}>Remove</button>}
                    {confirming === `m:${m.memberRef}` && <ConfirmRow label="Remove this member? They stop appearing in the challenge and cannot rejoin." yes="Remove member" no="Keep member" busy={busy} onYes={() => confirmed({ op: "remove_member", memberRef: m.memberRef }, "Member removed.")} onNo={() => setConfirming("")} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="prg-actions" style={{ marginTop: 20 }}>
        <a className="prg-btn-quiet" href={`/api/gym/export?id=${encodeURIComponent(campaign.id)}`} download>Export CSV</a>
        {!closed && <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => setConfirming("close")}>Close challenge</button>}
      </div>
      {confirming === "close" && <ConfirmRow label="Close this challenge? Joining and new results stop and invites are revoked. Export your results first if you need them." yes="Close challenge" no="Keep it open" busy={busy} onYes={() => confirmed({ op: "close" }, "The challenge is closed.")} onNo={() => setConfirming("")} />}

    </section>
      {invite && (
        <div className="gym-poster" aria-hidden="true">
          <p className="gym-poster-kicker">{campaign.gymName}</p>
          <h2>{campaign.title}</h2>
          <p className="gym-poster-dates">{formatDay(campaign.startsOn)} to {formatDay(campaign.endsOn)}</p>
          <p className="gym-poster-scan">Scan to join. Record one hold. Everyone follows the same rule.</p>
          {invite.qr && <img src={invite.qr} width={320} height={320} alt="" />}
          <div className="gym-poster-rule"><RuleBlock rule={campaign.rule} /></div>
          <p>Results are self-reported. The organiser sees your results. Other members see your best only if you choose.</p>
          <p>Stop if you feel sharp pain, numbness, light-headedness or a pinching shoulder.</p>
        </div>
      )}
    </>
  );
}

/** Private campaign page: member view, board and organiser tools. Server data only; nothing is stored in the browser. */
export default function GymCampaign() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [id, setId] = useState("");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const generation = useRef(0);
  const key: string = data?.accountKey || "";

  async function load(campaignId: string): Promise<any> {
    const run = ++generation.current;
    try {
      const next: any = await programmeRequest(`/api/gym/campaign?id=${encodeURIComponent(campaignId)}`);
      if (run !== generation.current) return null;
      setData(next); setPhase("ready");
      return next;
    } catch (e: any) {
      if (run !== generation.current) return null;
      setData(null);
      if (e.status === 401) setPhase("signedout");
      else if (e.status === 404) setPhase("notfound");
      else if (e.status === 503) setPhase("unavailable");
      else { setError(gymErrorMessage(e)); setPhase("error"); }
      return null;
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const found = campaignIdFrom(window.location.search);
    if (!found) { setPhase("noid"); return; }
    setId(found);
    load(found);
    return () => { generation.current += 1; };
  }, []);

  /** One guarded request. Returns the response, or null after showing a plain message. */
  async function send(path: string, body: any, ok = ""): Promise<any> {
    if (busy) return null;
    setBusy(true); setError(""); setNotice("");
    try {
      const res: any = await programmeRequest(path, withKey(key, jsonBody("POST", body)));
      if (ok) setNotice(ok);
      await load(id);
      return res;
    } catch (e: any) {
      if (e.status === 401) { generation.current += 1; setData(null); setPhase("signedout"); }
      else {
        setError(gymErrorMessage(e));
        if (gymShouldRefetch(e)) await load(id);
      }
      return null;
    } finally { setBusy(false); }
  }

  async function signIn() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result: any = await programmeRequest("/api/auth/sign-in/social", jsonBody("POST", signInBody(false, campaignPath(id))));
      window.location.assign(trustedRedirect(result.url, "google"));
    } catch (e: any) { setError(gymErrorMessage(e)); setBusy(false); }
  }

  async function addResult(body: any): Promise<boolean> {
    const res = await send("/api/gym/result", body);
    if (res) setNotice(res.already ? "That result was already saved." : "Result saved.");
    return Boolean(res);
  }
  async function leave() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await programmeRequest("/api/gym/leave", withKey(key, jsonBody("POST", { campaignId: id })));
      generation.current += 1; setData(null); setLeaving(false); setPhase("left");
    } catch (e: any) { setError(gymErrorMessage(e)); }
    setBusy(false);
  }

  if (phase === "loading") return <div className="prg-card gym-skeleton" aria-busy="true"><p>Loading your challenge.</p></div>;
  if (phase === "noid") return <div className="prg-card"><h2 style={{ margin: 0 }}>This page needs a challenge link</h2><p>Open it from the link you were given after joining, or ask the organiser for the join link.</p></div>;
  if (phase === "left") return <div className="prg-card"><h2 style={{ margin: 0 }}>You left the challenge</h2><p>Your results here are no longer shared. Your own training log is unchanged.</p></div>;
  if (phase === "unavailable") return <div className="prg-card"><h2 style={{ margin: 0 }}>Not available</h2><p>The gym challenge is not available right now. Nothing was changed.</p></div>;
  if (phase === "notfound") return <div className="prg-card"><h2 style={{ margin: 0 }}>Challenge not found</h2><p>This challenge was not found, or you are not part of it. Use the join link from the organiser.</p></div>;
  if (phase === "error") {
    return (
      <div className="prg-card prg-stack">
        <h2 style={{ margin: 0 }}>Could not load the challenge</h2>
        <p>{error || "Nothing was changed."}</p>
        <div className="prg-actions"><button type="button" className="prg-btn" onClick={() => { setError(""); setPhase("loading"); load(id); }}>Try again</button></div>
      </div>
    );
  }
  if (phase === "signedout") {
    return (
      <div className="prg-card prg-stack">
        <h2 style={{ margin: 0 }}>Sign in to open your challenge</h2>
        <p>Challenge results are kept on your account. Signing in is free.</p>
        <div className="prg-actions"><button type="button" className="prg-btn prg-btn-google" disabled={busy} onClick={signIn}>Sign in with Google</button></div>
        <p className="prg-small">By continuing, you agree to the <a href="/terms/">terms</a> and acknowledge the <a href="/privacy/">privacy policy</a>.</p>
        {error && <p className="prg-msg is-error" role="alert">{error}</p>}
      </div>
    );
  }

  const c = data.campaign;
  const isOrganiser = data.me.role === "organiser";
  const board = data.board ? rankBoard(data.board) : null;
  const active = c.status === "active";
  return (
    <div className="prg-stack">
      <div className="gym-screen prg-stack">
        <header className="prg-card">
          <p className="gym-kicker">{c.gymName}</p>
          <h2 style={{ margin: "0 0 6px", fontSize: "1.8rem" }}>{c.title}</h2>
          <p style={{ margin: 0 }}><span className="prg-num">{formatDay(c.startsOn)}</span> to <span className="prg-num">{formatDay(c.endsOn)}</span>{!active && <strong> (closed)</strong>}</p>
          <h3 style={{ margin: "16px 0 6px" }}>The hold rule</h3>
          <RuleBlock rule={c.rule} />
          <p className="gym-label">Results are self-reported</p>
        </header>

        <div className="prg-live" role="status" aria-live="polite">{notice}</div>
        {error && <p className="prg-msg is-error" role="alert">{error}</p>}

        {active
          ? <section className="prg-card" aria-label="Add a result"><AddResult campaign={c} busy={busy} onSave={addResult} /></section>
          : <p className="prg-msg is-note">This challenge is closed. No new results can be added.</p>}

        <section className="prg-card" aria-labelledby="gym-mine-title">
          <h3 id="gym-mine-title">My results</h3>
          {data.mine.length === 0 ? <p style={{ margin: 0 }}>You have not added a result yet.</p> : (
            <ul className="gym-mine">
              {data.mine.map((r: any) => (
                <li key={r.id} className={r.status !== "active" ? "is-removed" : ""}>
                  <span className="prg-num gym-secs">{effectiveSeconds(r)} s</span>
                  <span>{formatDay(r.local_date)}</span>
                  {r.status !== "active" && <span className="prg-small">Removed by the organiser</span>}
                  {r.status === "active" && r.corrected_seconds != null && <span className="prg-small">Corrected by the organiser from {r.seconds} s. {r.correction_note}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="prg-small" style={{ marginBottom: 0 }}>{data.me.showOnBoard ? "Your best result is shown on the gym board." : "Your results are not shown on the gym board."}</p>
        </section>

        {board ? (
          <section className="prg-card" aria-labelledby="gym-board-title">
            <h3 id="gym-board-title">Gym board</h3>
            {board.length === 0 ? <p style={{ margin: 0 }}>Nobody has chosen to show a result yet.</p> : (
              <div className="prg-table-wrap">
                <table>
                  <caption className="prg-small" style={{ textAlign: "left", padding: "0 0 8px" }}>Self-reported, under the rule above</caption>
                  <thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col">Best, seconds</th><th scope="col">Entries</th></tr></thead>
                  <tbody>
                    {board.map((row: any, i: number) => (
                      <tr key={`${row.display_name}-${i}`}>
                        <td className="prg-num">{row.rank}</td>
                        <th scope="row">{row.display_name}</th>
                        <td className="prg-num">{row.best}</td>
                        <td className="prg-num">{row.entries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <p className="prg-small">The organiser has not turned on the gym board.</p>
        )}

        <section aria-label="Leave this challenge">
          {!leaving
            ? <button type="button" className="prg-btn-quiet" disabled={busy} onClick={() => setLeaving(true)}>Leave challenge</button>
            : <ConfirmRow label={isOrganiser ? "Leave this challenge? You will lose organiser access to it." : "Leave this challenge? Your results stop being shared. Your own training log is unchanged."} yes="Leave challenge" no="Stay" busy={busy} onYes={leave} onNo={() => setLeaving(false)} />}
        </section>
        <p className="prg-small">Stop if you feel sharp pain, numbness, light-headedness or a pinching shoulder. Read the <a href="/deadhang-safety/">safety guide</a>.</p>
      </div>

      {isOrganiser && data.manage && <Organiser data={data} busy={busy} act={(body, ok) => send("/api/gym/organiser", body, ok)} />}
    </div>
  );
}
