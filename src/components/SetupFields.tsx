import { useId } from "react";
import "../styles/training-workspace.css";
import {
  ASSISTANCE_LABELS,
  ASSISTANCE_TYPES,
  BAR_OPTION_LABELS,
  BAR_TYPES,
  ENDED_LABELS,
  ENDED_TYPES,
  GRIP_LABELS,
  GRIP_TYPES,
  MAX_LOAD,
  LOAD_UNITS,
} from "../lib/training-log.mjs";
import type { SetupForm } from "../lib/training-log-store";

const L = (map: unknown, key: string) => (map as Record<string, string>)[key] ?? key;

/**
 * The optional setup fields, shared by the log form and the timer's max test.
 * Blank always means "not recorded"; nothing here is required.
 */
export default function SetupFields({
  value,
  onChange,
  disabled = false,
  showEnded = false,
  idPrefix,
}: {
  value: SetupForm;
  onChange: (next: SetupForm) => void;
  disabled?: boolean;
  showEnded?: boolean;
  idPrefix?: string;
}) {
  const generated = useId();
  const id = idPrefix ?? generated;
  const set = (patch: Partial<SetupForm>) => onChange({ ...value, ...patch });
  return (
    <div className="tw-form-grid tw-setup-grid">
      <div className="tw-field">
        <label htmlFor={`${id}-assist`}>Assistance</label>
        <select id={`${id}-assist`} className="dh-input" value={value.assistance} disabled={disabled} onChange={(e) => set({ assistance: e.target.value })}>
          {ASSISTANCE_TYPES.map((type: string) => <option key={type} value={type}>{L(ASSISTANCE_LABELS, type)}</option>)}
        </select>
      </div>
      <div className="tw-field">
        <label htmlFor={`${id}-bar`}>Bar</label>
        <select id={`${id}-bar`} className="dh-input" value={value.bar} disabled={disabled} onChange={(e) => set({ bar: e.target.value })}>
          <option value="">Not recorded</option>
          {BAR_TYPES.map((type: string) => <option key={type} value={type}>{L(BAR_OPTION_LABELS, type)}</option>)}
        </select>
      </div>
      <div className="tw-field">
        <label htmlFor={`${id}-grip`}>Grip</label>
        <select id={`${id}-grip`} className="dh-input" value={value.grip} disabled={disabled} onChange={(e) => set({ grip: e.target.value })}>
          <option value="">Not recorded</option>
          {GRIP_TYPES.map((type: string) => <option key={type} value={type}>{L(GRIP_LABELS, type)}</option>)}
        </select>
      </div>
      <div className="tw-field">
        <label htmlFor={`${id}-chalk`}>Chalk</label>
        <select id={`${id}-chalk`} className="dh-input" value={value.chalk} disabled={disabled} onChange={(e) => set({ chalk: e.target.value })}>
          <option value="">Not recorded</option>
          <option value="yes">Chalk</option>
          <option value="no">No chalk</option>
        </select>
      </div>
      <div className="tw-field">
        <label htmlFor={`${id}-load`}>Added load (optional)</label>
        <div className="tw-load-row">
          <input
            id={`${id}-load`} className="dh-input" type="text" inputMode="decimal" autoComplete="off"
            value={value.load} disabled={disabled} placeholder="None" maxLength={5}
            aria-describedby={`${id}-load-hint`}
            onChange={(e) => set({ load: e.target.value })}
          />
          <select aria-label="Load unit" className="dh-input" value={value.loadUnit} disabled={disabled} onChange={(e) => set({ loadUnit: e.target.value })}>
            {LOAD_UNITS.map((unit: string) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </div>
        <span id={`${id}-load-hint`} className="tw-hint">Weight added on top of you, up to {MAX_LOAD}. Leave blank for none.</span>
      </div>
      <div className="tw-field">
        <label htmlFor={`${id}-bw`}>Body weight (optional)</label>
        <div className="tw-load-row">
          <input
            id={`${id}-bw`} className="dh-input" type="text" inputMode="decimal" autoComplete="off"
            value={value.bodyweight ?? ""} disabled={disabled} placeholder="Not recorded" maxLength={5}
            aria-describedby={`${id}-bw-hint`}
            onChange={(e) => set({ bodyweight: e.target.value })}
          />
          <select aria-label="Body weight unit" className="dh-input" value={value.bodyweightUnit ?? "kg"} disabled={disabled} onChange={(e) => set({ bodyweightUnit: e.target.value })}>
            {LOAD_UNITS.map((unit: string) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </div>
        <span id={`${id}-bw-hint`} className="tw-hint">Saved in kg on this device only, so entries compare like for like. Not remembered for next time.</span>
      </div>
      {showEnded && (
        <div className="tw-field">
          <label htmlFor={`${id}-ended`}>What ended the hold (optional)</label>
          <select id={`${id}-ended`} className="dh-input" value={value.ended} disabled={disabled} onChange={(e) => set({ ended: e.target.value })}>
            <option value="">Not recorded</option>
            {ENDED_TYPES.map((type: string) => <option key={type} value={type}>{L(ENDED_LABELS, type)}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
