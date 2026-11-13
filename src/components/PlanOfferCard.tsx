import PlanBuyForm from "./PlanBuyForm";

export default function PlanOfferCard({ testSeconds, age }: { testSeconds: number; age: number | null }) {
  return (
    <section className="yn-plan" aria-labelledby="pb-plan_offer-title">
      <p className="yn-title dh-eyebrow" id="pb-plan_offer-title">Your 8-week plan from this result</p>
      <p className="small-copy">
        Built from the same progression rules as the free guides, arranged around your result of {testSeconds} s.
      </p>
      <ul className="yn-lines">
        <li><span className="yn-text">Eight weeks, three sessions a week. Your holds for each week, with the choices written out.</span></li>
        <li><span className="yn-text">Re-test weeks 4 and 8, with a link to the age comparison.</span></li>
        <li><span className="yn-text">A printable sheet and timer presets set to your holds.</span></li>
      </ul>
      <PlanBuyForm source="plan_offer" testSeconds={testSeconds} age={age} />
    </section>
  );
}
