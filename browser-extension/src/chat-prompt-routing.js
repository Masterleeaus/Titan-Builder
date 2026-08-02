import { getRuntimePromptCatalog, resolvePromptBody } from './prompt-catalog.js';
import { routePromptRequest } from './prompt-router.js';
import { composeRoutedChatPrompt } from './chat-prompt-envelope.js';

const CHAT_ROUTE_PREFIX = '# Titan Builder Routed Chat Task';
const STORAGE_DEFAULTS = Object.freeze({
  chatPromptRoutingMode: 'auto',
  chatPromptManualId: '',
});

export function normalizeChatRoutingSettings(value = {}) {
  const rawMode = value.mode ?? value.chatPromptRoutingMode;
  const mode = rawMode === 'manual' || rawMode === 'off' ? rawMode : 'auto';
  return { mode, manualPromptId: String(value.manualPromptId ?? value.chatPromptManualId ?? '').trim() };
}

export function isAlreadyRoutedChatPrompt(value) {
  return String(value ?? '').trimStart().startsWith(CHAT_ROUTE_PREFIX);
}

export function shouldInterceptChatKeydown(event, composer) {
  return Boolean(
    composer
    && event?.key === 'Enter'
    && event?.shiftKey !== true
    && event?.isComposing !== true
    && !event?.ctrlKey
    && !event?.metaKey
    && !event?.altKey
    && composer.contains?.(event.target),
  );
}

export async function prepareChatPrompt({
  request,
  catalog = getRuntimePromptCatalog(),
  settings = {},
  routingOptions = {},
  bodyLoader,
} = {}) {
  const original = String(request ?? '').trim();
  if (!original) return { route: { status: 'empty', selected: null, candidates: [] }, outbound: '', enhanced: false, error: '' };
  if (isAlreadyRoutedChatPrompt(original)) {
    return { route: { status: 'already-routed', selected: null, candidates: [] }, outbound: original, enhanced: false, error: '' };
  }

  const normalized = normalizeChatRoutingSettings(settings);
  let route;
  try {
    route = routePromptRequest(original, catalog, {
      ...routingOptions,
      routingMode: normalized.mode,
      manualPromptId: normalized.manualPromptId,
      mode: 'ask',
    });
  } catch (error) {
    return {
      route: { status: 'routing-error', selected: null, candidates: [], reason: 'routing-error' },
      outbound: original,
      enhanced: false,
      error: String(error?.message ?? error),
    };
  }

  if (route.status !== 'selected') return { route, outbound: original, enhanced: false, error: '' };

  try {
    const body = await resolvePromptBody(route.selected, bodyLoader);
    const outbound = composeRoutedChatPrompt({ request: original, prompt: route.selected, body, route });
    return { route, outbound, enhanced: true, error: '' };
  } catch (error) {
    return {
      route: { ...route, status: 'load-error' },
      outbound: original,
      enhanced: false,
      error: String(error?.message ?? error),
    };
  }
}

export async function installChatPromptRouting(options = {}) {
  const browser = options.chrome ?? globalThis.chrome;
  const root = options.document ?? globalThis.document;
  const locationValue = options.location ?? globalThis.location;
  const getProvider = options.getProviderForUrl ?? globalThis.getProviderForUrl;
  if (!browser?.storage?.local || !root || !locationValue || typeof getProvider !== 'function') return null;

  const provider = getProvider(locationValue.href);
  if (!provider?.selectors?.input?.length || !provider?.selectors?.send?.length) return null;

  const catalog = options.catalog ?? getRuntimePromptCatalog();
  const stored = await browser.storage.local.get(STORAGE_DEFAULTS);
  const state = {
    settings: normalizeChatRoutingSettings(stored),
    processing: false,
    bypassUntil: 0,
    catalog,
    provider,
  };

  const ui = createRoutingUi(root, state, browser);
  const findComposer = () => queryAcrossRoots(root, provider.selectors.input);
  const findSend = () => queryAcrossRoots(root, provider.selectors.send);

  const submit = async () => {
    if (state.processing || Date.now() < state.bypassUntil) return;
    const composer = findComposer();
    const send = findSend();
    if (!composer || !send) {
      ui.setStatus('Router waiting for the provider composer.');
      return;
    }

    const request = readComposerText(composer).trim();
    if (!request) return;
    state.processing = true;
    ui.setStatus('Selecting prompt…');
    try {
      const result = await prepareChatPrompt({ request, catalog: state.catalog, settings: state.settings });
      if (result.enhanced) {
        writeComposerText(composer, result.outbound, root);
        ui.setStatus(`Using ${result.route.selected.title} · ${result.route.score}`);
      } else if (result.route.status === 'ambiguous') {
        ui.setStatus(`No automatic selection · ${candidateNames(result.route)}`);
      } else if (result.route.status === 'load-error' || result.route.status === 'routing-error') {
        ui.setStatus(`Prompt unavailable; sending original · ${result.error}`);
      } else if (result.route.status === 'off') {
        ui.setStatus('Prompt routing off · sending original');
      } else {
        ui.setStatus('No prompt match · sending original');
      }
      state.bypassUntil = Date.now() + 1500;
      const currentSend = findSend() ?? send;
      await waitForEnabled(currentSend, 1200);
      currentSend.click();
    } finally {
      state.processing = false;
    }
  };

  root.addEventListener('click', (event) => {
    if (Date.now() < state.bypassUntil || state.processing) return;
    const send = findSend();
    if (!send || !(event.target === send || send.contains?.(event.target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void submit();
  }, true);

  root.addEventListener('keydown', (event) => {
    if (Date.now() < state.bypassUntil || state.processing) return;
    const composer = findComposer();
    if (!shouldInterceptChatKeydown(event, composer)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void submit();
  }, true);

  root.addEventListener('submit', (event) => {
    if (Date.now() < state.bypassUntil || state.processing) return;
    const composer = findComposer();
    if (!composer || !event.target?.contains?.(composer)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void submit();
  }, true);

  return { state, submit, destroy: () => ui.destroy() };
}

function createRoutingUi(root, state, browser) {
  const host = root.createElement('div');
  host.id = 'openbrowser-chat-prompt-router';
  host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;font:12px system-ui,sans-serif;';
  const shadow = host.attachShadow({ mode: 'open' });
  const wrap = root.createElement('div');
  wrap.style.cssText = 'display:flex;gap:6px;align-items:center;padding:7px 9px;border-radius:12px;background:rgba(20,20,24,.94);color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.3);max-width:520px;';
  const mode = root.createElement('select');
  for (const [value, label] of [['auto','Auto prompts'],['manual','Manual prompt'],['off','Prompts off']]) {
    const option = root.createElement('option'); option.value=value; option.textContent=label; mode.append(option);
  }
  mode.value = state.settings.mode;
  const manual = root.createElement('select');
  const empty = root.createElement('option'); empty.value=''; empty.textContent='Choose prompt'; manual.append(empty);
  for (const prompt of [...state.catalog].sort((a,b)=>a.title.localeCompare(b.title))) {
    const option=root.createElement('option'); option.value=prompt.id; option.textContent=prompt.title; manual.append(option);
  }
  manual.value=state.settings.manualPromptId; manual.hidden=mode.value!=='manual';
  const status = root.createElement('span'); status.textContent='Chat prompt routing ready'; status.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;';
  for (const select of [mode,manual]) select.style.cssText='max-width:160px;border:0;border-radius:7px;padding:4px;background:#fff;color:#111;';
  wrap.append(mode,manual,status); shadow.append(wrap); root.documentElement.append(host);
  const save=async()=>{ state.settings=normalizeChatRoutingSettings({mode:mode.value,manualPromptId:manual.value}); manual.hidden=state.settings.mode!=='manual'; await browser.storage.local.set({chatPromptRoutingMode:state.settings.mode,chatPromptManualId:state.settings.manualPromptId}); };
  mode.addEventListener('change',()=>void save()); manual.addEventListener('change',()=>void save());
  return { setStatus(value){ status.textContent=String(value); status.title=String(value); }, destroy(){ host.remove(); } };
}

function queryAcrossRoots(root, selectors) {
  const queue=[root];
  while (queue.length) {
    const current=queue.shift();
    for (const selector of selectors) { const node=current.querySelector?.(selector); if (node) return node; }
    for (const element of current.querySelectorAll?.('*') ?? []) if (element.shadowRoot) queue.push(element.shadowRoot);
  }
  return null;
}
function readComposerText(element) { return 'value' in element ? String(element.value ?? '') : String(element.innerText ?? element.textContent ?? ''); }
function writeComposerText(element, value, root) {
  element.focus?.();
  if ('value' in element) {
    const prototype=Object.getPrototypeOf(element); const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set; setter ? setter.call(element,value) : (element.value=value);
  } else {
    element.textContent=value;
  }
  const EventCtor=root.defaultView?.InputEvent ?? root.defaultView?.Event ?? globalThis.Event;
  element.dispatchEvent?.(new EventCtor('input',{bubbles:true,inputType:'insertText',data:value}));
  element.dispatchEvent?.(new (root.defaultView?.Event ?? globalThis.Event)('change',{bubbles:true}));
}
function candidateNames(route) { const names=(route.candidates||[]).slice(0,2).map((item)=>item.prompt?.title).filter(Boolean); return names.length?names.join(' / '):'send original'; }
async function waitForEnabled(button, timeoutMs) { const deadline=Date.now()+timeoutMs; while (button.disabled && Date.now()<deadline) await new Promise((resolve)=>setTimeout(resolve,50)); }
