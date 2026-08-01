import { loadBridgeConfig, saveBridgeConfig } from './bridge-config.js';
import { BUILTIN_CODING_PROMPTS } from './coding-prompts.js';
import {
  applyTemplateVariables,
  filterPrompts,
  normalizeCustomPrompt,
  parseTemplateVariables,
} from './prompt-library.js';
import { getProviderKeyForUrl, PROMPT_PROVIDER_HOSTS } from './prompt-routing.js';
import {
  BUILTIN_AGENT_PROFILES,
  BUILTIN_SKILLS,
  composeWorkspacePrompt,
  normalizeAgentProfile,
  normalizeSkill,
  resolveWorkspaceContext,
} from './workspace-library.js';
import {
  formatContextPreviewSummary,
  normalizeMemoryEntry,
  normalizeProjectRecord,
  parseContextRefs,
  parseMemoryTags,
} from './project-intelligence.js';
import {
  base64ToBytes,
  buildMarkdownExport,
  createZipBytes,
  downloadBytes,
  sanitizeExportName,
} from './file-exporter.js';

const STORAGE_KEYS = Object.freeze({
  customPrompts: 'openbrowserCustomPrompts',
  customSkills: 'openbrowserCustomSkills',
  customProfiles: 'openbrowserCustomAgentProfiles',
  pluginScan: 'openbrowserChatGPTPluginScan',
  fileScan: 'openbrowserChatGPTFileScan',
  replyScan: 'openbrowserChatGPTReplyScan',
  activeView: 'openbrowserPanelView',
  category: 'openbrowserPromptCategory',
});

const VIEWS = ['prompts', 'projects', 'memory', 'custom', 'skills', 'agents', 'plugins', 'library', 'export', 'settings', 'status'];
const PROVIDER_LABELS = Object.freeze({ chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', deepseek: 'DeepSeek', perplexity: 'Perplexity', glm: 'GLM', grok: 'Grok' });

const state = {
  customPrompts: [], customSkills: [], customProfiles: [], plugins: [], files: [], replies: [],
  projects: [], activeProject: null, projectMemory: [], contextPreview: null,
  activeView: 'prompts', currentPrompt: null, bridgeConfig: null, promptValues: {}, selectedExportIds: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  tabs: [...document.querySelectorAll('.tab')], views: [...document.querySelectorAll('.view')],
  providerSelect: $('#provider-select'), bridgePill: $('#bridge-pill'), refreshStatus: $('#refresh-status'),
  activeContextSummary: $('#active-context-summary'), search: $('#prompt-search'), category: $('#category-filter'), promptCount: $('#prompt-count'), promptList: $('#prompt-list'),
  projectList: $('#project-list'), registerCurrentProject: $('#register-current-project'), refreshProjects: $('#refresh-projects'), contextRefs: $('#project-context-refs'), contextBudget: $('#project-context-budget'), contextPerFile: $('#project-context-per-file'), contextMaxFiles: $('#project-context-max-files'), previewProjectContext: $('#preview-project-context'), projectContextPreview: $('#project-context-preview'),
  projectMemoryForm: $('#project-memory-form'), projectMemoryText: $('#project-memory-text'), projectMemoryTags: $('#project-memory-tags'), projectMemoryList: $('#project-memory-list'), clearProjectMemory: $('#clear-project-memory'),
  customList: $('#custom-list'), customForm: $('#custom-prompt-form'), customId: $('#custom-id'), customTitle: $('#custom-title'), customDescription: $('#custom-description'), customCategory: $('#custom-category'), customTags: $('#custom-tags'), customContent: $('#custom-content'), resetCustom: $('#reset-custom'), importPrompts: $('#import-prompts'), exportPrompts: $('#export-prompts'), importFile: $('#import-file'),
  skillList: $('#skill-list'), skillForm: $('#skill-form'), newSkill: $('#new-skill'), cancelSkill: $('#cancel-skill'), skillId: $('#skill-id'), skillTitle: $('#skill-title'), skillDescription: $('#skill-description'), skillTags: $('#skill-tags'), skillInstructions: $('#skill-instructions'),
  agentList: $('#agent-list'), agentForm: $('#agent-form'), newAgent: $('#new-agent'), cancelAgent: $('#cancel-agent'), agentId: $('#agent-id'), agentName: $('#agent-name'), agentRole: $('#agent-role'), agentSkillIds: $('#agent-skill-ids'), agentInstructions: $('#agent-instructions'),
  openPlugins: $('#open-chatgpt-plugins'), scanPlugins: $('#scan-chatgpt-plugins'), pluginMeta: $('#plugin-scan-meta'), pluginList: $('#plugin-list'),
  openLibrary: $('#open-chatgpt-library'), scanLibrary: $('#scan-chatgpt-library'), scanReplies: $('#scan-conversation-replies'), libraryMeta: $('#library-scan-meta'), libraryList: $('#library-list'),
  exportScope: $('#export-scope'), exportName: $('#export-name'), exportSummary: $('#export-summary'), exportMarkdown: $('#export-markdown'), exportZip: $('#export-zip'), exportItemList: $('#export-item-list'),
  settingsForm: $('#settings-form'), bridgePort: $('#bridge-port'), bridgeToken: $('#bridge-token'), settingsProvider: $('#settings-provider'), superpower: $('#superpower-compatibility'), autoEnabled: $('#auto-continue-enabled'), autoMax: $('#auto-continue-max'), autoFallback: $('#auto-continue-fallback'), autoPrompt: $('#auto-continue-prompt'),
  bridgeStatusDetail: $('#bridge-status-detail'), projectStatusDetail: $('#project-status-detail'), providerStatusList: $('#provider-status-list'), workspaceStatusDetail: $('#workspace-status-detail'),
  dialog: $('#prompt-dialog'), dialogTitle: $('#dialog-title'), dialogDescription: $('#dialog-description'), variableFields: $('#variable-fields'), promptPreview: $('#prompt-preview'), copyPrompt: $('#copy-prompt'), insertPrompt: $('#insert-prompt'), sendPrompt: $('#send-prompt'), dialogResult: $('#dialog-result'), toast: $('#toast'),
};

void initialize();

async function initialize() {
  bindEvents();
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.customPrompts]: [], [STORAGE_KEYS.customSkills]: [], [STORAGE_KEYS.customProfiles]: [],
    [STORAGE_KEYS.pluginScan]: [], [STORAGE_KEYS.fileScan]: [], [STORAGE_KEYS.replyScan]: [],
    [STORAGE_KEYS.activeView]: 'prompts', [STORAGE_KEYS.category]: 'all',
  });
  state.customPrompts = loadNormalized(stored[STORAGE_KEYS.customPrompts], normalizeCustomPrompt);
  state.customSkills = loadNormalized(stored[STORAGE_KEYS.customSkills], normalizeSkill);
  state.customProfiles = loadNormalized(stored[STORAGE_KEYS.customProfiles], normalizeAgentProfile);
  state.plugins = normalizeScan(stored[STORAGE_KEYS.pluginScan]);
  state.files = normalizeScan(stored[STORAGE_KEYS.fileScan]);
  state.replies = normalizeScan(stored[STORAGE_KEYS.replyScan]);
  state.activeView = VIEWS.includes(stored[STORAGE_KEYS.activeView]) ? stored[STORAGE_KEYS.activeView] : 'prompts';
  state.bridgeConfig = await loadBridgeConfig();
  populateCategories(stored[STORAGE_KEYS.category]);
  populateSkillSelect();
  fillSettings();
  switchView(state.activeView, false);
  renderEverything();
  await refreshStatus();
}

function bindEvents() {
  elements.tabs.forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
  elements.search.addEventListener('input', renderPrompts);
  elements.category.addEventListener('change', async () => { await chrome.storage.local.set({ [STORAGE_KEYS.category]: elements.category.value }); renderPrompts(); });
  elements.providerSelect.addEventListener('change', async () => { state.bridgeConfig = await saveBridgeConfig({ ...state.bridgeConfig, preferredProvider: elements.providerSelect.value }); fillSettings(); await refreshStatus(); });
  elements.refreshStatus.addEventListener('click', refreshStatus);
  elements.refreshProjects.addEventListener('click', refreshProjectIntelligence);
  elements.registerCurrentProject.addEventListener('click', registerCurrentProject);
  elements.projectMemoryForm.addEventListener('submit', addProjectMemoryEntry);
  elements.clearProjectMemory.addEventListener('click', clearProjectMemoryEntries);
  elements.previewProjectContext.addEventListener('click', previewProjectContext);
  elements.customForm.addEventListener('submit', saveCustomPrompt);
  elements.resetCustom.addEventListener('click', resetCustomEditor);
  elements.importPrompts.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', importCustomPrompts);
  elements.exportPrompts.addEventListener('click', exportCustomPrompts);
  elements.newSkill.addEventListener('click', () => editSkill(null));
  elements.cancelSkill.addEventListener('click', resetSkillEditor);
  elements.skillForm.addEventListener('submit', saveSkill);
  elements.newAgent.addEventListener('click', () => editAgent(null));
  elements.cancelAgent.addEventListener('click', resetAgentEditor);
  elements.agentForm.addEventListener('submit', saveAgent);
  elements.openPlugins.addEventListener('click', () => chrome.tabs.create({ url: 'https://chatgpt.com/gpts' }));
  elements.scanPlugins.addEventListener('click', () => scanChatGPT('apps'));
  elements.openLibrary.addEventListener('click', () => chrome.tabs.create({ url: 'https://chatgpt.com/library' }));
  elements.scanLibrary.addEventListener('click', () => scanChatGPT('files'));
  elements.scanReplies.addEventListener('click', () => scanChatGPT('replies'));
  elements.exportScope.addEventListener('change', renderExportSummary);
  elements.exportMarkdown.addEventListener('click', exportMarkdown);
  elements.exportZip.addEventListener('click', exportZip);
  elements.settingsForm.addEventListener('submit', saveSettings);
  elements.copyPrompt.addEventListener('click', copyCurrentPrompt);
  elements.insertPrompt.addEventListener('click', () => deliverCurrentPrompt(false));
  elements.sendPrompt.addEventListener('click', () => deliverCurrentPrompt(true));
  elements.promptPreview.addEventListener('input', () => setDialogResult('Preview edited manually.'));
}

function switchView(view, persist = true) {
  const next = VIEWS.includes(view) ? view : 'prompts';
  state.activeView = next;
  elements.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === next));
  elements.views.forEach((panel) => panel.classList.toggle('active', panel.id === `view-${next}`));
  if (persist) void chrome.storage.local.set({ [STORAGE_KEYS.activeView]: next });
}

function allSkills() { return [...BUILTIN_SKILLS, ...state.customSkills]; }
function allProfiles() { return [...BUILTIN_AGENT_PROFILES, ...state.customProfiles]; }
function allPrompts() { return [...BUILTIN_CODING_PROMPTS, ...state.customPrompts]; }
function allExportItems() { return [...state.files, ...state.replies]; }
function workspaceContext() { return resolveWorkspaceContext({ skills: allSkills(), profiles: allProfiles(), activeSkillIds: state.bridgeConfig.activeSkillIds, activeProfileId: state.bridgeConfig.activeProfileId }); }

function renderEverything() {
  renderActiveContext(); renderProjects(); renderProjectMemory(); renderContextPreview(); renderPrompts(); renderCustomPrompts(); renderSkills(); renderAgents(); renderPlugins(); renderLibrary(); renderExportItems(); renderWorkspaceStatus();
}

function renderActiveContext() {
  const context = workspaceContext();
  elements.activeContextSummary.textContent = `Agent: ${context.profile?.name ?? 'none'} · Skills: ${context.skills.length ? context.skills.map((item) => item.title).join(', ') : 'none'}`;
}

function populateCategories(selected = 'all') {
  const categories = [...new Set(allPrompts().map((prompt) => prompt.category).filter(Boolean))].sort();
  elements.category.replaceChildren(createOption('all', 'All categories'), ...categories.map((item) => createOption(item, item)));
  elements.category.value = categories.includes(selected) ? selected : 'all';
}
function createOption(value, label) { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }

function renderPrompts() {
  const prompts = filterPrompts(allPrompts(), elements.search.value, elements.category.value);
  elements.promptCount.textContent = `${prompts.length} coding prompt${prompts.length === 1 ? '' : 's'} · active workspace instructions are applied on send`;
  renderPromptCollection(elements.promptList, prompts, false);
}
function renderCustomPrompts() { renderPromptCollection(elements.customList, state.customPrompts, true); }
function renderPromptCollection(container, prompts, manageable) {
  if (!prompts.length) return container.replaceChildren(emptyNode(manageable ? 'No custom prompts yet.' : 'No prompts match this filter.'));
  container.replaceChildren(...prompts.map((prompt) => createPromptCard(prompt, manageable)));
}
function createPromptCard(prompt, manageable) {
  const card = cardBase(prompt.title, prompt.description || 'Custom coding prompt', prompt.category, prompt.tags);
  const actions = card.querySelector('.card-actions');
  actions.append(createButton('Use', () => openPrompt(prompt), 'primary'), createButton('Copy', () => copyText(prompt.content)));
  if (manageable) actions.append(createButton('Edit', () => editCustomPrompt(prompt)), createButton('Delete', () => deleteCustomPrompt(prompt.id)));
  return card;
}

function renderSkills() {
  const active = new Set(state.bridgeConfig.activeSkillIds);
  elements.skillList.replaceChildren(...allSkills().map((skill) => {
    const card = cardBase(skill.title, skill.description, skill.custom ? 'Custom' : 'Built-in', skill.tags, active.has(skill.id));
    const actions = card.querySelector('.card-actions');
    actions.append(createButton(active.has(skill.id) ? 'Active' : 'Activate', () => toggleSkill(skill.id), active.has(skill.id) ? 'primary' : ''));
    if (skill.custom) actions.append(createButton('Edit', () => editSkill(skill)), createButton('Delete', () => deleteSkill(skill.id)));
    return card;
  }));
}

function renderAgents() {
  elements.agentList.replaceChildren(...allProfiles().map((profile) => {
    const active = state.bridgeConfig.activeProfileId === profile.id;
    const skillNames = profile.skillIds.map((id) => allSkills().find((item) => item.id === id)?.title).filter(Boolean);
    const card = cardBase(profile.name, `${profile.role || 'Agent profile'} · ${skillNames.join(', ') || 'no default skills'}`, profile.custom ? 'Custom' : 'Built-in', [], active);
    const actions = card.querySelector('.card-actions');
    actions.append(createButton(active ? 'Active' : 'Use profile', () => activateAgent(profile.id), active ? 'primary' : ''));
    if (profile.custom) actions.append(createButton('Edit', () => editAgent(profile)), createButton('Delete', () => deleteAgent(profile.id)));
    return card;
  }));
}

function renderPlugins() {
  elements.pluginMeta.textContent = state.plugins.length ? `${state.plugins.length} visible ChatGPT app/plugin candidate${state.plugins.length === 1 ? '' : 's'} cached locally.` : 'No scan results yet.';
  if (!state.plugins.length) return elements.pluginList.replaceChildren(emptyNode('Open the ChatGPT Apps/Plugins directory, then scan the visible page.'));
  elements.pluginList.replaceChildren(...state.plugins.map((item) => {
    const card = cardBase(item.name, item.url || 'Visible ChatGPT item', 'Visible scan', []);
    if (item.url) card.querySelector('.card-actions').append(createButton('Open', () => chrome.tabs.create({ url: item.url }), 'primary'));
    return card;
  }));
}

function renderLibrary() {
  const items = allExportItems();
  elements.libraryMeta.textContent = `${state.files.length} file${state.files.length === 1 ? '' : 's'} · ${state.replies.length} repl${state.replies.length === 1 ? 'y' : 'ies'} cached locally.`;
  renderSelectionList(elements.libraryList, items);
}
function renderExportItems() { renderSelectionList(elements.exportItemList, allExportItems()); renderExportSummary(); }
function renderSelectionList(container, items) {
  if (!items.length) return container.replaceChildren(emptyNode('Scan ChatGPT files or conversation replies first.'));
  container.replaceChildren(...items.map((item) => {
    const row = document.createElement('article'); row.className = 'selection-item';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selectedExportIds.has(item.id); checkbox.addEventListener('change', () => { checkbox.checked ? state.selectedExportIds.add(item.id) : state.selectedExportIds.delete(item.id); renderExportSummary(); renderSelectionList(elements.exportItemList, allExportItems()); if (container !== elements.exportItemList) renderSelectionList(elements.libraryList, allExportItems()); });
    const body = document.createElement('div'); const title = document.createElement('h3'); title.textContent = item.name; const meta = document.createElement('p'); meta.textContent = `${item.type} · ${item.url || item.source || 'visible page'}`;
    const actions = document.createElement('div'); actions.className = 'mini-actions';
    actions.append(createButton('Select only', () => { state.selectedExportIds = new Set([item.id]); renderLibrary(); renderExportItems(); switchView('export'); }));
    if (item.url) actions.append(createButton('Open', () => chrome.tabs.create({ url: item.url })));
    body.append(title, meta, actions); row.append(checkbox, body); return row;
  }));
}

function cardBase(titleText, descriptionText, badgeText, tags = [], active = false) {
  const card = document.createElement('article'); card.className = `workspace-card${active ? ' active' : ''}`;
  const header = document.createElement('header'); const block = document.createElement('div'); const title = document.createElement('h3'); title.textContent = titleText; const description = document.createElement('p'); description.textContent = descriptionText || ''; block.append(title, description); const badge = document.createElement('span'); badge.className = 'category-badge'; badge.textContent = badgeText || ''; header.append(block, badge);
  const tagRow = document.createElement('div'); tagRow.className = 'tags'; tags.forEach((name) => { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = name; tagRow.append(tag); });
  const actions = document.createElement('div'); actions.className = 'card-actions'; card.append(header, tagRow, actions); return card;
}
function createButton(label, handler, className = '') { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; if (className) button.className = className; button.addEventListener('click', handler); return button; }
function emptyNode(text) { const node = document.createElement('div'); node.className = 'empty'; node.textContent = text; return node; }

function openPrompt(prompt) {
  state.currentPrompt = prompt; state.promptValues = {}; elements.dialogTitle.textContent = prompt.title; elements.dialogDescription.textContent = prompt.description || prompt.category; elements.variableFields.replaceChildren(); setDialogResult('');
  for (const variable of parseTemplateVariables(prompt.content)) { const label = document.createElement('label'); label.textContent = variable.name; const input = document.createElement('input'); input.value = variable.defaultValue; state.promptValues[variable.name] = variable.defaultValue; input.addEventListener('input', () => { state.promptValues[variable.name] = input.value; refreshPromptPreview(); }); label.append(input); elements.variableFields.append(label); }
  refreshPromptPreview(); elements.dialog.showModal();
}
function refreshPromptPreview() { if (!state.currentPrompt) return; const body = applyTemplateVariables(state.currentPrompt.content, state.promptValues); elements.promptPreview.value = composeWorkspacePrompt(body, workspaceContext()); }
async function deliverCurrentPrompt(submit) {
  const prompt = elements.promptPreview.value.trim(); if (!prompt) return setDialogResult('Prompt is empty.', 'error');
  setDialogBusy(true); setDialogResult(submit ? 'Sending…' : 'Inserting…');
  try { const response = await chrome.runtime.sendMessage({ type: 'OPENBROWSER_USE_PROMPT', prompt, provider: elements.providerSelect.value, submit }); if (!response?.ok) throw new Error(response?.error || 'Prompt delivery failed.'); setDialogResult(`${submit ? 'Sent' : 'Inserted'} in ${response.providerName || response.provider || 'AI tab'}.`, 'success'); } catch (error) { setDialogResult(String(error?.message || error), 'error'); } finally { setDialogBusy(false); }
}
function setDialogBusy(value) { elements.copyPrompt.disabled = value; elements.insertPrompt.disabled = value; elements.sendPrompt.disabled = value; }
function setDialogResult(message, mode = '') { elements.dialogResult.textContent = message; elements.dialogResult.className = `result ${mode}`.trim(); }
async function copyCurrentPrompt() { await copyText(elements.promptPreview.value); setDialogResult('Copied.', 'success'); }
async function copyText(text) { try { await navigator.clipboard.writeText(String(text || '')); showToast('Copied.'); } catch { showToast('Clipboard unavailable.'); } }

async function saveCustomPrompt(event) { event.preventDefault(); try { const prompt = normalizeCustomPrompt({ id: elements.customId.value, title: elements.customTitle.value, description: elements.customDescription.value, category: elements.customCategory.value, tags: elements.customTags.value, content: elements.customContent.value }); upsert(state.customPrompts, prompt); await persist(STORAGE_KEYS.customPrompts, state.customPrompts); resetCustomEditor(); populateCategories(elements.category.value); renderPrompts(); renderCustomPrompts(); showToast('Prompt saved.'); } catch (error) { showToast(String(error?.message || error)); } }
function editCustomPrompt(prompt) { switchView('custom'); elements.customId.value = prompt.id; elements.customTitle.value = prompt.title; elements.customDescription.value = prompt.description || ''; elements.customCategory.value = prompt.category || 'Custom'; elements.customTags.value = (prompt.tags || []).join(', '); elements.customContent.value = prompt.content; }
async function deleteCustomPrompt(id) { if (!confirm('Delete this custom prompt?')) return; state.customPrompts = state.customPrompts.filter((item) => item.id !== id); await persist(STORAGE_KEYS.customPrompts, state.customPrompts); renderPrompts(); renderCustomPrompts(); }
function resetCustomEditor() { elements.customForm.reset(); elements.customId.value = ''; elements.customCategory.value = 'Custom'; }
async function importCustomPrompts() { const file = elements.importFile.files?.[0]; elements.importFile.value = ''; if (!file) return; try { const data = JSON.parse(await file.text()); const source = Array.isArray(data) ? data : data.prompts; const imported = source.map((item) => normalizeCustomPrompt(item)); imported.forEach((item) => upsert(state.customPrompts, item)); await persist(STORAGE_KEYS.customPrompts, state.customPrompts); renderEverything(); showToast(`Imported ${imported.length} prompts.`); } catch (error) { showToast(`Import failed: ${error?.message || error}`); } }
function exportCustomPrompts() { downloadBytes(new TextEncoder().encode(JSON.stringify({ format: 'openbrowser-prompts', version: 1, prompts: state.customPrompts }, null, 2)), 'openbrowser-custom-prompts.json', 'application/json'); }

async function toggleSkill(id) { const set = new Set(state.bridgeConfig.activeSkillIds); set.has(id) ? set.delete(id) : set.add(id); state.bridgeConfig = await saveBridgeConfig({ ...state.bridgeConfig, activeSkillIds: [...set] }); renderEverything(); }
function editSkill(skill) { elements.skillForm.hidden = false; elements.skillId.value = skill?.id || ''; elements.skillTitle.value = skill?.title || ''; elements.skillDescription.value = skill?.description || ''; elements.skillTags.value = (skill?.tags || []).join(', '); elements.skillInstructions.value = skill?.instructions || ''; elements.skillTitle.focus(); }
function resetSkillEditor() { elements.skillForm.reset(); elements.skillId.value = ''; elements.skillForm.hidden = true; }
async function saveSkill(event) { event.preventDefault(); try { const skill = normalizeSkill({ id: elements.skillId.value, title: elements.skillTitle.value, description: elements.skillDescription.value, tags: elements.skillTags.value, instructions: elements.skillInstructions.value }); upsert(state.customSkills, skill); await persist(STORAGE_KEYS.customSkills, state.customSkills); resetSkillEditor(); populateSkillSelect(); renderEverything(); } catch (error) { showToast(String(error?.message || error)); } }
async function deleteSkill(id) { if (!confirm('Delete this skill?')) return; state.customSkills = state.customSkills.filter((item) => item.id !== id); state.bridgeConfig = await saveBridgeConfig({ ...state.bridgeConfig, activeSkillIds: state.bridgeConfig.activeSkillIds.filter((item) => item !== id) }); await persist(STORAGE_KEYS.customSkills, state.customSkills); populateSkillSelect(); renderEverything(); }

async function activateAgent(id) { state.bridgeConfig = await saveBridgeConfig({ ...state.bridgeConfig, activeProfileId: state.bridgeConfig.activeProfileId === id ? '' : id }); renderEverything(); }
function populateSkillSelect() { elements.agentSkillIds.replaceChildren(...allSkills().map((skill) => createOption(skill.id, skill.title))); }
function editAgent(profile) { elements.agentForm.hidden = false; elements.agentId.value = profile?.id || ''; elements.agentName.value = profile?.name || ''; elements.agentRole.value = profile?.role || ''; elements.agentInstructions.value = profile?.instructions || ''; [...elements.agentSkillIds.options].forEach((option) => { option.selected = (profile?.skillIds || []).includes(option.value); }); elements.agentName.focus(); }
function resetAgentEditor() { elements.agentForm.reset(); elements.agentId.value = ''; elements.agentForm.hidden = true; }
async function saveAgent(event) { event.preventDefault(); try { const profile = normalizeAgentProfile({ id: elements.agentId.value, name: elements.agentName.value, role: elements.agentRole.value, instructions: elements.agentInstructions.value, skillIds: [...elements.agentSkillIds.selectedOptions].map((option) => option.value) }); upsert(state.customProfiles, profile); await persist(STORAGE_KEYS.customProfiles, state.customProfiles); resetAgentEditor(); renderEverything(); } catch (error) { showToast(String(error?.message || error)); } }
async function deleteAgent(id) { if (!confirm('Delete this agent profile?')) return; state.customProfiles = state.customProfiles.filter((item) => item.id !== id); if (state.bridgeConfig.activeProfileId === id) state.bridgeConfig = await saveBridgeConfig({ ...state.bridgeConfig, activeProfileId: '' }); await persist(STORAGE_KEYS.customProfiles, state.customProfiles); renderEverything(); }

async function bridgeCall(path, init = {}) {
  const normalized = { ...init };
  if (normalized.body && typeof normalized.body !== 'string') normalized.body = JSON.stringify(normalized.body);
  const response = await chrome.runtime.sendMessage({ type: 'BRIDGE_REQUEST', path, init: normalized });
  if (!response?.ok) throw new Error(response?.error || `Bridge request failed: ${path}`);
  return response.data ?? {};
}

async function refreshProjectIntelligence() {
  try {
    const [projectData, memoryData] = await Promise.all([bridgeCall('/projects'), bridgeCall('/project/memory')]);
    state.projects = loadNormalized(projectData.projects, normalizeProjectRecord);
    state.activeProject = projectData.activeProject ? normalizeProjectRecord(projectData.activeProject) : null;
    state.projectMemory = loadNormalized(memoryData.entries, normalizeMemoryEntry);
    renderProjects(); renderProjectMemory(); renderWorkspaceStatus();
  } catch (error) {
    state.projects = []; state.activeProject = null; state.projectMemory = [];
    renderProjects(); renderProjectMemory();
    showToast(String(error?.message || error));
  }
}

function renderProjects() {
  if (!elements.projectList) return;
  if (!state.projects.length) {
    elements.projectList.replaceChildren(emptyState('No registered projects. Start the bridge inside a project and register it.'));
    return;
  }
  elements.projectList.replaceChildren(...state.projects.map((project) => {
    const card = document.createElement('article');
    card.className = `workspace-card ${state.activeProject?.id === project.id ? 'active' : ''}`;
    const header = document.createElement('header');
    const title = document.createElement('h3'); title.textContent = project.name;
    const badge = document.createElement('span'); badge.className = 'category-badge'; badge.textContent = state.activeProject?.id === project.id ? 'Active' : 'Registered';
    header.append(title, badge);
    const root = document.createElement('p'); root.textContent = project.root;
    const actions = document.createElement('div'); actions.className = 'card-actions';
    const use = document.createElement('button'); use.type = 'button'; use.textContent = state.activeProject?.id === project.id ? 'Active project' : 'Set active'; use.disabled = state.activeProject?.id === project.id; use.addEventListener('click', () => activateProject(project.id));
    actions.append(use); card.append(header, root, actions); return card;
  }));
}

async function registerCurrentProject() {
  elements.registerCurrentProject.disabled = true;
  try {
    const data = await bridgeCall('/projects/register-current', { method: 'POST', body: {} });
    showToast(`Registered ${data.project?.name || 'current project'}.`);
    await refreshProjectIntelligence();
  } catch (error) { showToast(String(error?.message || error)); }
  finally { elements.registerCurrentProject.disabled = false; }
}

async function activateProject(projectId) {
  try {
    const data = await bridgeCall('/projects/active', { method: 'POST', body: { projectId } });
    state.activeProject = normalizeProjectRecord(data.project);
    renderProjects(); renderWorkspaceStatus();
    showToast('Active project saved. Restart the CLI from that project root to execute there.');
  } catch (error) { showToast(String(error?.message || error)); }
}

function renderProjectMemory() {
  if (!elements.projectMemoryList) return;
  if (!state.projectMemory.length) {
    elements.projectMemoryList.replaceChildren(emptyState('No explicit project memory saved.'));
    return;
  }
  elements.projectMemoryList.replaceChildren(...state.projectMemory.map((entry) => {
    const card = document.createElement('article'); card.className = 'workspace-card';
    const title = document.createElement('h3'); title.textContent = entry.text;
    const tags = document.createElement('p'); tags.textContent = entry.tags.length ? entry.tags.join(', ') : 'No tags';
    const actions = document.createElement('div'); actions.className = 'card-actions';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => deleteProjectMemoryEntry(entry.id));
    actions.append(remove); card.append(title, tags, actions); return card;
  }));
}

async function addProjectMemoryEntry(event) {
  event.preventDefault();
  try {
    const text = elements.projectMemoryText.value.trim();
    if (!text) return;
    await bridgeCall('/project/memory', { method: 'POST', body: { text, tags: parseMemoryTags(elements.projectMemoryTags.value) } });
    elements.projectMemoryForm.reset();
    await refreshProjectIntelligence();
    showToast('Project memory added.');
  } catch (error) { showToast(String(error?.message || error)); }
}

async function deleteProjectMemoryEntry(memoryId) {
  try {
    await bridgeCall(`/project/memory/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
    await refreshProjectIntelligence();
    showToast('Project memory removed.');
  } catch (error) { showToast(String(error?.message || error)); }
}

async function clearProjectMemoryEntries() {
  if (!confirm('Clear all project memory for the current project?')) return;
  try {
    await bridgeCall('/project/memory/clear', { method: 'POST', body: {} });
    await refreshProjectIntelligence();
    showToast('Project memory cleared.');
  } catch (error) { showToast(String(error?.message || error)); }
}

async function previewProjectContext() {
  elements.previewProjectContext.disabled = true;
  try {
    const data = await bridgeCall('/project/context/preview', {
      method: 'POST',
      body: {
        refs: parseContextRefs(elements.contextRefs.value),
        totalCharacters: Number(elements.contextBudget.value),
        perFileCharacters: Number(elements.contextPerFile.value),
        maxFiles: Number(elements.contextMaxFiles.value),
      },
    });
    state.contextPreview = data;
    renderContextPreview();
    showToast(`Previewed ${data.included?.length || 0} files.`);
  } catch (error) { showToast(String(error?.message || error)); }
  finally { elements.previewProjectContext.disabled = false; }
}

function renderContextPreview() {
  if (!elements.projectContextPreview) return;
  elements.projectContextPreview.textContent = state.contextPreview ? formatContextPreviewSummary(state.contextPreview) : 'No preview yet.';
}

function emptyState(message) { const node = document.createElement('div'); node.className = 'empty'; node.textContent = message; return node; }

async function scanChatGPT(kind) {
  const button = kind === 'apps' ? elements.scanPlugins : kind === 'files' ? elements.scanLibrary : elements.scanReplies; button.disabled = true;
  try { const response = await chrome.runtime.sendMessage({ type: 'OPENBROWSER_SCAN_CHATGPT', scan: kind }); if (!response?.ok) throw new Error(response?.error || 'Scan failed.'); const items = normalizeScan(response.items).map((item, index) => ({ ...item, id: item.id || `${kind}-${Date.now()}-${index}` })); if (kind === 'apps') { state.plugins = items; await persist(STORAGE_KEYS.pluginScan, items); renderPlugins(); } else if (kind === 'files') { state.files = items; await persist(STORAGE_KEYS.fileScan, items); renderLibrary(); renderExportItems(); } else { state.replies = items; await persist(STORAGE_KEYS.replyScan, items); renderLibrary(); renderExportItems(); } showToast(`Scanned ${items.length} ${kind}.`); } catch (error) { showToast(String(error?.message || error)); } finally { button.disabled = false; }
}

function selectedItems() { const items = allExportItems(); return elements.exportScope.value === 'all' ? items : items.filter((item) => state.selectedExportIds.has(item.id)); }
function renderExportSummary() { const items = selectedItems(); elements.exportSummary.textContent = `${items.length} item${items.length === 1 ? '' : 's'} will be exported.`; }
function exportMarkdown() { const items = selectedItems(); if (!items.length) return showToast('Select items to export.'); const name = sanitizeExportName(elements.exportName.value || 'openbrowser-export'); const markdown = buildMarkdownExport(items, { title: name }); downloadBytes(new TextEncoder().encode(markdown), `${name}.md`, 'text/markdown'); }
async function exportZip() {
  const items = selectedItems(); if (!items.length) return showToast('Select items to export.'); elements.exportZip.disabled = true;
  try { const entries = []; const indexMarkdown = buildMarkdownExport(items, { title: elements.exportName.value || 'OpenBrowser export' }); entries.push({ name: 'index.md', data: new TextEncoder().encode(indexMarkdown) });
    for (const item of items) { if (item.type === 'reply') { entries.push({ name: `replies/${sanitizeExportName(item.name)}.md`, data: new TextEncoder().encode(`# ${item.name}\n\n${item.text || ''}\n`) }); continue; }
      if (item.url) { const response = await chrome.runtime.sendMessage({ type: 'OPENBROWSER_FETCH_CHATGPT_FILE', url: item.url }); if (response?.ok && response.base64) { entries.push({ name: `files/${sanitizeExportName(response.filename || item.name)}`, data: base64ToBytes(response.base64) }); continue; } }
      entries.push({ name: `files/${sanitizeExportName(item.name)}.md`, data: new TextEncoder().encode(buildMarkdownExport([item], { title: item.name })) });
    }
    const name = sanitizeExportName(elements.exportName.value || 'openbrowser-export'); downloadBytes(createZipBytes(entries), `${name}.zip`, 'application/zip'); showToast(`Exported ${items.length} items.`);
  } catch (error) { showToast(`Export failed: ${error?.message || error}`); } finally { elements.exportZip.disabled = false; }
}

function fillSettings() { const c = state.bridgeConfig; elements.providerSelect.value = c.preferredProvider; elements.bridgePort.value = c.bridgePort; elements.bridgeToken.value = c.bridgeToken; elements.settingsProvider.value = c.preferredProvider; elements.superpower.checked = c.superpowerCompatibility; elements.autoEnabled.checked = c.autoContinueEnabled; elements.autoMax.value = c.autoContinueMax; elements.autoFallback.checked = c.autoContinueFallback; elements.autoPrompt.value = c.autoContinueFallbackPrompt; }
async function saveSettings(event) { event.preventDefault(); state.bridgeConfig = await saveBridgeConfig({ ...state.bridgeConfig, bridgePort: elements.bridgePort.value, bridgeToken: elements.bridgeToken.value, preferredProvider: elements.settingsProvider.value, superpowerCompatibility: elements.superpower.checked, autoContinueEnabled: elements.autoEnabled.checked, autoContinueMax: elements.autoMax.value, autoContinueFallback: elements.autoFallback.checked, autoContinueFallbackPrompt: elements.autoPrompt.value }); fillSettings(); renderEverything(); await refreshStatus(); showToast('Settings saved.'); }

async function refreshStatus() {
  setBridgePill('Checking', 'pending'); const [worker, tabs] = await Promise.all([pingWorker(), chrome.tabs.query({})]); renderProviderStatus(tabs);
  if (!worker?.ok) { setBridgePill('Offline', 'offline'); elements.bridgeStatusDetail.replaceChildren(statusLine('Extension worker', 'Unavailable')); return; }
  state.bridgeConfig = await loadBridgeConfig(); fillSettings(); renderEverything(); setBridgePill(worker.sseConnected ? 'Connected' : 'Waiting', worker.sseConnected ? 'online' : 'pending'); elements.bridgeStatusDetail.replaceChildren(statusLine('URL', worker.bridgeUrl || 'unknown'), statusLine('Event stream', worker.sseConnected ? 'connected' : 'waiting'), statusLine('Ready AI tabs', String(worker.readyTabs || 0)));
  try { const response = await chrome.runtime.sendMessage({ type: 'BRIDGE_REQUEST', path: '/project/status', init: {} }); if (!response?.ok) throw new Error(); renderProjectStatus(response.data); await refreshProjectIntelligence(); } catch { elements.projectStatusDetail.replaceChildren(statusLine('Status', 'Bridge server not running'), statusLine('Start', 'openbrowser server')); }
}
function renderProjectStatus(status = {}) { elements.projectStatusDetail.replaceChildren(statusLine('Project', status.projectName || 'unknown'), statusLine('Branch', status.branch || 'unknown'), statusLine('Working tree', status.dirty ? `${status.changedFiles || 0} changed` : 'clean'), statusLine('Package manager', status.packageManager || 'none'), statusLine('Remote', status.remote || 'none')); }
function renderWorkspaceStatus() { const context = workspaceContext(); elements.workspaceStatusDetail.replaceChildren(statusLine('Project', state.activeProject?.name || 'none'), statusLine('Memory', `${state.projectMemory.length} item(s)`), statusLine('Agent', context.profile?.name || 'none'), statusLine('Skills', context.skills.map((item) => item.title).join(', ') || 'none'), statusLine('Auto-continue', state.bridgeConfig.autoContinueEnabled ? `enabled · max ${state.bridgeConfig.autoContinueMax}` : 'disabled'), statusLine('Superpower mode', state.bridgeConfig.superpowerCompatibility ? 'enabled' : 'disabled')); }
function renderProviderStatus(tabs) { const counts = new Map(); tabs.forEach((tab) => { const provider = getProviderKeyForUrl(tab.url); if (provider) counts.set(provider, (counts.get(provider) || 0) + 1); }); elements.providerStatusList.replaceChildren(...Object.keys(PROMPT_PROVIDER_HOSTS).map((provider) => { const row = document.createElement('div'); const count = counts.get(provider) || 0; row.className = `provider-status ${count ? 'open' : ''}`; const dot = document.createElement('span'); dot.className = 'dot'; const text = document.createElement('span'); text.textContent = `${PROVIDER_LABELS[provider]} · ${count ? `${count} open` : 'closed'}`; row.append(dot, text); return row; })); }
function statusLine(label, value) { const row = document.createElement('div'); row.className = 'status-line'; const left = document.createElement('span'); left.textContent = label; const right = document.createElement('strong'); right.textContent = value; row.append(left, right); return row; }
async function pingWorker() { try { return await chrome.runtime.sendMessage({ type: 'OPENBROWSER_PING' }); } catch { return null; } }
function setBridgePill(text, mode) { elements.bridgePill.textContent = text; elements.bridgePill.className = `status-pill ${mode}`; }

function normalizeScan(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object').map((item, index) => ({ ...item, id: String(item.id || `${item.type || 'item'}-${index}-${String(item.name || '').toLowerCase().replace(/\W+/g, '-')}`) })) : []; }
function loadNormalized(value, normalizer) { if (!Array.isArray(value)) return []; const output = []; for (const item of value) { try { output.push(normalizer(item)); } catch {} } return output; }
function upsert(list, item) { const index = list.findIndex((existing) => existing.id === item.id); if (index >= 0) list.splice(index, 1, item); else list.push(item); }
async function persist(key, value) { await chrome.storage.local.set({ [key]: value }); }
let toastTimer; function showToast(message) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.classList.add('show'); toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600); }
