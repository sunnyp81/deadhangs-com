import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import React from "react";
import { renderToString } from "react-dom/server";

const lib = (name) => new URL(`../src/lib/${name}`, import.meta.url).href;
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const storeSource = (await fs.readFile(new URL("../src/lib/training-profile-store.ts", import.meta.url), "utf8"))
  .replace('from "./training-profile.mjs"', `from "${lib("training-profile.mjs")}"`);
const componentSource = (await fs.readFile(new URL("../src/components/GoalSetup.tsx", import.meta.url), "utf8"))
  .replace('from "react"', `from "${import.meta.resolve("react")}"`)
  .replace('from "../lib/training-profile.mjs"', `from "${lib("training-profile.mjs")}"`)
  .replace('from "../lib/training-profile-store"', `from "${dataUrl(compile(storeSource))}"`);
const { default: GoalSetup } = await import(dataUrl(compile(componentSource)));

test("goal setup renders identical initial HTML on build day and a later visit", () => {
  const NativeDate = globalThis.Date;
  const renderAt = (iso) => {
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [iso])); }
      static now() { return new NativeDate(iso).getTime(); }
    };
    return renderToString(React.createElement(GoalSetup, { onProfileChange() {}, onLoad() { return "test"; } }));
  };
  try {
    const build = renderAt("2026-11-07T12:00:00Z");
    const later = renderAt("2026-11-10T12:00:00Z");
    assert.equal(build, later);
    assert.doesNotMatch(build, /Next planned date:/);
  } finally { globalThis.Date = NativeDate; }
});
