import HangTimer from "./HangTimer";
import { parseEmbedParams } from "../lib/embed-params.mjs";

export default function EmbedTimer() {
  const p = parseEmbedParams(window.location.search);
  return <HangTimer compact embed initialWork={p.work} initialRest={p.rest} rounds={p.rounds} />;
}
