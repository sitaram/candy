/**
 * Walk the product like a user on an iPhone and report everything that looks wrong: console errors,
 * page exceptions, failed requests, layout overflow, double focus rings, tiny tap targets, unnamed
 * buttons, clipped text, elements below the fold. Screenshots of each screen land in qa-shots/.
 *
 *   pnpm qa            # against http://localhost:3010
 *   pnpm qa <base>     # against another origin
 */
import { launch, type Issue } from "./cdp.mts";
import { CHECKS } from "./checks.mts";

const BASE = process.argv[2] ?? "http://localhost:3010";
const { page, close } = await launch();
const seen = new Set<string>();
// Fast Refresh, when a file is saved mid-walk, hot-swaps hooks under mounted components and produces
// "order of Hooks" / "Should have a queue" — not a product bug. Tag those so they can be told apart.
page.on("Runtime.consoleAPICalled", (p) => { const a = String((p.args as { value?: unknown }[])[0]?.value ?? ""); if (/Fast Refresh|\[HMR\]|hot-reloader/.test(a)) hmrSeen = true; });
let hmrSeen = false;
// Slow API responses are bugs too: anything the page waits on over 1.5 s.
const t0s = new Map<string, number>();
page.on("Network.requestWillBeSent", (p) => { t0s.set(p.requestId as string, Date.now()); });
page.on("Network.responseReceived", (p) => { const r = p.response as { url: string }; const t = t0s.get(p.requestId as string); if (t && /\/api\//.test(r.url) && !/\/api\/(backfill|err)/.test(r.url)) { const ms = Date.now() - t; if (ms > 1500) page.issues.push({ kind: "network", where: page.screen, msg: `slow ${ms}ms ${r.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 80)}` }); } });
const step = async (name: string, fn: () => Promise<void>) => {
  page.screen = name;
  try { await fn(); } catch (e) { page.issues.push({ kind: "pageerror", where: name, msg: `step failed: ${(e as Error).message}` }); }
  await page.sleep(300);
  for (const c of await page.eval<{ kind: Issue["kind"]; msg: string }[]>(CHECKS)) { const key = name + c.msg; if (!seen.has(key)) { seen.add(key); page.issues.push({ where: name, ...c }); } }
  await page.shot(name);
};

await step("splash", async () => { await page.goto(`${BASE}/`); await page.waitFor(".fcard.splash"); });
await step("splash-short", async () => { await page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: true }); await page.sleep(300); });
await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await step("feed-first", async () => { await page.swipe("up"); await page.waitFor(".fcard:not(.splash) .title, .fcard.card", 10000); await page.sleep(600); });
await step("feed-second", async () => { await page.swipe("up"); });
await step("feed-back", async () => { await page.swipe("down"); });
await step("feed-like", async () => { await page.swipe("right"); await page.sleep(500); });
await step("feed-pass", async () => { await page.swipe("left"); await page.sleep(500); });
await step("detail", async () => { await page.eval("document.querySelector('.stack .fcard:not(.rail) .body, .stack .fcard:not(.rail)')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await page.waitFor(".detail", 5000); await page.waitFor(".rel:not(.rel-loading), .detail h3", 10000); await page.sleep(800); });
await step("detail-scrolled", async () => { await page.eval("document.querySelector('.detail-body, .detail')?.scrollBy(0, 900)"); await page.sleep(300); });
await step("detail-closed", async () => { await page.eval("history.back(); undefined"); await page.sleep(400); await page.waitFor(".fcard", 5000); await page.sleep(600); });
await step("search-open", async () => { await page.waitFor("button[aria-label='Search']", 5000); await page.tap("button[aria-label='Search']"); await page.waitFor(".search .s-input", 3000); await page.sleep(300); });
await step("search-focused", async () => { await page.eval("document.querySelector('.s-input')?.focus()"); await page.sleep(200); });
await step("search-typed", async () => { await page.type("voice agent"); await page.key("Enter"); await page.waitFor(".s-row", 8000); await page.sleep(500); });
await step("search-result-detail", async () => { if (await page.waitFor(".s-row", 3000)) await page.tap(".s-row"); await page.sleep(900); });
await step("me", async () => { await page.goto(`${BASE}/me`); await page.waitFor(".me, main", 5000); await page.sleep(500); });
await step("me-scrolled", async () => { await page.eval("scrollBy(0, 1200)"); await page.sleep(300); });
await step("about", async () => { await page.goto(`${BASE}/about`); await page.sleep(800); });
await step("desktop-splash", async () => { await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await page.goto(`${BASE}/`); await page.waitFor(".fcard.splash"); await page.sleep(400); });
await step("desktop-feed", async () => { await page.key("ArrowUp"); await page.sleep(900); });

close();
const by = new Map<string, Issue[]>();
for (const i of page.issues) (by.get(i.where) ?? by.set(i.where, []).get(i.where)!).push(i);
let n = 0;
const hookish = (m: string) => /order of Hooks|Should have a queue|invalid-hook-call/.test(m);
for (const [where, list] of by) { console.log(`\n■ ${where}`); for (const i of list) { n++; console.log(`  ${i.kind.padEnd(9)} ${hookish(i.msg) && hmrSeen ? "(during Fast Refresh — rerun to confirm) " : ""}${i.msg.split("\n")[0].slice(0, 200)}`); } }
if (hmrSeen) console.log("\n⚠ a hot reload happened during this walk; rerun for a clean read");
console.log(`\n${n} findings · screenshots in qa-shots/`);
