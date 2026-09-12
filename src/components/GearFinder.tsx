import { useId, useState } from "react";

const options = [
  { id: "doorway", label: "Doorway", copy: "A no-drill option for a removable setup. Check the frame type, clearance and the manufacturer’s fit guidance.", href: "/equipment-guide/#doorway", amazon: "doorway pull up bar" },
  { id: "wall", label: "Wall mounted", copy: "For a fixed training spot. Check the wall construction, mounting hardware and the bar’s rated load before buying.", href: "/equipment-guide/#wall", amazon: "wall mounted pull up bar" },
  { id: "freestanding", label: "Freestanding", copy: "For a dedicated space without drilling into a wall. Check footprint, stability and ceiling clearance.", href: "/equipment-guide/#freestanding", amazon: "freestanding pull up station" },
] as const;

export default function GearFinder() {
  const uid = useId();
  const [selected, setSelected] = useState<(typeof options)[number]["id"]>("doorway");
  const option = options.find((item) => item.id === selected)!;
  return <section className="gear-finder" aria-labelledby={`${uid}-title`}>
    <div>
      <p className="dh-eyebrow">Equipment matcher</p>
      <h2 id={`${uid}-title`} className="dh-display">Find a bar that fits your space.</h2>
      <p>Choose the setup you are considering. The guide explains the trade-offs before you buy.</p>
      <fieldset className="gear-finder-options">
        <legend>Choose a bar type</legend>
        {options.map((item) => <label key={item.id} className={selected === item.id ? "is-selected" : ""}>
          <input type="radio" name={`${uid}-gear`} checked={selected === item.id} onChange={() => setSelected(item.id)} />
          {item.label}
        </label>)}
      </fieldset>
    </div>
    <div className="gear-finder-result" aria-live="polite">
      <p className="dh-eyebrow">{option.label} setup</p>
      <p>{option.copy}</p>
      <div className="button-row">
        <a className="dh-btn" href={option.href}>Read the guide</a>
        <a className="text-link" href={`https://www.amazon.co.uk/s?k=${encodeURIComponent(option.amazon)}&tag=deadhangs-21`} rel="nofollow sponsored noopener noreferrer" target="_blank">Browse Amazon UK ↗</a>
      </div>
      <p className="small-copy">Affiliate link. Opens a new tab. Always check the bar’s instructions and load rating.</p>
    </div>
  </section>;
}
