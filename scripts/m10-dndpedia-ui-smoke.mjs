import { writeFile } from 'node:fs/promises';

const closeAfter = process.argv.includes('--close');
const endpoint = process.argv.slice(2).find((argument) => argument.startsWith('http')) ?? 'http://127.0.0.1:9224';
const detailScreenshotPath = argumentValue('--detail-screenshot=') ?? argumentValue('--screenshot=');
const settingsScreenshotPath = argumentValue('--settings-screenshot=');

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

async function waitFor(expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const diagnostic = await evaluate(`({ title: document.title, text: document.body.innerText.slice(0, 2200) })`);
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

async function captureScreenshot(filePath) {
  if (!filePath) return;
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await evaluate(`(() => {
  const dialog = document.querySelector('[data-dndpedia-dialog]');
  if (dialog?.open) dialog.close();
  window.dispatchEvent(new Event('resize'));
})()`);

await click('[data-nav-view="dndpedia"]');
await waitFor(`!document.querySelector('[data-view-panel="dndpedia"]')?.hidden
  && document.querySelectorAll('.dndpedia-table tbody tr').length > 0
  && document.querySelector('[data-dndpedia-results]')?.getAttribute('aria-busy') === 'false'`, 'D&Dpedia table');

const initial = await evaluate(`(() => ({
  heading: document.querySelector('.dndpedia-heading h1')?.textContent,
  rows: document.querySelectorAll('.dndpedia-table tbody tr').length,
  total: document.querySelector('[data-dndpedia-result-count]')?.textContent,
  sources: document.querySelector('.dndpedia-source-summary')?.textContent,
  columnHeaders: Array.from(document.querySelectorAll('.dndpedia-table th')).map((node) => node.textContent?.trim()),
  visibleCanonicalIds: Array.from(document.querySelectorAll('.dndpedia-id, [data-developer-only]'))
    .filter((node) => !node.hidden && getComputedStyle(node).display !== 'none').length,
}))()`);
assert(initial.visibleCanonicalIds === 0, 'Canonical IDs are visible in the regular catalog UI', initial);
assert(initial.columnHeaders.every((heading) => !/canonical|\bID\b/i.test(heading)), 'A technical ID remains in a table heading', initial);

const focusAfterPause = await evaluate(`(async () => {
  const input = document.querySelector('[data-dndpedia-control="query"]');
  if (!(input instanceof HTMLInputElement)) return { found: false };
  window.__dndpediaSmokeSearchInput = input;
  input.focus();
  input.value = 'Boj';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    found: true,
    sameNode: document.querySelector('[data-dndpedia-control="query"]') === window.__dndpediaSmokeSearchInput,
    focused: document.activeElement === input,
    value: input.value,
    busy: document.querySelector('[data-dndpedia-results]')?.getAttribute('aria-busy'),
  };
})()`);
assert(focusAfterPause.found && focusAfterPause.sameNode && focusAfterPause.focused
  && focusAfterPause.value === 'Boj' && focusAfterPause.busy === 'false',
'Search focus was not preserved after the debounce pause', focusAfterPause);

await evaluate(`(() => {
  const input = document.querySelector('[data-dndpedia-control="query"]');
  input.value += 'ovník';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 400));
await waitFor(`document.querySelector('[data-dndpedia-results]')?.getAttribute('aria-busy') === 'false'
  && document.querySelectorAll('.dndpedia-table tbody tr').length > 0`, 'continued typing after debounce');
const focusAfterContinuation = await evaluate(`({
  sameNode: document.querySelector('[data-dndpedia-control="query"]') === window.__dndpediaSmokeSearchInput,
  focused: document.activeElement === window.__dndpediaSmokeSearchInput,
  value: window.__dndpediaSmokeSearchInput?.value,
  rows: document.querySelectorAll('.dndpedia-table tbody tr').length,
})`);
assert(focusAfterContinuation.sameNode && focusAfterContinuation.focused
  && focusAfterContinuation.value === 'Bojovník',
'Typing could not continue in the same focused search input', focusAfterContinuation);

await click('[data-dndpedia-action="clear-query"]');
await waitFor(`document.querySelector('[data-dndpedia-results]')?.getAttribute('aria-busy') === 'false'
  && document.querySelectorAll('.dndpedia-table tbody tr').length > 0`, 'cleared D&Dpedia search');

const refreshStarted = await evaluate(`(() => {
  const button = document.querySelector('[data-dndpedia-action="refresh-sources"]');
  button?.click();
  return {
    busy: button?.getAttribute('aria-busy'),
    disabled: button?.disabled,
    status: document.querySelector('[data-dndpedia-refresh-status]')?.textContent?.trim(),
  };
})()`);
assert(refreshStarted.busy === 'true' && refreshStarted.disabled && refreshStarted.status,
  'Source refresh did not expose its in-progress state', refreshStarted);
await waitFor(`document.querySelector('[data-dndpedia-action="refresh-sources"]')?.getAttribute('aria-busy') === 'false'
  && document.querySelector('[data-dndpedia-refresh-status]')?.textContent?.trim().length > 0`, 'source refresh result', 30_000);
const refreshResult = await evaluate(`(() => {
  const status = document.querySelector('[data-dndpedia-refresh-status]');
  return { text: status?.textContent?.trim(), className: status?.className, role: status?.getAttribute('role') };
})()`);
assert(/is-(success|error)/.test(refreshResult.className), 'Source refresh exposed neither a success nor an error result', refreshResult);

await click('[data-nav-view="settings"]');
await waitFor(`!document.querySelector('[data-view-panel="settings"]')?.hidden
  && document.querySelector('[data-language-settings-form]')`, 'language settings');
const originalLanguages = await evaluate(`(() => ({
  applicationLocale: document.querySelector('[name="applicationLocale"]')?.value,
  encyclopediaLocales: Array.from(document.querySelectorAll('[name="encyclopediaLocales"]:checked')).map((node) => node.value),
  supportedLocales: Array.from(document.querySelectorAll('[name="encyclopediaLocales"]')).map((node) => node.value),
  unavailableLabels: Array.from(document.querySelectorAll('.encyclopedia-language-option small'))
    .map((node) => node.textContent?.trim()).filter((text) => /není nainstalován|not installed/i.test(text)),
}))()`);
for (const locale of ['cs', 'en', 'de', 'es', 'fr', 'it']) {
  assert(originalLanguages.supportedLocales.includes(locale), `Missing supported encyclopedia locale ${locale}`, originalLanguages);
}
assert(originalLanguages.unavailableLabels.length >= 1, 'Languages without installed content are not identified', originalLanguages);
await captureScreenshot(settingsScreenshotPath);

await evaluate(`(() => {
  const form = document.querySelector('[data-language-settings-form]');
  form.querySelector('[name="applicationLocale"]').value = 'en';
  form.querySelectorAll('[name="encyclopediaLocales"]').forEach((input) => { input.checked = input.value === 'de'; });
  form.requestSubmit();
})()`);
await waitFor(`document.querySelector('[data-nav-view="settings"] .nav-label')?.textContent === 'Settings'
  && document.querySelector('.language-settings h2')?.textContent === 'Application and encyclopedia'`, 'immediate English UI switch');

await click('[data-nav-view="dndpedia"]');
await waitFor(`!document.querySelector('[data-view-panel="dndpedia"]')?.hidden
  && document.querySelectorAll('.dndpedia-table tbody tr').length > 0`, 'English D&Dpedia after locale change');
await evaluate(`(() => {
  const input = document.querySelector('[data-dndpedia-control="query"]');
  input.focus();
  input.value = 'Fireball';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 400));
await waitFor(`document.querySelector('[data-dndpedia-results]')?.getAttribute('aria-busy') === 'false'
  && document.querySelectorAll('.dndpedia-table tbody tr').length >= 1`, 'Fireball search');

const detailOrigin = await evaluate(`(() => {
  const button = document.querySelector('.dndpedia-name');
  if (!(button instanceof HTMLElement)) return null;
  window.__dndpediaSmokeDetailOrigin = button;
  button.click();
  return button.textContent;
})()`);
assert(detailOrigin, 'Could not open a rule detail by its visible name');
await waitFor(`document.querySelector('[data-dndpedia-dialog]')?.open === true
  && document.querySelector('[data-dndpedia-detail-heading]')?.textContent === 'Fireball'
  && document.querySelector('[data-dndpedia-locale-fallback]')
  && document.querySelector('[data-dndpedia-detail-locale="en"]')?.getAttribute('aria-pressed') === 'true'
  && !document.querySelector('[data-dndpedia-dialog]')?.hasAttribute('aria-busy')`, 'German preference with explicit English fallback');

await click('[data-dndpedia-detail-locale="cs"]');
await waitFor(`document.querySelector('[data-dndpedia-detail-heading]')?.textContent !== 'Fireball'
  && !document.querySelector('[data-dndpedia-locale-fallback]')
  && document.querySelector('[data-dndpedia-detail-locale="cs"]')?.getAttribute('aria-pressed') === 'true'`, 'temporary Czech card override');
await click('[data-dndpedia-detail-locale="en"]');
await waitFor(`document.querySelector('[data-dndpedia-detail-heading]')?.textContent === 'Fireball'
  && document.querySelector('[data-dndpedia-detail-locale="en"]')?.getAttribute('aria-pressed') === 'true'`, 'temporary English original override');

const detail = await evaluate(`(() => ({
  heading: document.querySelector('[data-dndpedia-detail-heading]')?.textContent,
  facts: document.querySelectorAll('.dndpedia-facts > div').length,
  sections: document.querySelectorAll('.dndpedia-detail-grid section').length,
  source: document.querySelector('.dndpedia-source-box')?.textContent,
  englishPressed: document.querySelector('[data-dndpedia-detail-locale="en"]')?.getAttribute('aria-pressed'),
  copyIdVisible: Boolean(document.querySelector('[data-dndpedia-detail-action="copy"]')),
  canonicalIdVisible: Boolean(document.querySelector('.dndpedia-source-box .is-code, [data-developer-only]')),
}))()`);
assert(detail.facts > 0 && detail.sections > 0, 'The detail is missing structured content', detail);
assert(detail.englishPressed === 'true', 'The English original is not marked as selected', detail);
assert(!detail.copyIdVisible && !detail.canonicalIdVisible, 'Developer-only IDs are visible in the detail', detail);

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
assert(!layouts.some((layout) => !layout.fitsViewport || !layout.noPageOverflow || !layout.detailScroll
  || layout.factColumns !== layout.expectedFactColumns), 'D&Dpedia responsive acceptance failed', layouts);

await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await evaluate("window.dispatchEvent(new Event('resize'))");
await captureScreenshot(detailScreenshotPath);
await click('[data-dndpedia-detail-action="close"]');
await waitFor(`document.querySelector('[data-dndpedia-dialog]')?.open === false
  && document.activeElement === window.__dndpediaSmokeDetailOrigin`, 'detail close and focus return');

await click('[data-nav-view="settings"]');
await waitFor(`document.querySelector('[data-language-settings-form]')`, 'language settings restore');
await evaluate(`(() => {
  const original = ${JSON.stringify(originalLanguages)};
  const form = document.querySelector('[data-language-settings-form]');
  form.querySelector('[name="applicationLocale"]').value = original.applicationLocale;
  form.querySelectorAll('[name="encyclopediaLocales"]').forEach((input) => {
    input.checked = original.encyclopediaLocales.includes(input.value);
  });
  form.requestSubmit();
})()`);
const restoredSettingsLabel = originalLanguages.applicationLocale === 'en' ? 'Settings' : 'Nastavení';
await waitFor(`document.querySelector('[data-nav-view="settings"] .nav-label')?.textContent === ${JSON.stringify(restoredSettingsLabel)}`,
  'restored language preferences');

console.log(JSON.stringify({
  initial,
  focusAfterPause,
  focusAfterContinuation,
  refreshStarted,
  refreshResult,
  originalLanguages,
  detail,
  layouts,
  detailScreenshotPath,
  settingsScreenshotPath,
}));
if (closeAfter) {
  socket.send(JSON.stringify({ id: ++messageId, method: 'Browser.close', params: {} }));
  await new Promise((resolve) => setTimeout(resolve, 250));
}
socket.close();

function argumentValue(prefix) {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
