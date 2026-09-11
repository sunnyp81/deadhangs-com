import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import '../styles/training-workspace.css';
import {
  ASSISTANCE_LABELS,
  ASSISTANCE_TYPES,
  MAX_ENTRIES,
  MAX_IMPORT_BYTES,
  prepareLogImport,
  toBackup,
  MAX_SECONDS,
  MAX_SETS,
  MIN_SECONDS,
  MIN_SETS,
  STORAGE_KEY,
  addEntry,
  bestByAssistance,
  csvFilename,
  formatLocalDate,
  makeEntryId,
  parseIntStrict,
  parseStoredLog,
  removeEntry,
  serializeLog,
  toCsv,
  toLocalDateString,
  validateEntryInput,
} from '../lib/training-log.mjs';

type Status = 'idle' | 'running' | 'paused' | 'done';
type Phase = 'work' | 'rest';
type StorageState = 'loading' | 'ready' | 'corrupt' | 'unavailable';

type Entry = {
  id: string;
  date: string;
  seconds: number;
  assistance: string;
  sets: number;
};

const WORK_MIN = 1;
const WORK_MAX = 600;
const REST_MIN = 0;
const REST_MAX = 600;
const SETS_MIN = 1;
const SETS_MAX = 20;

const DEFAULT_WORK = '20';
const DEFAULT_REST = '60';
const DEFAULT_SETS = '3';

const ASSISTANCE_OPTIONS: string[] = ASSISTANCE_TYPES;

function assistanceLabel(type: string) {
  return (ASSISTANCE_LABELS as Record<string, string>)[type] ?? type;
}

/** mm:ss from milliseconds remaining, rounded up so the clock reads 00:01 until zero. */
function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Returns the integer inside [min, max], or null when the field is not usable yet. */
function settingValue(raw: string, min: number, max: number): number | null {
  const n = parseIntStrict(raw);
  if (n === null || n < min || n > max) return null;
  return n;
}

function readRawLog(): { available: boolean; raw: string | null } {
  try {
    return { available: true, raw: window.localStorage.getItem(STORAGE_KEY) };
  } catch {
    return { available: false, raw: null };
  }
}

function writeRawLog(text: string): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export default function TrainingWorkspace({ showTimer = true }: { showTimer?: boolean }) {
  const uid = useId();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  /* ---------------------------------------------------------------- timer */

  const [workInput, setWorkInput] = useState(DEFAULT_WORK);
  const [restInput, setRestInput] = useState(DEFAULT_REST);
  const [setsInput, setSetsInput] = useState(DEFAULT_SETS);

  const workSec = settingValue(workInput, WORK_MIN, WORK_MAX);
  const restSec = settingValue(restInput, REST_MIN, REST_MAX);
  const setsCount = settingValue(setsInput, SETS_MIN, SETS_MAX);
  const settingsValid = hydrated && workSec !== null && restSec !== null && setsCount !== null;

  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<Phase>('work');
  const [round, setRound] = useState(1);
  const [remainingMs, setRemainingMs] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  // Absolute monotonic deadline for the current phase — the countdown is always
  // derived from it, so a slow or coalesced interval can never accumulate drift.
  const deadlineRef = useRef(0);
  const pausedRemainingRef = useRef(0);
  const statusRef = useRef<Status>('idle');
  statusRef.current = status;

  const settingsLocked = !hydrated || status === 'running' || status === 'paused';
  const displayMs = status === 'idle' ? (workSec ?? 0) * 1000 : remainingMs;

  const pause = useCallback(() => {
    if (statusRef.current !== 'running') return;
    pausedRemainingRef.current = Math.max(0, deadlineRef.current - performance.now());
    setRemainingMs(pausedRemainingRef.current);
    setStatus('paused');
  }, []);

  const start = useCallback(() => {
    if (workSec === null || setsCount === null) return;
    deadlineRef.current = performance.now() + workSec * 1000;
    setPhase('work');
    setRound(1);
    setRemainingMs(workSec * 1000);
    setStatus('running');
  }, [workSec, setsCount]);

  const resume = useCallback(() => {
    deadlineRef.current = performance.now() + pausedRemainingRef.current;
    setStatus('running');
  }, []);

  const reset = useCallback(() => {
    deadlineRef.current = 0;
    pausedRemainingRef.current = 0;
    setStatus('idle');
    setPhase('work');
    setRound(1);
    setRemainingMs(0);
  }, []);

  useEffect(() => {
    if (status !== 'running' || workSec === null || restSec === null || setsCount === null) return;

    function tick() {
      const now = performance.now();
      const left = deadlineRef.current - now;
      if (left > 0) {
        setRemainingMs(left);
        return;
      }
      // Chain the next phase off the previous deadline so rounding never drifts.
      // If we overshot badly (throttled tab) fall back to "now" instead of
      // instantly burning through phases.
      const base = left < -1000 ? now : deadlineRef.current;
      const startPhase = (seconds: number) => {
        deadlineRef.current = base + seconds * 1000;
        setRemainingMs(Math.max(0, deadlineRef.current - now));
      };

      if (phase === 'work') {
        if (round >= (setsCount as number)) {
          setRemainingMs(0);
          setStatus('done');
          return;
        }
        if ((restSec as number) === 0) {
          setRound((r) => r + 1);
          startPhase(workSec as number);
          return;
        }
        setPhase('rest');
        startPhase(restSec as number);
        return;
      }
      setPhase('work');
      setRound((r) => r + 1);
      startPhase(workSec as number);
    }

    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [status, phase, round, workSec, restSec, setsCount]);

  // A backgrounded tab gets throttled, so pause instead of pretending the user
  // kept hanging through rounds they never saw.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') pause();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);

  // Announce phase changes only — never per tick, which would flood a screen reader.
  useEffect(() => {
    if (status === 'idle') {
      setAnnouncement('');
      return;
    }
    if (status === 'paused') {
      setAnnouncement('Timer paused.');
      return;
    }
    if (status === 'done') {
      setAnnouncement('Timer finished. Nothing has been logged.');
      return;
    }
    setAnnouncement(
      phase === 'work'
        ? `Hang interval, round ${round} of ${setsCount ?? '?'}.`
        : `Rest interval, ${restSec ?? 0} seconds.`,
    );
  }, [status, phase, round, setsCount, restSec]);

  const phaseLabel =
    status === 'idle' ? 'Ready' : status === 'done' ? 'Finished' : phase === 'work' ? 'Hang' : 'Rest';

  /* ------------------------------------------------------------------ log */

  const [storageState, setStorageState] = useState<StorageState>('loading');
  const rawSnapshot = useRef<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [droppedRows, setDroppedRows] = useState(0);
  const [logStatus, setLogStatus] = useState('');
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ entries: Entry[]; added: number; skipped: number; snapshot: string | null } | null>(null);
  const [readingImport, setReadingImport] = useState(false);
  const importAttempt = useRef(0);
  const importField = useRef<HTMLInputElement | null>(null);

  const [dateInput, setDateInput] = useState('');
  const [holdInput, setHoldInput] = useState('');
  const [assistanceInput, setAssistanceInput] = useState<string>(ASSISTANCE_OPTIONS[0]);
  const [logSetsInput, setLogSetsInput] = useState('1');

  const holdFieldRef = useRef<HTMLInputElement | null>(null);
  // Resolved on the client only: the server's timezone must not decide "today".
  const [today, setToday] = useState('');

  // Read once on the client — never during SSR.
  useEffect(() => {
    setToday(toLocalDateString());
    setDateInput(toLocalDateString());
    const { available, raw } = readRawLog();
    rawSnapshot.current = raw;
    if (!available) {
      setStorageState('unavailable');
      return;
    }
    const parsed = parseStoredLog(raw, toLocalDateString());
    if (parsed.status === 'corrupt') {
      setStorageState('corrupt');
      return;
    }
    setEntries(parsed.entries as Entry[]);
    setDroppedRows(parsed.dropped);
    setStorageState('ready');
  }, []);

  const canWrite = storageState === 'ready';
  const atLimit = entries.length >= MAX_ENTRIES;

  /** Persists first; in-memory state only changes when the write actually succeeded. */
  const commit = useCallback((next: Entry[], message: string) => {
    const current = readRawLog();
    if (!current.available) {
      setLogStatus('Storage is unavailable. Nothing was changed.');
      return false;
    }
    if (current.raw !== rawSnapshot.current) {
      setLogStatus('Your log changed in another tab. Reload this page before saving so those entries are preserved.');
      return false;
    }
    if (!writeRawLog(serializeLog(next))) {
      setLogStatus('Could not save to this browser’s storage. It may be full or blocked. Nothing was changed.');
      return false;
    }
    setEntries(next);
    rawSnapshot.current = serializeLog(next);
    setLogStatus(message);
    return true;
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormErrors([]);
    if (!canWrite) return;

    if (atLimit) {
      setFormErrors([`This log holds ${MAX_ENTRIES} entries. Export to CSV, then delete some entries to make room.`]);
      return;
    }
    const result = validateEntryInput(
      { date: dateInput, seconds: holdInput, assistance: assistanceInput, sets: logSetsInput },
      toLocalDateString(),
    );
    if (!result.ok || !result.value) {
      setFormErrors(result.errors);
      return;
    }
    const { date, seconds, assistance, sets } = result.value;
    if (seconds === null || sets === null || !ASSISTANCE_OPTIONS.includes(assistance)) {
      setFormErrors(['Check the hold, assistance and set values.']);
      return;
    }
    const entry: Entry = { id: makeEntryId(entries), date, seconds, assistance, sets };
    const added = addEntry(entries, entry);
    if (!added.ok) {
      setFormErrors([`This log holds ${MAX_ENTRIES} entries. Export to CSV first, then delete some entries.`]);
      return;
    }
    if (commit(added.entries as Entry[], `Saved ${entry.seconds}s on ${formatLocalDate(entry.date)} to this device.`)) {
      setHoldInput('');
    }
  }

  function handleDelete(id: string) {
    setPendingDelete(null);
    commit(removeEntry(entries, id) as Entry[], 'Entry deleted from this device.');
  }

  function handleClearAll() {
    setConfirmClearAll(false);
    commit([], 'All entries deleted from this device.');
  }

  function handleReplaceCorrupt() {
    setConfirmReplace(false);
    const current = readRawLog();
    if (!current.available || current.raw !== rawSnapshot.current) {
      setLogStatus('Your saved data changed or is unavailable. Reload before replacing it.');
      return;
    }
    if (!writeRawLog(serializeLog([]))) {
      setLogStatus('Could not write to this browser’s storage. Your existing data is untouched.');
      return;
    }
    setEntries([]);
    rawSnapshot.current = serializeLog([]);
    setDroppedRows(0);
    setStorageState('ready');
    setLogStatus('Started a fresh log on this device.');
  }

  function handleExport() {
    const blob = new Blob([toCsv(entries)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename(toLocalDateString());
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLogStatus('CSV download requested. Check your browser downloads.');
  }

  function exportRecovery() {
    const current = readRawLog();
    if (!current.available || current.raw === null) { setLogStatus('Saved data is unavailable.'); return; }
    const url = URL.createObjectURL(new Blob([current.raw], { type:'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'deadhangs-log-recovery.json';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLogStatus('Recovery file download requested. Keep it before starting a fresh log.');
  }

  function backupLog() {
    const current = readRawLog();
    if (!current.available || current.raw !== rawSnapshot.current) {
      setLogStatus('Your log changed or is unavailable. Reload before exporting a backup.'); return;
    }
    const url = URL.createObjectURL(new Blob([toBackup(entries)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'deadhangs-training-log-' + toLocalDateString() + '.json';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLogStatus('Backup download requested. You can import this file on another device.');
  }

  async function readImport(file?: File) {
    const attempt = ++importAttempt.current;
    setPendingImport(null);
    if (!file || !canWrite) { setReadingImport(false); return; }
    if (file.size > MAX_IMPORT_BYTES) { setLogStatus('Choose a backup smaller than 128 KB.'); setReadingImport(false); return; }
    const snapshot = rawSnapshot.current;
    setReadingImport(true);
    try {
      const result = prepareLogImport(await file.text(), entries, toLocalDateString());
      if (attempt !== importAttempt.current) return;
      if (!result.ok) { setLogStatus(result.error); return; }
      setPendingImport({ entries: result.entries as Entry[], added: result.added, skipped: result.skipped, snapshot });
      setLogStatus('File checked. Review the import below. Nothing has changed yet.');
    } catch { if (attempt === importAttempt.current) setLogStatus('This file could not be read. Nothing was changed.'); }
    finally { if (attempt === importAttempt.current) setReadingImport(false); }
  }

  function confirmImport() {
    if (!pendingImport || !canWrite) return;
    if (pendingImport.snapshot !== rawSnapshot.current) {
      setPendingImport(null); setLogStatus('Your log changed after you selected the file. Select the file again.'); return;
    }
    if (commit(pendingImport.entries, 'Imported ' + pendingImport.added + ' entries; skipped ' + pendingImport.skipped + ' duplicates.')) {
      setPendingImport(null); if (importField.current) importField.current.value = '';
    }
  }

  const bests = useMemo(
    () => bestByAssistance(entries) as Record<string, Entry | null>,
    [entries],
  );

  return (
    <section className="training-workspace tw-root" aria-labelledby={`${uid}-title`}>
      <header className="tw-header">
        <p className="dh-eyebrow">Free · no account</p>
        <h2 id={`${uid}-title`} className="dh-display tw-title">{showTimer ? 'Training workspace' : 'Your training log'}</h2>
        <p className="tw-lede">
          {showTimer ? 'An interval timer and a hang log. Nothing is saved unless you fill in the log yourself.' : 'Record your holds. Compare like-for-like sessions. Export your progress whenever you want.'}
        </p>
      </header>

      {/* ---------------------------------------------------------- timer */}
      {showTimer && <div className="tw-panel">
        <h3 className="tw-panel-title">Interval timer</h3>

        <div className="tw-clock" role="group" aria-label="Interval timer readout">
          <p className="tw-phase" data-phase={status === 'idle' || status === 'done' ? 'idle' : phase}>
            {phaseLabel}
          </p>
          <p className="dh-mono tw-time">{formatClock(displayMs)}</p>
          <p className="tw-round dh-mono">
            Round {round} / {setsCount ?? '—'}
          </p>
        </div>

        <p className="tw-visually-hidden" aria-live="polite">{announcement}</p>

        <div className="tw-controls">
          {status === 'running' ? (
            <button type="button" className="dh-btn dh-btn-ghost" onClick={pause}>Pause</button>
          ) : (
            <button
              type="button"
              className="dh-btn"
              onClick={status === 'paused' ? resume : start}
              disabled={!settingsValid}
            >
              {!hydrated ? 'Loading timer…' : status === 'paused' ? 'Resume' : status === 'done' ? 'Start again' : 'Start'}
            </button>
          )}
          <button type="button" className="dh-btn dh-btn-ghost" onClick={reset} disabled={!hydrated}>Reset</button>
        </div>

        {hydrated && !settingsValid && (
          <p className="tw-error" role="alert">
            Enter hang {WORK_MIN}–{WORK_MAX}s, rest {REST_MIN}–{REST_MAX}s and {SETS_MIN}–{SETS_MAX} sets
            to start.
          </p>
        )}

        <fieldset className="tw-settings" disabled={settingsLocked}>
          <legend className="dh-eyebrow tw-legend">
            Your settings{settingsLocked ? ' (locked while a session is open)' : ''}
          </legend>
          <div className="tw-settings-grid">
            <div className="tw-field">
              <label htmlFor={`${uid}-work`}>Hang seconds</label>
              <input
                id={`${uid}-work`} className="dh-input" type="number" inputMode="numeric"
                min={WORK_MIN} max={WORK_MAX} step={1} value={workInput}
                onChange={(e) => setWorkInput(e.target.value)}
              />
              <span className="tw-hint">{WORK_MIN}–{WORK_MAX}</span>
            </div>
            <div className="tw-field">
              <label htmlFor={`${uid}-rest`}>Rest seconds</label>
              <input
                id={`${uid}-rest`} className="dh-input" type="number" inputMode="numeric"
                min={REST_MIN} max={REST_MAX} step={1} value={restInput}
                onChange={(e) => setRestInput(e.target.value)}
              />
              <span className="tw-hint">{REST_MIN} = straight through</span>
            </div>
            <div className="tw-field">
              <label htmlFor={`${uid}-sets`}>Sets</label>
              <input
                id={`${uid}-sets`} className="dh-input" type="number" inputMode="numeric"
                min={SETS_MIN} max={SETS_MAX} step={1} value={setsInput}
                onChange={(e) => setSetsInput(e.target.value)}
              />
              <span className="tw-hint">{SETS_MIN}–{SETS_MAX}</span>
            </div>
          </div>
          <p className="tw-note">
            These numbers are just the intervals you picked — edit them to whatever suits your
            session. Come off the bar if anything hurts, and step down under control rather than
            dropping.
          </p>
        </fieldset>

        {status === 'done' && (
          <div className="tw-done">
            <p>
              Timer finished. It has no idea how long you actually held on, so nothing was saved.
              If you want a record, type the hold time you really managed into the log below.
            </p>
            <button
              type="button" className="dh-btn dh-btn-ghost"
              onClick={() => holdFieldRef.current?.focus()}
            >
              Log what I actually held
            </button>
          </div>
        )}
      </div>}

      {/* ------------------------------------------------------------ log */}
      <div className="tw-panel">
        <h3 className="tw-panel-title">Training log</h3>
        <p className="tw-lede">
          Stored in this browser on this device only. No account, no server, nothing sent anywhere.
          Clearing your browser data removes it, and it will not appear on your other devices.
        </p>

        {storageState === 'unavailable' && (
          <p className="tw-error" role="alert">
            This browser is blocking local storage (private mode or a site setting), so the log
            cannot save anything. The timer above still works.
          </p>
        )}

        {storageState === 'corrupt' && (
          <div className="tw-error" role="alert">
            <p>
              We could not safely read all your saved training data. It has been left untouched.
              Download a recovery copy before choosing whether to start a fresh log.
            </p>
            <button type="button" className="dh-btn dh-btn-ghost" onClick={exportRecovery}>Download recovery copy</button>
            {confirmReplace ? (
              <div className="tw-confirm">
                <span>Replace that unreadable data with an empty log? This cannot be undone.</span>
                <button type="button" className="dh-btn" onClick={handleReplaceCorrupt}>Yes, replace it</button>
                <button type="button" className="dh-btn dh-btn-ghost" onClick={() => setConfirmReplace(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="dh-btn dh-btn-ghost" onClick={() => setConfirmReplace(true)}>
                Start a fresh log
              </button>
            )}
          </div>
        )}

        {droppedRows > 0 && (
          <p className="tw-note">
            {droppedRows} stored {droppedRows === 1 ? 'row' : 'rows'} did not match the expected
            format and {droppedRows === 1 ? 'is' : 'are'} not shown.
          </p>
        )}

        <form className="tw-form" onSubmit={handleSubmit}>
          <div className="tw-form-grid">
            <div className="tw-field">
              <label htmlFor={`${uid}-date`}>Date</label>
              <input
                id={`${uid}-date`} className="dh-input" type="date" value={dateInput} max={today}
                onChange={(e) => setDateInput(e.target.value)} disabled={!canWrite}
              />
            </div>
            <div className="tw-field">
              <label htmlFor={`${uid}-hold`}>Best hold you actually did (seconds)</label>
              <input
                id={`${uid}-hold`} ref={holdFieldRef} className="dh-input" type="number"
                inputMode="numeric" min={MIN_SECONDS} max={MAX_SECONDS} step={1}
                value={holdInput} onChange={(e) => setHoldInput(e.target.value)}
                disabled={!canWrite} placeholder="e.g. 24"
              />
            </div>
            <div className="tw-field">
              <label htmlFor={`${uid}-assist`}>Assistance</label>
              <select
                id={`${uid}-assist`} className="dh-input" value={assistanceInput}
                onChange={(e) => setAssistanceInput(e.target.value)} disabled={!canWrite}
              >
                {ASSISTANCE_OPTIONS.map((type) => (
                  <option key={type} value={type}>{assistanceLabel(type)}</option>
                ))}
              </select>
            </div>
            <div className="tw-field">
              <label htmlFor={`${uid}-logsets`}>Sets</label>
              <input
                id={`${uid}-logsets`} className="dh-input" type="number" inputMode="numeric"
                min={MIN_SETS} max={MAX_SETS} step={1} value={logSetsInput}
                onChange={(e) => setLogSetsInput(e.target.value)} disabled={!canWrite}
              />
            </div>
          </div>

          {formErrors.length > 0 && (
            <ul className="tw-error" role="alert">
              {formErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}

          <div className="tw-controls">
            <button type="submit" className="dh-btn" disabled={!canWrite}>Save to this device</button>
            <button
              type="button" className="dh-btn dh-btn-ghost" onClick={handleExport}
              disabled={entries.length === 0}
            >
              Export CSV
            </button>
          </div>
          <p className="tw-hint">
            {entries.length} / {MAX_ENTRIES} entries saved
            {atLimit ? ' — the log is full. Export to CSV first, then delete entries to make room.' : ''}
          </p>
        </form>

        <div className="tw-controls">
          <button type="button" className="dh-btn dh-btn-ghost" onClick={backupLog} disabled={!canWrite || entries.length === 0}>Download backup</button>
        </div>
        <div className="tw-field">
          <label htmlFor={uid + '-import'}>Import a DeadHangs backup or CSV</label>
          <input ref={importField} id={uid + '-import'} type="file" accept=".json,.csv,application/json,text/csv" disabled={!canWrite} onChange={e => { void readImport(e.target.files?.[0]); }} />
          <p className="tw-hint">Up to 128 KB. Imports add to this log; existing entries stay. JSON backups preserve entry IDs. CSV duplicates are matched by date, hold, assistance and sets.</p>
        </div>
        {readingImport && <p role="status">Checking file…</p>}
        {pendingImport && <div className="tw-warning">
          <p>Add {pendingImport.added} entries and skip {pendingImport.skipped} duplicates? Your log will contain {pendingImport.entries.length} entries.</p>
          <button type="button" className="dh-btn" onClick={confirmImport}>Confirm import</button>
          <button type="button" className="dh-btn dh-btn-ghost" onClick={() => { setPendingImport(null); if (importField.current) importField.current.value = ''; setLogStatus('Import cancelled. Nothing was changed.'); }}>Cancel import</button>
        </div>}
        <p className="tw-status" aria-live="polite">{logStatus}</p>

        {entries.length > 0 && (
          <div className="tw-bests">
            {ASSISTANCE_OPTIONS.map((type) => {
              const best = bests[type];
              return (
                <div key={type} className="tw-best">
                  <span className="dh-eyebrow">Best · {assistanceLabel(type)}</span>
                  <span className="dh-mono tw-best-value">{best ? `${best.seconds}s` : '—'}</span>
                  <span className="tw-hint">
                    {best ? `on ${formatLocalDate(best.date)}` : 'no entries of this type yet'}
                  </span>
                </div>
              );
            })}
            <p className="tw-note tw-bests-note">
              Bests are compared only against your own entries of the same assistance type —
              feet-supported holds are never stacked against unassisted ones.
            </p>
          </div>
        )}

        {storageState === 'ready' && entries.length === 0 && (
          <p className="tw-empty">
            No entries yet. Your first saved hold will appear here.
          </p>
        )}

        {entries.length > 0 && (
          <>
            <p className="tw-hint">Scroll the log horizontally on smaller screens.</p>
            <div className="tw-table-wrap" tabIndex={0} role="region" aria-label="Saved training sessions">
              <table className="tw-table">
                <caption className="tw-visually-hidden">Your saved hangs, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Best hold</th>
                    <th scope="col">Assistance</th>
                    <th scope="col">Sets</th>
                    <th scope="col"><span className="tw-visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatLocalDate(entry.date)}</td>
                      <td className="dh-mono">{entry.seconds}s</td>
                      <td>{assistanceLabel(entry.assistance)}</td>
                      <td className="dh-mono">{entry.sets}</td>
                      <td>
                        {pendingDelete === entry.id ? (
                          <span className="tw-confirm">
                            <span>Delete?</span>
                            <button type="button" className="tw-link tw-link-danger" onClick={() => handleDelete(entry.id)}>
                              Yes, delete
                            </button>
                            <button type="button" className="tw-link" onClick={() => setPendingDelete(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button" className="tw-link"
                            onClick={() => { setConfirmClearAll(false); setPendingDelete(entry.id); }}
                          >
                            Delete<span className="tw-visually-hidden"> entry from {formatLocalDate(entry.date)}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="tw-controls">
              {confirmClearAll ? (
                <span className="tw-confirm">
                  <span>Delete all {entries.length} entries from this device?</span>
                  <button type="button" className="dh-btn" onClick={handleClearAll}>Yes, delete all</button>
                  <button type="button" className="dh-btn dh-btn-ghost" onClick={() => setConfirmClearAll(false)}>Cancel</button>
                </span>
              ) : (
                <button
                  type="button" className="dh-btn dh-btn-ghost"
                  onClick={() => { setPendingDelete(null); setConfirmClearAll(true); }}
                >
                  Delete all entries
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
