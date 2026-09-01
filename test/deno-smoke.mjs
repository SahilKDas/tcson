import { evaluate, load } from "../dist/esm/index.js";

const bytes = evaluate("test/fixtures/deno.tcson");
const text = new TextDecoder().decode(bytes);
if (text !== '{\n  "runtime": "deno",\n  "supported": true\n}') {
  throw new Error(`Unexpected Deno evaluation output: ${text}`);
}
const value = load("test/fixtures/deno.tcson");
if (value.runtime !== "deno" || value.supported !== true) {
  throw new Error("Unexpected Deno load result");
}
