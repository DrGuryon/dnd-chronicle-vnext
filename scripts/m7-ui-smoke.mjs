const closeAfter = process.argv.includes('--close');
const endpoint = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'http://127.0.0.1:9223';

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
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const diagnostic = await evaluate(`({ title: document.title, text: document.body.innerText.slice(0, 1200) })`);
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

async function setValue(selector, value) {
  const changed = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Form field not found: ${selector}`);
}

function visibleText(text) {
  return `Array.from(document.querySelectorAll('body *')).some((element) => !element.hidden && element.textContent?.includes(${JSON.stringify(text)}))`;
}

await send('Runtime.enable');
const firstRun = await evaluate("document.querySelector('[data-view-panel=\"overview\"]')?.textContent?.includes('Začněte první kampaň') === true");
if (firstRun) {
  await click('[data-action="create-campaign"]');
  await waitFor("document.querySelector('[data-form-dialog]')?.open === true", 'campaign dialog');
  await setValue('[data-form-dialog] [name="name"]', 'Ravenford');
  await click('[data-form-dialog] [data-dialog-submit]');

  await waitFor(`${visibleText('Ravenford')} && ${visibleText('Nejdřív vytvořte hráčskou postavu.')}`, 'campaign Play workspace');
  await click('[data-view-panel="play"] [data-action="create-character"]');
  await waitFor("document.querySelector('[data-form-dialog]')?.open === true", 'character dialog');
  await setValue('[data-form-dialog] [name="name"]', 'Arqos');
  await setValue('[data-form-dialog] [name="species"]', 'Human');
  await setValue('[data-form-dialog] [name="className"]', 'Fighter');
  await click('[data-form-dialog] [data-editor-submit]');

  await waitFor(`${visibleText('Arqos')} && ${visibleText('Vytvořte první konverzaci.')}`, 'active character and cockpit');
  await click('[data-view-panel="play"] [data-action="create-conversation"]');
  await waitFor("document.querySelector('[data-form-dialog]')?.open === true", 'conversation dialog');
  await setValue('[data-form-dialog] [name="title"]', 'Začátek');
  await click('[data-form-dialog] [data-dialog-submit]');
}

const startupActiveView = await evaluate("document.querySelector('[data-nav-view].is-active')?.dataset.navView ?? null");
const continueFromOverview = await evaluate(`document.querySelector('[data-nav-view="overview"]')?.classList.contains('is-active')
  && document.querySelector('[data-view-panel="overview"] [data-action="open-campaign"]') !== null`);
if (continueFromOverview) await click('[data-view-panel="overview"] [data-action="open-campaign"]');

await waitFor(`${visibleText('Ravenford')} && ${visibleText('Arqos')} && ${visibleText('Začátek')} && ${visibleText('AI není nakonfigurovaná.')}`, 'playable workspace');
await click('[data-nav-view="settings"]');
await waitFor("!document.querySelector('[data-view-panel=\"settings\"]')?.hidden", 'Settings view');
await click('[data-nav-view="library"]');
await waitFor("!document.querySelector('[data-view-panel=\"library\"]')?.hidden && document.querySelector('[data-view-panel=\"library\"]')?.textContent?.includes('Arqos')", 'Library view');
await click('[data-view-panel="library"] [data-entity-kind="Character"]');
await waitFor("document.querySelector('[data-entity-card-dialog]')?.open === true && document.querySelector('[data-card-action=\"edit-character\"]') !== null", 'Character Entity Card edit action');
await click('[data-card-action="edit-character"]');
await waitFor("document.querySelector('[data-form-dialog]')?.open === true && document.querySelector('[data-form-dialog] [name=\"name\"]')?.value === 'Arqos'", 'Character editor from Entity Card');
await click('[data-form-dialog] [data-editor-cancel]');
await click('[data-nav-view="campaigns"]');
await waitFor("!document.querySelector('[data-view-panel=\"campaigns\"]')?.hidden && document.querySelector('[data-view-panel=\"campaigns\"]')?.textContent?.includes('Ravenford')", 'Campaigns view');
await click('[data-nav-view="play"]');
await waitFor("!document.querySelector('[data-view-panel=\"play\"]')?.hidden", 'restored Play view');

const summary = await evaluate(`(() => ({
  startupActiveView: ${JSON.stringify(startupActiveView)},
  activeView: document.querySelector('[data-nav-view].is-active')?.dataset.navView,
  campaign: document.querySelector('[data-view-panel="play"]')?.textContent?.includes('Ravenford'),
  character: document.querySelector('[data-cockpit]')?.textContent?.includes('Arqos'),
  conversation: document.querySelector('[data-view-panel="play"]')?.textContent?.includes('Začátek'),
  missingKeyCta: document.querySelector('[data-ai-chat]')?.textContent?.includes('AI není nakonfigurovaná.'),
}))()`);

const sizes = [
  [2560, 1440], [1920, 1080], [1600, 900], [1366, 768],
  [1280, 720], [1000, 700], [800, 600],
];
const layouts = [];
for (const [width, height] of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize'))");
  await new Promise((resolve) => setTimeout(resolve, 75));
  layouts.push(await evaluate(`(() => {
    const shell = document.querySelector('[data-app-shell]');
    const workspace = document.querySelector('.workspace-main');
    const composer = document.querySelector('.chat-composer');
    const cockpit = document.querySelector('[data-cockpit-panel]');
    const restore = document.querySelector('[data-action="show-cockpit"]');
    const sidebarScroll = document.querySelector('.sidebar-scroll');
    const rect = (element) => element?.getBoundingClientRect();
    const composerRect = rect(composer);
    const cockpitStyle = cockpit ? getComputedStyle(cockpit) : null;
    const restoreStyle = restore ? getComputedStyle(restore) : null;
    return {
      width: innerWidth,
      height: innerHeight,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1 && shell.scrollWidth <= shell.clientWidth + 1,
      workspaceOwnsScroll: getComputedStyle(workspace).overflowY === 'auto',
      composerReachable: composerRect.top >= 0 && composerRect.bottom <= innerHeight + 1,
      sidebarSafe: sidebarScroll.scrollHeight <= sidebarScroll.clientHeight + 1 || ['auto', 'scroll'].includes(getComputedStyle(sidebarScroll).overflowY),
      cockpitMode: cockpitStyle.display !== 'none' ? (cockpit.classList.contains('is-drawer-open') ? 'drawer' : 'panel') : (restoreStyle.display !== 'none' ? 'hidden-with-restore' : 'hidden'),
      cockpitOwnsScroll: getComputedStyle(document.querySelector('.cockpit-scroll')).overflowY === 'auto',
    };
  })()`));
}

for (const layout of layouts) {
  const expectedCockpit = layout.width <= 1100 ? 'hidden-with-restore' : 'panel';
  if (!layout.noHorizontalOverflow || !layout.workspaceOwnsScroll || !layout.composerReachable
    || !layout.sidebarSafe || !layout.cockpitOwnsScroll || layout.cockpitMode !== expectedCockpit) {
    throw new Error(`Layout acceptance failed: ${JSON.stringify(layout)}`);
  }
}

const highDpi = [];
for (const deviceScaleFactor of [1.25, 1.5]) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor, mobile: false });
  await evaluate("window.dispatchEvent(new Event('resize'))");
  highDpi.push(await evaluate(`(() => {
    const composer = document.querySelector('.chat-composer').getBoundingClientRect();
    return {
      deviceScaleFactor: ${deviceScaleFactor},
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      composerReachable: composer.top >= 0 && composer.bottom <= innerHeight + 1,
      cockpitRestoreReachable: getComputedStyle(document.querySelector('[data-action="show-cockpit"]')).display !== 'none',
    };
  })()`));
}
if (highDpi.some((item) => !item.noHorizontalOverflow || !item.composerReachable || !item.cockpitRestoreReachable)) {
  throw new Error(`High-DPI acceptance failed: ${JSON.stringify(highDpi)}`);
}

await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1.5, mobile: false });
await evaluate("window.dispatchEvent(new Event('resize'))");
await click('[data-view-panel="play"] [data-action="create-character"]');
await waitFor("document.querySelector('[data-form-dialog]')?.open === true", 'small-window character dialog');
const smallDialog = await evaluate(`(() => {
  const dialog = document.querySelector('[data-form-dialog]');
  const scroll = dialog.querySelector('.character-editor-scroll');
  const footer = dialog.querySelector('footer');
  const rect = dialog.getBoundingClientRect();
  const footerRect = footer.getBoundingClientRect();
  return {
    width: innerWidth,
    height: innerHeight,
    fitsViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    internalScroll: ['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY),
    footerReachable: footerRect.bottom <= innerHeight + 1,
  };
})()`);
await click('[data-form-dialog] [data-editor-cancel]');
if (!smallDialog.fitsViewport || !smallDialog.internalScroll || !smallDialog.footerReachable) {
  throw new Error(`Small dialog acceptance failed: ${JSON.stringify(smallDialog)}`);
}
await click('[data-view-panel="play"] [data-action="edit-character"]');
await waitFor("document.querySelector('[data-form-dialog]')?.open === true && document.querySelector('[data-form-dialog] [name=classes]') !== null", 'small-window advanced character editor');
const advancedDialog = await evaluate(`(() => {
  const dialog = document.querySelector('[data-form-dialog]');
  const scroll = dialog.querySelector('.character-editor-scroll');
  const footer = dialog.querySelector('footer');
  const rect = dialog.getBoundingClientRect();
  const footerRect = footer.getBoundingClientRect();
  return {
    fitsViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    internalScroll: ['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY),
    footerReachable: footerRect.bottom <= innerHeight + 1,
    hasAbilities: dialog.querySelectorAll('[name^=ability_]').length === 6,
    viewport: { width: innerWidth, height: innerHeight },
    dialogRect: { top: rect.top, bottom: rect.bottom, height: rect.height },
    footerRect: { top: footerRect.top, bottom: footerRect.bottom, height: footerRect.height },
    formHeight: dialog.querySelector('form').getBoundingClientRect().height,
    fieldsetHeight: dialog.querySelector('fieldset').getBoundingClientRect().height,
  };
})()`);
await click('[data-form-dialog] [data-editor-cancel]');
if (!advancedDialog.fitsViewport || !advancedDialog.internalScroll || !advancedDialog.footerReachable || !advancedDialog.hasAbilities) {
  throw new Error(`Advanced dialog acceptance failed: ${JSON.stringify(advancedDialog)}`);
}
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await evaluate("window.dispatchEvent(new Event('resize'))");

console.log(JSON.stringify({ summary, layouts, highDpi, smallDialog, advancedDialog }));
if (closeAfter) {
  socket.send(JSON.stringify({ id: ++messageId, method: 'Browser.close', params: {} }));
  await new Promise((resolve) => setTimeout(resolve, 250));
}
socket.close();
