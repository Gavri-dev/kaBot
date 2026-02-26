// kaBot — Popup script

const versionLabel  = document.getElementById('versionLabel');
const apiStatusEl   = document.getElementById('apiStatus');
const liveSection   = document.getElementById('liveSection');
const liveQuestion  = document.getElementById('liveQuestion');
const liveAnswer    = document.getElementById('liveAnswer');
const highlightCb   = document.getElementById('highlight');
const autoclickCb   = document.getElementById('autoclick');
const silentModeCb  = document.getElementById('silentMode');
const delaySlider   = document.getElementById('answerDelay');
const delayDisplay  = document.getElementById('delayValue');
const toggleOpenAI  = document.getElementById('toggleOpenAI');
const openaiSection = document.getElementById('openaiSection');
const collapseArrow = document.getElementById('collapseArrow');
const apiKeyInput   = document.getElementById('openaiApiKey');
const modelInput    = document.getElementById('openaiModel');
const saveBtn       = document.getElementById('saveOpenAI');
const clearBtn      = document.getElementById('clearOpenAI');

// ─── Live tracking ──────────────────────────────────────────────────

async function pollCurrentQuestion() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getQuestion' });
    if (resp?.question) {
      showQuestion(resp.question.title);
      if (resp.answer) showAnswer(resp.answer);
    }
  } catch (err) {
    // Expected when no Kahoot tab is active; only log unexpected errors
    if (!err?.message?.includes('Could not establish connection')) {
      console.debug('[kaBot Popup]', err.message);
    }
  }
}

function showQuestion(title) {
  if (!title) return;
  liveSection.classList.remove('hidden');
  liveQuestion.textContent = title;
}

function showAnswer(answer) {
  if (!answer) return;
  liveSection.classList.remove('hidden');
  liveAnswer.textContent = answer;
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateQuestion' && request.question) {
    showQuestion(request.question.title);
    liveAnswer.textContent = '...';
  }
  if (request.action === 'updateAnswer' && request.answer) {
    showAnswer(request.answer);
  }
});

// ─── Settings ───────────────────────────────────────────────────────

const DEPRECATED_MODELS = new Set([
  'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'gpt-4-turbo',
  'gpt-4', 'gpt-4-1106-preview', 'gpt-4-0125-preview'
]);
const DEFAULT_MODEL = 'gpt-5-mini';

async function loadSettings() {
  const s = await chrome.storage.sync.get(['highlightOption', 'autoClickOption', 'silentMode', 'answerDelay', 'openaiApiKey', 'openaiModel']);
  if (highlightCb)  highlightCb.checked = s.highlightOption !== false;
  if (autoclickCb)  autoclickCb.checked = s.autoClickOption !== false;
  if (silentModeCb) silentModeCb.checked = !!s.silentMode;
  const delay = s.answerDelay ?? 0;
  if (delaySlider)  delaySlider.value = String(delay);
  if (delayDisplay) delayDisplay.textContent = String(delay);
  if (apiKeyInput) apiKeyInput.value = s.openaiApiKey || '';
  // Auto-upgrade deprecated models
  let model = s.openaiModel || DEFAULT_MODEL;
  if (DEPRECATED_MODELS.has(model.trim().toLowerCase())) {
    model = DEFAULT_MODEL;
    await chrome.storage.sync.set({ openaiModel: model });
  }
  if (modelInput) modelInput.value = model;
  updateApiStatus(!!(s.openaiApiKey?.trim()));
}

function wireSettings() {
  highlightCb?.addEventListener('change', () => chrome.storage.sync.set({ highlightOption: highlightCb.checked }));
  autoclickCb?.addEventListener('change', () => chrome.storage.sync.set({ autoClickOption: autoclickCb.checked }));
  silentModeCb?.addEventListener('change', () => chrome.storage.sync.set({ silentMode: silentModeCb.checked }));
  let delayDebounce = null;
  delaySlider?.addEventListener('input', () => {
    const v = parseFloat(delaySlider.value);
    if (delayDisplay) delayDisplay.textContent = String(v);
    clearTimeout(delayDebounce);
    delayDebounce = setTimeout(() => chrome.storage.sync.set({ answerDelay: v }), 250);
  });

  toggleOpenAI?.addEventListener('click', () => {
    const isHidden = openaiSection.classList.toggle('hidden');
    collapseArrow.textContent = isHidden ? '▸' : '▾';
  });

  saveBtn?.addEventListener('click', async () => {
    const key = apiKeyInput?.value.trim() || '';
    const model = modelInput?.value.trim() || 'gpt-5-mini';
    await chrome.storage.sync.set({ openaiApiKey: key, openaiModel: model });
    updateApiStatus(!!key);
    if (!key) { openaiSection.classList.remove('hidden'); collapseArrow.textContent = '▾'; }
    else { openaiSection.classList.add('hidden'); collapseArrow.textContent = '▸'; }
  });

  clearBtn?.addEventListener('click', async () => {
    await chrome.storage.sync.remove(['openaiApiKey', 'openaiModel']);
    if (apiKeyInput) apiKeyInput.value = '';
    if (modelInput) modelInput.value = 'gpt-5-mini';
    updateApiStatus(false);
  });
}

function updateApiStatus(hasKey) {
  if (!apiStatusEl) return;
  apiStatusEl.textContent = hasKey ? 'API key set' : 'No API key';
  apiStatusEl.classList.toggle('ok', hasKey);
  apiStatusEl.classList.toggle('warn', !hasKey);
}

// ─── Init ───────────────────────────────────────────────────────────

(async function init() {
  // Read version from manifest (single source of truth)
  if (versionLabel) versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
  await loadSettings();
  wireSettings();
  pollCurrentQuestion();
  const { openaiApiKey } = await chrome.storage.sync.get(['openaiApiKey']);
  if (!openaiApiKey?.trim()) {
    openaiSection?.classList.remove('hidden');
    if (collapseArrow) collapseArrow.textContent = '▾';
  }
})();
