import { writeFile } from 'node:fs/promises';

const closeAfter = process.argv.includes('--close');
const endpoint = process.argv.slice(2).find((argument) => argument.startsWith('http')) ?? 'http://127.0.0.1:9224';
const screenshotPath = process.argv.find((argument) => argument.startsWith('--screenshot='))?.slice('--screenshot='.length);

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page' && /Chronicle/i.test(target.title));
if (!page?.webSocketDebuggerUrl) throw new Error('Chronicle renderer was not found on the CDP endpoint.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let messageId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const diagnostic = await evaluate(`({ title: document.title, text: document.body.innerText.slice(0, 1600) })`);
  throw new Error(`Timed out while waiting for ${label}. Renderer state: ${JSON.stringify(diagnostic)}`);
}

async function click(selector) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Clickable element not found: ${selector}`);
}

await send('Runtime.enable');
await send('Page.enable');
await evaluate(`(() => {
  const dialog = document.querySelector('[data-dndpedia-dialog]');
  if (dialog?.open) dialog.close();
})()`);
await click('[data-nav-view="dndpedia"]');
await waitFor("!document.querySelector('[data-view-panel=\"dndpedia\"]')?.hidden && document.querySelectorAll('.dndpedia-table tbody tr').length > 0", 'D&Dpedie table');

const initial = await evaluate(`(() => ({
  heading: document.querySelector('.dndpedia-heading h1')?.textContent,
  rows: document.querySelectorAll('.dndpedia-table tbody tr').length,
  total: document.querySelector('.dndpedia-results header strong')?.textContent,
  sources: document.querySelector('.dndpedia-source-summary')?.textContent,
  columnHeaders: Array.from(document.querySelectorAll('.dndpedia-table th')).map((node) => node.textContent),
}))()`);

await evaluate(`(() => {
  const input = document.querySelector('[data-dndpedia-control="query"]');
  input.value = 'fireball';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 400));
await waitFor("document.querySelectorAll('.dndpedia-table tbody tr').length === 2 && document.querySelector('.dndpedia-results')?.getAttribute('aria-busy') === 'false'", 'debounced Fireball results');

const canonicalFocus = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('.dndpedia-id')).find((node) => node.textContent.includes('dnd5e:2024'));
  if (!(button instanceof HTMLElement)) return null;
  button.focus();
  button.click();
  return button.textContent;
})()`);
await waitFor("document.querySelector('[data-dndpedia-dialog]')?.open === true && document.querySelector('[data-dndpedia-detail-heading]')?.textContent === 'Fireball' && !document.querySelector('[data-dndpedia-dialog]')?.hasAttribute('aria-busy')", 'typed Fireball detail');

const layouts = [];
for (const [width, height, expectedFactColumns] of [[1366, 768, 4], [900, 700, 2], [640, 640, 1]]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const layout = await evaluate(`(() => {
    const dialog = document.querySelector('[data-dndpedia-dialog]');
    const facts = document.querySelector('.dndpedia-facts');
    const rect = dialog.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      fitsViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      noPageOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      factColumns: facts ? getComputedStyle(facts).gridTemplateColumns.split(' ').length : 0,
      detailScroll: ['auto', 'scroll'].includes(getComputedStyle(document.querySelector('.dndpedia-detail-scroll')).overflowY),
    };
  })()`);
  layout.expectedFactColumns = expectedFactColumns;
  layouts.push(layout);
}
if (layouts.some((layout) => !layout.fitsViewport || !layout.noPageOverflow || !layout.detailScroll
  || layout.factColumns !== layout.expectedFactColumns)) {
  throw new Error(`D&Dpedie responsive acceptance failed: ${JSON.stringify(layouts)}`);
}

await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await evaluate("window.dispatchEvent(new Event('resize'))");
const detail = await evaluate(`(() => ({
  canonicalId: document.querySelector('.dndpedia-source-box .is-code')?.textContent,
  facts: document.querySelectorAll('.dndpedia-facts > div').length,
  sections: document.querySelectorAll('.dndpedia-detail-grid section').length,
  source: document.querySelector('.dndpedia-source-box')?.textContent,
  related: document.querySelectorAll('[data-dndpedia-related]').length,
  headingFocused: document.activeElement === document.querySelector('[data-dndpedia-detail-heading]'),
}))()`);

if (screenshotPath) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
}

await click('[data-dndpedia-detail-action="close"]');
await waitFor("document.querySelector('[data-dndpedia-dialog]')?.open === false && document.activeElement?.classList.contains('dndpedia-id')", 'detail close and focus return');
const focusReturned = await evaluate(`document.activeElement?.textContent === ${JSON.stringify(canonicalFocus)}`);
if (!focusReturned) throw new Error('Closing the detail did not return focus to its canonical ID button.');

await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('.dndpedia-name')).find((node) => node.textContent === 'Fireball');
  button.click();
})()`);
await waitFor("document.querySelector('[data-dndpedia-dialog]')?.open === true && document.querySelector('.dndpedia-source-box .is-code')?.textContent === 'dnd5e:2014:Spell:fireball'", 'name and canonical detail resolver');
await click('[data-dndpedia-detail-action="close"]');

await evaluate(`(() => {
  const input = document.querySelector('[data-dndpedia-control="query"]');
  input.value = 'longsword';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 400));
await waitFor("document.querySelectorAll('.dndpedia-table tbody tr').length === 2 && document.querySelector('.dndpedia-results')?.getAttribute('aria-busy') === 'false'", 'Longsword results');
await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('.dndpedia-id')).find((node) => node.textContent.includes('dnd5e:2024'));
  button.click();
})()`);
await waitFor("document.querySelector('[data-dndpedia-detail-heading]')?.textContent === 'Longsword' && document.querySelectorAll('[data-dndpedia-related]').length >= 3", 'Longsword related definitions');
const relatedNavigation = await evaluate(`(() => {
  const button = document.querySelector('[data-dndpedia-related]');
  const target = button?.textContent;
  button?.click();
  return target;
})()`);
await waitFor("document.querySelector('[data-dndpedia-detail-action=\"back\"]:not(:disabled)') !== null && document.querySelector('[data-dndpedia-detail-heading]')?.textContent !== 'Longsword'", 'related definition stack');
const relatedTitle = await evaluate("document.querySelector('[data-dndpedia-detail-heading]')?.textContent");
await click('[data-dndpedia-detail-action="back"]');
await waitFor("document.querySelector('[data-dndpedia-detail-heading]')?.textContent === 'Longsword'", 'detail back navigation');

console.log(JSON.stringify({ initial, detail, layouts, relatedNavigation, relatedTitle, focusReturned, screenshotPath }));
if (closeAfter) {
  socket.send(JSON.stringify({ id: ++messageId, method: 'Browser.close', params: {} }));
  await new Promise((resolve) => setTimeout(resolve, 250));
}
socket.close();
