const endpoint = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'http://127.0.0.1:9224';
const closeAfter = process.argv.includes('--close');

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

async function waitFor(expression, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const diagnostic = await evaluate(`({ text: document.body.innerText.slice(-1600) })`);
  throw new Error(`Timed out while waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function waitForSettingsResult(expected, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await evaluate(`document.querySelector('.settings-toast')?.textContent?.trim() ?? ''`);
    if (message.includes(expected)) return;
    if (message.startsWith('Error invoking remote method')) throw new Error(`${label} failed: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out while waiting for ${label}.`);
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

async function sendChatMessage(content) {
  const before = await evaluate(`document.querySelectorAll('.chat-message.is-assistant').length`);
  const submitted = await evaluate(`(() => {
    const textarea = document.querySelector('.chat-composer textarea');
    const button = document.querySelector('.chat-composer button[type="submit"]');
    if (!(textarea instanceof HTMLTextAreaElement) || !(button instanceof HTMLButtonElement)) return false;
    textarea.value = ${JSON.stringify(content)};
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    button.click();
    return true;
  })()`);
  if (!submitted) throw new Error('Chat composer is not ready.');

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => ({
      assistants: document.querySelectorAll('.chat-message.is-assistant').length,
      running: document.querySelector('[data-chat-action="cancel"]') !== null
        || document.querySelector('.chat-tool-status')?.textContent?.includes('Chronicle přemýšlí') === true,
      error: document.querySelector('.chat-error')?.textContent?.trim() ?? '',
    }))()`);
    if (state.error) throw new Error(`AI chat failed: ${state.error}`);
    if (state.assistants > before && !state.running) return state.assistants;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for assistant response to: ${content}`);
}

await send('Runtime.enable');
await click('[data-nav-view="settings"]');
await waitFor(`!document.querySelector('[data-view-panel="settings"]')?.hidden`, 'Settings view');
await click('[data-settings-action="test-connection"]');
await waitForSettingsResult('Připojení k OpenAI funguje.', 'connection test');
await click('[data-settings-action="test-runtime"]');
await waitForSettingsResult('AI runtime včetně Chronicle nástrojů funguje.', 'runtime test');

await click('[data-nav-view="play"]');
await waitFor(`!document.querySelector('[data-view-panel="play"]')?.hidden`, 'Play view');
await sendChatMessage('Test. Odpověz krátce jednou větou.');

const traceBeforeRead = await evaluate(`window.chronicle.getChronicleTrace().then((items) => items.length)`);
await sendChatMessage('Použij chronicle_get_character_context a odpověz, kolik má Arqos právě aktuálních životů.');
const readTools = await evaluate(`window.chronicle.getChronicleTrace().then((items) => items
  .slice(${traceBeforeRead})
  .filter((item) => item.stage === 'tool_called')
  .map((item) => item.detail.name))`);
if (!readTools.includes('chronicle.get_character_context')) {
  throw new Error(`Expected chronicle.get_character_context, received: ${JSON.stringify(readTools)}`);
}

const proposalsBefore = await evaluate(`document.querySelectorAll('.proposal-card').length`);
await sendChatMessage('Arqos právě získal inspiraci. Proveď změnu výhradně zavoláním chronicle_propose_turn_transaction s inspiration.set=true pro aktivní postavu. Potom stručně popiš výsledek.');
await waitFor(`document.querySelectorAll('.proposal-card').length > ${proposalsBefore}`, 'proposal card');

console.log(JSON.stringify({
  connection: true,
  runtime: true,
  streamingTurn: true,
  readTool: readTools,
  proposal: true,
}));

if (closeAfter) {
  socket.send(JSON.stringify({ id: ++messageId, method: 'Browser.close', params: {} }));
  await new Promise((resolve) => setTimeout(resolve, 250));
}
socket.close();
