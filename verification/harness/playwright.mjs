// verification/harness/playwright.mjs — Step 9 pixel verification.
//
// Boots a static HTTP server, drives the v0.2 app via Playwright
// (with the mock-tauri shim so it runs in plain Chromium), captures
// one screenshot per design state, and writes them under
// verification/screenshots/. Run via:
//   node verification/harness/playwright.mjs
//
// Then for each screenshot run matrix MCP's describe_images against
// the matching SVG (in verification/*.svg) and compare the extracted
// labels + bounding boxes. Anything off by >5px or missing a label
// goes into verification/FINAL-REPORT.md.
//
// States covered (all 20 SVGs would need the full app + a DB; for
// v0.2-alpha-22 we focus on the ones that render with the mock-tauri
// shim — empty / error / modal / boot states):
//
//   06 empty-first-use       → first-run welcome card (Phase B3)
//   07 empty-no-network      → no-network card (Phase B3)
//   08 empty-no-sessions     → no-sessions welcome (Phase B3 / covered by 06)
//   16 shortcuts-modal       → Ctrl+/ triggered (Phase B1)
//   17 splash-screen         → boot overlay (Phase B2)
//   18 error-states block    → error block card (Phase B4)
//   18 error-states inline   → inline error bubble (Phase B4)
//   18 fatal-banner          → fatal banner (Phase B4)

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "..", "dist");
const HARNESS = __dirname;
const SHOTS = path.resolve(__dirname, "..", "screenshots");

// MIME lookup for static server (the dist uses a handful of
// uncommon extensions).
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".map": "application/json",
};

// Prepend the mock-tauri shim to every HTML response so the page
// installs `window.__TAURI_INTERNALS__` BEFORE the bundle loads.
function withMockTauri(html) {
  const shim = fs.readFileSync(path.join(HARNESS, "mock-tauri.js"), "utf8");
  // Inline-install the test hook so the debug-test-hooks.ts imports
  // can populate it. Without this the bundle sees __HERMES_TEST__
  // as undefined and skips the wire-up.
  const hook = "<script>window.__HERMES_TEST__ = window.__HERMES_TEST__ || {};</script>";
  return html.replace("<head>", `<head>${hook}<script>${shim}</script>`);
}

function serve(port) {
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    const filePath =
      url === "/" ? path.join(DIST, "index.html") : path.join(DIST, url);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end(`not found: ${url}`);
        return;
      }
      const ext = path.extname(filePath);
      const mime = MIME[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      if (ext === ".html") {
        res.end(withMockTauri(data.toString("utf8")));
      } else {
        res.end(data);
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(port, () => resolve(server)),
  );
}

async function shot(page, name, viewport = { width: 1544, height: 1004 }) {
  await page.setViewportSize(viewport);
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  → ${path.relative(process.cwd(), file)}`);
  return file;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const port = 8765;
  console.log(`Starting static server on http://localhost:${port}`);
  const server = await serve(port);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1544, height: 1004 },
  });
  const page = await context.newPage();

  // ── 17 splash screen ──────────────────────────────────────────────
  // Splash hides the moment main.ts finishes mountChatView(). To
  // actually capture it we need to slow the boot. Pass ?freezeSplash
  // query param so main.ts skips the splashStore.hide() call.
  console.log("\n[17] splash-screen");
  await page.goto(`http://localhost:${port}/?freezeSplash=1`, { waitUntil: "domcontentloaded" });
  // Wait for the splash to mount + render (Preact needs a tick).
  await page.waitForSelector(".splash-screen", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300); // let CSS transitions settle
  await shot(page, "17-splash-screen");
  // Reload without the freeze param for the rest of the screenshots.
  await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded" });
  // Wait for the chat view to mount + the test hook to attach.
  await page.waitForFunction(() => window.__HERMES_TEST__?.__ready__, { timeout: 5000 }).catch(() => {});

  // ── 06 first-run welcome ──────────────────────────────────────────
  // After splash hides, the chat view renders the first-run card
  // because session_list returns [] (mock-tauri) and connection
  // starts as 'connecting' which mirrors to 'offline'.
  // We need to set the store to online + hasSessions=false to get
  // the first-run card (otherwise no-network wins).
  console.log("\n[06] empty-first-use");
  await page.evaluate(() => {
    if (window.__HERMES_TEST__) {
      window.__HERMES_TEST__.setConnectionStatus("online");
      window.__HERMES_TEST__.setHasSessions(false);
    }
  });
  await page.waitForSelector(".first-run-welcome", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(100); // let any rAF settle
  await shot(page, "06-first-run-welcome");

  // ── 07 no-network ─────────────────────────────────────────────────
  console.log("\n[07] empty-no-network");
  await page.evaluate(() => {
    if (window.__HERMES_TEST__) {
      window.__HERMES_TEST__.setConnectionStatus("offline");
    }
  });
  await page.waitForSelector(".no-network-card", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(100);
  await shot(page, "07-empty-no-network");

  // ── 16 shortcuts modal ────────────────────────────────────────────
  // The window keydown listener is wired in main.ts but Playwright's
  // synthetic Ctrl+/ sometimes doesn't produce e.key === '/'. Use
  // the test hook to toggle the modal directly — this proves the
  // modal renders identically regardless of which trigger fires.
  console.log("\n[16] shortcuts-modal");
  await page.evaluate(() => {
    if (window.__HERMES_TEST__) {
      window.__HERMES_TEST__.openShortcutsModal();
    }
  });
  await page.waitForSelector(".modal-shortcuts", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(100);
  await shot(page, "16-shortcuts-modal");
  // Close the modal so it doesn't overlap the error screenshots.
  await page.evaluate(() => {
    if (window.__HERMES_TEST__) {
      window.__HERMES_TEST__.openShortcutsModal();
    }
  });

  // ── 18 error block + fatal banner ─────────────────────────────────
  console.log("\n[18] error-states");
  await page.evaluate(() => {
    if (window.__HERMES_TEST__) {
      window.__HERMES_TEST__.setConnectionStatus("online");
      window.__HERMES_TEST__.setHasSessions(true);
      window.__HERMES_TEST__.setError("网络连接超时，请检查后重试");
      window.__HERMES_TEST__.setFatal("DB 迁移失败");
    }
  });
  await page.waitForSelector(".error-block", { timeout: 3000 }).catch(() => {});
  await page.waitForSelector(".fatal-banner", { timeout: 3000 }).catch(() => {});
  await shot(page, "18-error-block-and-fatal");

  // ── 18 inline error bubble (with messages present) ────────────────
  console.log("\n[18] error-inline");
  await page.evaluate(() => {
    if (window.__HERMES_TEST__) {
      window.__HERMES_TEST__.clearFatal();
      window.__HERMES_TEST__.appendMessage("user", "你好");
      window.__HERMES_TEST__.appendMessage("assistant", "你好！有什么可以帮你的？");
      window.__HERMES_TEST__.setError("网络中断");
    }
  });
  await page.waitForSelector(".message.error", { timeout: 3000 }).catch(() => {});
  await shot(page, "18-error-inline-bubble");

  await browser.close();
  server.close();
  console.log(`\nDone. Screenshots in ${path.relative(process.cwd(), SHOTS)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});