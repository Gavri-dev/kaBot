// kaBot — Service worker
import { answerQuestion, answerMultiSelect, answerPinQuestion, answerJumbleQuestion, answerSliderQuestion, answerOpenEndedQuestion } from './openai.js';

const TAG = '[SW]';
const DEFAULT_MODEL = 'gpt-5-mini';

// ─── One-time migration: upgrade deprecated model strings ───────────
const DEPRECATED_MODELS = new Set([
  'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'gpt-4-turbo',
  'gpt-4', 'gpt-4-1106-preview', 'gpt-4-0125-preview'
]);

(async function migrateModel() {
  try {
    const { openaiModel } = await chrome.storage.sync.get(['openaiModel']);
    const current = (openaiModel || '').trim().toLowerCase();
    if (!current || DEPRECATED_MODELS.has(current)) {
      await chrome.storage.sync.set({ openaiModel: DEFAULT_MODEL });
      console.log(`${TAG} Migrated model "${current || '(empty)'}" → ${DEFAULT_MODEL}`);
    }
  } catch (_) {}
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processQuestion') {
    sendResponse({ received: true });
    const tabId = sender?.tab?.id;
    if (tabId) processQuestion(request.question, tabId);
  }
  if (request.action === 'checkStatus') {
    sendResponse({ status: 'running', timestamp: new Date().toISOString() });
  }
  return true;
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== 'manual-answer') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getQuestion' }).catch(() => null);
    if (resp?.question) await processQuestion(resp.question, tab.id);
  } catch (err) { console.error(`${TAG} Shortcut error:`, err); }
});

async function processQuestion(question, tabId) {
  const t0 = performance.now();
  console.log(`${TAG} Question: "${question.title}" | Type: ${question.type} | Choices: [${(question.choices || []).join(', ')}]`);

  try {
    const { openaiApiKey } = await chrome.storage.sync.get(['openaiApiKey']);
    if (!openaiApiKey?.trim()) {
      await safeSend(tabId, { action: 'showError', message: 'Set your OpenAI API key in the extension settings.' });
      return;
    }

    const settings = await chrome.storage.sync.get(['highlightOption', 'autoClickOption', 'answerDelay', 'silentMode']);
    const opts = {
      highlight: settings.highlightOption !== false,
      autoClick: settings.autoClickOption !== false,
      answerDelay: settings.answerDelay ?? 0,
      silentMode: !!settings.silentMode
    };

    if (question.type === 'pin_it') {
      let imageUrl = question.imageUrl;
      if (!imageUrl) {
        const resp = await chrome.tabs.sendMessage(tabId, { action: 'getPinImageUrl' }).catch(() => null);
        imageUrl = resp?.imageUrl;
      }
      if (!imageUrl) { await safeSend(tabId, { action: 'showError', message: 'Could not find image for pin question' }); return; }
      const coords = await answerPinQuestion(question.title, imageUrl);
      console.log(`${TAG} Pin: ${coords.x.toFixed(1)}%, ${coords.y.toFixed(1)}% (${Math.round(performance.now() - t0)}ms)`);
      await safeSend(tabId, { action: 'placePin', coords, options: opts });
      broadcastAnswer(`📍 ${coords.x.toFixed(1)}%, ${coords.y.toFixed(1)}%`);

    } else if (question.type === 'slider') {
      const sliderConfig = question.sliderConfig || {};
      const value = await answerSliderQuestion(question.title, sliderConfig);
      console.log(`${TAG} Slider: ${value} (${Math.round(performance.now() - t0)}ms)`);
      await safeSend(tabId, { action: 'setSlider', value, options: opts });
      broadcastAnswer(`🎚️ ${value}`);

    } else if (question.type === 'jumble') {
      const answerWord = await answerJumbleQuestion(question.title, question.choices);
      console.log(`${TAG} Jumble: "${answerWord}" (${Math.round(performance.now() - t0)}ms)`);
      await safeSend(tabId, { action: 'reorderJumble', answerWord, options: opts });
      broadcastAnswer(`🧩 ${answerWord}`);

    } else if (question.type === 'open_ended') {
      const answer = await answerOpenEndedQuestion(question.title);
      console.log(`${TAG} Open-ended: "${answer}" (${Math.round(performance.now() - t0)}ms)`);
      await safeSend(tabId, { action: 'typeOpenEnded', answer, options: opts });
      broadcastAnswer(`✏️ ${answer}`);

    } else {
      const isMulti = question.type === 'multiple_select_quiz';
      const answers = isMulti
        ? await answerMultiSelect(question.title, question.choices)
        : [await answerQuestion(question.title, question.choices)];
      console.log(`${TAG} Answer: [${answers.join(', ')}] (${Math.round(performance.now() - t0)}ms)`);
      await safeSend(tabId, { action: 'highlightAnswer', answers, isMultiSelect: isMulti, options: opts });
      broadcastAnswer(answers.join(', '));
    }
  } catch (err) {
    const typeLabel = question.type ? ` (${question.type})` : '';
    console.error(`${TAG} Failed${typeLabel}: ${err.message} (${Math.round(performance.now() - t0)}ms)`);
    await safeSend(tabId, { action: 'showError', message: `${err.message || 'Failed to get answer'}${typeLabel}` });
  }
}

function broadcastAnswer(answer) { try { chrome.runtime.sendMessage({ action: 'updateAnswer', answer }).catch(() => {}); } catch (_) {} }
async function safeSend(tabId, message) { try { await chrome.tabs.sendMessage(tabId, message); } catch (_) {} }
