from __future__ import annotations

import os
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.request import urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "assets" / "scribepad-review-demo.gif"
SAMPLE = ROOT / "sample.md"
BASE_URL = "http://localhost:5173"
GIF_W = 960
GIF_H = 540


CAPTURE_JS = r"""
import { createRequire } from 'node:module';

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('playwright');

const outDir = process.argv[2];
let index = 0;

async function shot(page, hold = 4) {
  const target = `${outDir}/${String(index).padStart(3, '0')}.png`;
  await page.screenshot({ path: target });
  index += 1;
  for (let i = 1; i < hold; i += 1) {
    await page.screenshot({ path: `${outDir}/${String(index).padStart(3, '0')}.png` });
    index += 1;
  }
}

async function createAnnotation(page, substring) {
  const readerBox = await page.locator('.reader').boundingBox();
  if (!readerBox) throw new Error('reader box not found');
  await page.locator('.reader').dispatchEvent('pointerdown', {
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    clientX: readerBox.x + 10,
    clientY: readerBox.y + 10,
    bubbles: true,
  });
  await page.evaluate((needle) => {
    const root = document.querySelector('.reader');
    if (!root) throw new Error('reader not found');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let target = null;
    let start = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.data;
      const idx = value.indexOf(needle);
      if (idx >= 0) {
        target = node;
        start = idx;
        break;
      }
    }
    if (!target) throw new Error(`text not found: ${needle}`);
    const range = document.createRange();
    range.setStart(target, start);
    range.setEnd(target, start + needle.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, substring);
  await page.evaluate(({ clientX, clientY }) => {
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerType: 'mouse',
        pointerId: 1,
        clientX,
        clientY,
        bubbles: true,
      }),
    );
  }, { clientX: readerBox.x + 40, clientY: readerBox.y + 20 });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

await page.route('**/api/rewrite', async (route) => {
  const body = route.request().postDataJSON();
  const results = (body.items ?? []).map((item) => ({
    id: item.id,
    rewritten: item.selection.replace('session token', 'opaque server-side session ID'),
  }));
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results }),
  });
});

await page.goto('http://localhost:5173');
await page.locator('.reader p').first().waitFor({ state: 'visible' });
await shot(page, 8);

await page.locator('.review-point-check').first().click();
await page.locator('.review-point.locked').first().waitFor({ state: 'visible' });
await shot(page, 7);

await page.getByRole('tab', { name: /Comments/ }).click();
await shot(page, 5);

await createAnnotation(page, 'session token');
await page.locator('.anno-card').first().waitFor({ state: 'visible' });
await shot(page, 8);

const input = page.locator('.anno-card textarea').first();
await input.fill('Make the session handling explicit');
await shot(page, 4);
await input.press('Enter');
await page.locator('.anno-card.deciding').first().waitFor({ state: 'visible' });
await shot(page, 8);

await page.locator('.anno-card.deciding').first().click();
await page.locator('.diff-modal').waitFor({ state: 'visible' });
await shot(page, 10);

await page.locator('.diff-modal button.primary', { hasText: '接受' }).first().click();
await page.locator('.diff-modal').waitFor({ state: 'hidden' });
await shot(page, 8);

await browser.close();
"""


def wait_for_server(process: subprocess.Popen[bytes], log_path: Path) -> None:
    deadline = time.time() + 60
    while time.time() < deadline:
        if process.poll() is not None:
            log = log_path.read_text(encoding="utf-8", errors="replace")
            raise RuntimeError(f"server exited before becoming ready:\n{log}")
        try:
            with urlopen(BASE_URL, timeout=1) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(0.5)
    log = log_path.read_text(encoding="utf-8", errors="replace")
    raise RuntimeError(f"server did not become ready: {BASE_URL}\n{log}")


def start_server(state_dir: Path, log_path: Path) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env.update(
        {
            "XDG_CONFIG_HOME": str(state_dir / "config"),
            "XDG_STATE_HOME": str(state_dir / "state"),
            "XDG_RUNTIME_DIR": str(state_dir / "runtime"),
        }
    )
    for child in ["config", "state", "runtime"]:
        (state_dir / child).mkdir(parents=True, exist_ok=True)
    log_file = log_path.open("wb")
    return subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=ROOT,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )


def stop_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=8)


def build_gif(frame_dir: Path) -> None:
    frames = []
    for frame_path in sorted(frame_dir.glob("*.png")):
        frame = Image.open(frame_path).convert("RGB")
        frame = frame.resize((GIF_W, GIF_H), Image.Resampling.LANCZOS)
        frames.append(frame)
    if not frames:
        raise RuntimeError("no frames captured")
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=90,
        loop=0,
        optimize=True,
    )


def main() -> None:
    sample_before = SAMPLE.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="scribepad-readme-demo-") as tmp:
        tmp_dir = Path(tmp)
        state_dir = tmp_dir / "xdg"
        frame_dir = tmp_dir / "frames"
        frame_dir.mkdir(parents=True)
        capture_script = tmp_dir / "capture.mjs"
        capture_script.write_text(CAPTURE_JS, encoding="utf-8")
        log_path = tmp_dir / "dev-server.log"
        server = start_server(state_dir, log_path)
        try:
            wait_for_server(server, log_path)
            subprocess.run(
                ["node", str(capture_script), str(frame_dir)],
                cwd=ROOT,
                check=True,
            )
            build_gif(frame_dir)
        finally:
            stop_server(server)
            SAMPLE.write_text(sample_before, encoding="utf-8")
            shutil.rmtree(state_dir, ignore_errors=True)
    print(OUT)


if __name__ == "__main__":
    main()
