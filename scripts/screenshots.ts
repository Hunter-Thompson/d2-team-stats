// Captures each dashboard section to docs/screenshots/ for the README.
//
//   pnpm screenshots                 uses the view in $TEAM (default 2) at http://localhost:5173
//   TEAM=3 URL=http://localhost:3001 pnpm screenshots
//
// Drives headless Chrome over the DevTools protocol with Node's built-in WebSocket, so it needs
// no extra packages. Set CHROME to the browser binary if it isn't in the default macOS location.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.URL ?? "http://localhost:5173";
const TEAM = process.env.TEAM ?? "2";
const PORT = 9333;
const WIDTH = 1280;

// [file name, heading of the card to capture, capture the whole row the card sits in?]
const SECTIONS: [string, string, boolean][] = [
  ["insights", "Key insights", false],
  ["players", "Players", false],
  ["roles-lineups", "Roles", true],
  ["hero-pool", "Hero pool", false],
  ["combos-duos", "Hero combos", true],
  ["enemy-heroes", "Enemy heroes", false],
  ["what-changes", "What changes when we lose", false],
  ["comfort", "Comfort picks", false],
  ["draft", "Draft composition", false],
  ["when-we-win", "When we win", false],
  ["sessions", "Sessions and timing", false],
  ["trend", "Win rate over time", false],
  ["recent", "Recent matches", false],
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Page {
  private ws: WebSocket;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      const waiter = msg.id === undefined ? undefined : this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id!);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    });
  }

  static async open(wsUrl: string) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Page(ws);
  }

  send<T = unknown>(method: string, params: object = {}) {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return r.result.value;
  }

  async waitFor(expression: string, timeoutMs = 30_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.eval<boolean>(expression)) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async capture(file: string, clip: { x: number; y: number; width: number; height: number }) {
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { ...clip, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, `${file}.png`), Buffer.from(data, "base64"));
    console.log(`  docs/screenshots/${file}.png`);
  }

  close() {
    this.ws.close();
  }
}

// Page-side helper: the document-relative box of the card with a given heading.
const boxOf = (heading: string, row: boolean, pad = 12) => `(() => {
  const h = [...document.querySelectorAll("h2")].find((el) => el.textContent.trim() === ${JSON.stringify(heading)});
  if (!h) return null;
  const el = ${row ? `h.closest(".grid") ?? h.closest(".card")` : `h.closest(".card")`};
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top + scrollY - ${pad}), width: r.width + ${pad * 2}, height: r.height + ${pad * 2} };
})()`;

async function render(page: Page, opts: { width: number; height: number; mobile: boolean; scheme: "dark" | "light" }) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: opts.mobile ? 2 : 1,
    mobile: opts.mobile,
  });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opts.scheme }] });
  await page.send("Page.navigate", { url: `${BASE_URL}/?team=${TEAM}` });
  await page.waitFor(`document.querySelector(".kpis") !== null && document.querySelectorAll("h2").length > 8`);
  // Hero portraits load lazily; load them all now, then wait for Valve's CDN.
  await page.eval(`document.querySelectorAll("img[loading=lazy]").forEach((img) => (img.loading = "eager"))`);
  await page.waitFor(`[...document.images].every((img) => img.complete)`);
  await sleep(500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "d2ts-chrome-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},900`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    let target: { webSocketDebuggerUrl: string } | null = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
        .then((r) => (r.ok ? (r.json() as Promise<{ webSocketDebuggerUrl: string }>) : null))
        .catch(() => null);
    }
    if (!target) throw new Error("Chrome didn't start. Set CHROME to the browser binary.");
    const page = await Page.open(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");

    console.log(`Capturing view ${TEAM} from ${BASE_URL}`);
    await render(page, { width: WIDTH, height: 900, mobile: false, scheme: "dark" });

    // Overview: header, filters and headline numbers.
    const overview = await page.eval<number>(`(() => { const k = document.querySelector(".kpis").getBoundingClientRect(); return k.bottom + scrollY + 16; })()`);
    await page.capture("overview", { x: 0, y: 0, width: WIDTH, height: overview });

    for (const [file, heading, row] of SECTIONS) {
      const box = await page.eval<{ x: number; y: number; width: number; height: number } | null>(boxOf(heading, row));
      if (box) await page.capture(file, box);
      else console.warn(`  skipped ${file}: no "${heading}" card`);
    }

    // The team dialog, showing detected party mates, in a window tall enough to fit it.
    await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1500, deviceScaleFactor: 1, mobile: false });
    await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Team").click()`);
    await page.waitFor(`document.querySelector("dialog.team-dialog")?.open === true`);
    await sleep(400);
    const dialog = await page.eval<{ x: number; y: number; width: number; height: number }>(`(() => {
      const r = document.querySelector("dialog.team-dialog").getBoundingClientRect();
      return { x: r.left - 16, y: r.top + scrollY - 16, width: r.width + 32, height: r.height + 32 };
    })()`);
    await page.capture("team", dialog);

    // Light theme and phone layout.
    await render(page, { width: WIDTH, height: 900, mobile: false, scheme: "light" });
    const lightBottom = await page.eval<number>(`(() => { const h = [...document.querySelectorAll("h2")].find((el) => el.textContent.trim() === "Key insights"); return h.closest(".card").getBoundingClientRect().bottom + scrollY + 16; })()`);
    await page.capture("overview-light", { x: 0, y: 0, width: WIDTH, height: lightBottom });

    await render(page, { width: 390, height: 844, mobile: true, scheme: "dark" });
    await page.capture("mobile", { x: 0, y: 0, width: 390, height: 1600 });

    page.close();
  } finally {
    // Wait for Chrome to exit before deleting its profile, or the delete races its last writes.
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
