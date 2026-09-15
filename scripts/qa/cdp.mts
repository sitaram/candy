/**
 * Minimal Chrome DevTools Protocol driver over Node's built-in WebSocket. No Playwright (sandbox has
 * no network to install it); Chromium comes from the Playwright cache that is already on disk.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const CHROME = `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export interface Issue { kind: "console" | "pageerror" | "network" | "visual" | "a11y"; where: string; msg: string }

export class Page {
  private id = 0; private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  private listeners = new Map<string, ((p: Record<string, unknown>) => void)[]>();
  issues: Issue[] = []; screen = "";
  constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== undefined) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (!p) return; m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
      else for (const l of this.listeners.get(m.method) ?? []) l(m.params);
    };
  }
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res: res as (v: unknown) => void, rej }));
  }
  on(method: string, f: (p: Record<string, unknown>) => void) { (this.listeners.get(method) ?? this.listeners.set(method, []).get(method)!).push(f); }

  async init(w = 390, h = 844) {
    await this.send("Page.enable"); await this.send("Runtime.enable"); await this.send("Network.enable"); await this.send("Log.enable"); await this.send("DOM.enable"); await this.send("CSS.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await this.send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
    this.on("Runtime.consoleAPICalled", (p) => { const t = p.type as string; if (t === "error" || t === "warning") this.issues.push({ kind: "console", where: this.screen, msg: (p.args as { value?: unknown; description?: string }[]).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300) }); });
    this.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails as { exception?: { description?: string }; text?: string; url?: string; stackTrace?: { callFrames: { url: string }[] } };
      const msg = String(d.exception?.description ?? d.text);
      const src = d.url ?? d.stackTrace?.callFrames?.[0]?.url ?? "";
      // Next's dev runtime evals source maps; the CSP blocks it. Not a product bug — skip unless it came from our code.
      if (/unsafe-eval/.test(msg) && !/\/src\//.test(src)) return;
      this.issues.push({ kind: "pageerror", where: this.screen, msg: msg.slice(0, 300) });
    });
    this.on("Network.responseReceived", (p) => { const r = p.response as { status: number; url: string }; if (r.status >= 400 && !/\/api\/err$/.test(r.url)) this.issues.push({ kind: "network", where: this.screen, msg: `${r.status} ${r.url.replace(/^https?:\/\/[^/]+/, "")}` }); });
    this.on("Network.loadingFailed", (p) => { if (!(p.canceled as boolean)) this.issues.push({ kind: "network", where: this.screen, msg: `failed ${p.errorText}` }); });
  }
  async goto(url: string) { await this.send("Page.navigate", { url }); await this.waitIdle(); }
  async eval<T = unknown>(expr: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
  async waitIdle(ms = 600) { await this.sleep(ms); for (let i = 0; i < 20; i++) { if (await this.eval<boolean>("document.readyState === 'complete'")) break; await this.sleep(100); } }
  async waitFor(sel: string, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await this.eval<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; await this.sleep(80); } return false; }
  async tap(sel: string) {
    const b = await this.eval<{ x: number; y: number } | null>(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (!b) throw new Error(`tap: no ${sel}`);
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x, y: b.y }] });
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await this.sleep(120);
  }
  async swipe(dir: "up" | "down" | "left" | "right", x = 195, y = 500, dist = 260) {
    const dx = dir === "left" ? -dist : dir === "right" ? dist : 0, dy = dir === "up" ? -dist : dir === "down" ? dist : 0;
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) { await this.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] }); await this.sleep(16); }
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await this.sleep(700);
  }
  async type(text: string) { await this.send("Input.insertText", { text }); }
  async key(key: string, code = key) { await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: key === "Enter" ? 13 : key === "Escape" ? 27 : 0 }); await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code }); }
  async shot(name: string) {
    mkdirSync("qa-shots", { recursive: true });
    const r = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    writeFileSync(`qa-shots/${name}.png`, Buffer.from(r.data, "base64"));
    return `qa-shots/${name}.png`;
  }
}

export async function launch(): Promise<{ page: Page; close: () => void }> {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc: ChildProcess = spawn(CHROME, [`--remote-debugging-port=${port}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=/tmp/candy-qa-${port}`, "about:blank"], { stdio: "ignore" });
  let list: { webSocketDebuggerUrl: string; type: string }[] = [];
  for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.some((t) => t.type === "page")) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 100)); }
  const t = list.find((x) => x.type === "page"); if (!t) { proc.kill(); throw new Error("chrome did not start"); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  const page = new Page(ws); await page.init();
  return { page, close: () => { ws.close(); proc.kill(); } };
}
