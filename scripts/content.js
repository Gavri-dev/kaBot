// kaBot — Content script
// Bridges injected.js (page context) ↔ service worker (background)

'use strict';

// ─── Inject the WebSocket hook ───────────────────────────────────────
const script = document.createElement('script');
script.src = chrome.runtime.getURL('scripts/injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// ─── State ───────────────────────────────────────────────────────────
let currentQuestion = null;
let currentAnswer = null;
let lastSentHash = null;
let lastSentTitle = null;
let loadingEndsAt = 0; // timestamp when pre-question loading bar finishes
let pendingRetryHash = null;
let hasRetried = false;
let statusEl = null;
let activeToasts = [];
let submitNonce = 0;

let cachedSettings = {
  highlightOption: true,
  autoClickOption: true,
  answerDelay: 0,
  silentMode: false
};

function refreshSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['highlightOption', 'autoClickOption', 'answerDelay', 'silentMode'],
      s => {
        cachedSettings = {
          highlightOption: s.highlightOption !== false,
          autoClickOption: s.autoClickOption !== false,
          answerDelay: s.answerDelay ?? 0,
          silentMode: !!s.silentMode
        };
        resolve(cachedSettings);
      }
    );
  });
}

chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns !== 'sync') return;
  if ('highlightOption' in changes) cachedSettings.highlightOption = changes.highlightOption.newValue !== false;
  if ('autoClickOption' in changes) cachedSettings.autoClickOption = changes.autoClickOption.newValue !== false;
  if ('answerDelay' in changes) cachedSettings.answerDelay = changes.answerDelay.newValue ?? 0;
  if ('silentMode' in changes) cachedSettings.silentMode = !!changes.silentMode.newValue;
  if (changes.silentMode?.newValue) {
    removeStatusIndicator();
    removeTimerOverlay();
  }
});

// ─── Status Indicator ────────────────────────────────────────────────
function createStatusIndicator() {
  if (statusEl || cachedSettings.silentMode) return;
  statusEl = document.createElement('div');
  statusEl.id = 'kabot-status';
  statusEl.style.cssText = `
    position:fixed; top:10px; right:10px;
    background:rgba(0,0,0,.8); color:#fff;
    padding:8px 12px; border-radius:8px; z-index:10000;
    font:600 12px/1.4 system-ui,sans-serif;
    max-width:300px; word-wrap:break-word;
    pointer-events:none; transition:opacity .3s;
    backdrop-filter:blur(6px);
  `;
  statusEl.innerHTML = '<div id="kabot-status-main">kaBot: Ready</div><div id="kabot-status-detail" style="font-weight:400;font-size:11px;opacity:.7;margin-top:2px;display:none"></div>';
  document.body?.appendChild(statusEl);
}

function updateStatus(msg, detail) {
  if (cachedSettings.silentMode) return;
  if (!statusEl) createStatusIndicator();
  if (!statusEl) return;
  const mainEl = statusEl.querySelector('#kabot-status-main');
  const detailEl = statusEl.querySelector('#kabot-status-detail');
  if (mainEl) mainEl.textContent = `kaBot: ${msg}`;
  if (detailEl) {
    if (detail) { detailEl.textContent = detail; detailEl.style.display = 'block'; }
    else detailEl.style.display = 'none';
  }
}

function removeStatusIndicator() { statusEl?.remove(); statusEl = null; }

// ─── Error Toasts ────────────────────────────────────────────────────
function showErrorToast(message) {
  if (cachedSettings.silentMode) return;
  while (activeToasts.length >= 3) { const old = activeToasts.shift(); old?.remove(); }
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; top:${20 + activeToasts.length * 55}px; right:20px;
    background:#e74c3c; color:#fff;
    padding:12px 16px; border-radius:8px; z-index:9999;
    font:600 13px/1.3 system-ui,sans-serif;
    max-width:300px; box-shadow:0 4px 12px rgba(0,0,0,.3);
    animation: kabot-fadein .25s ease-out;
  `;
  toast.textContent = message;
  document.body?.appendChild(toast);
  activeToasts.push(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => { toast.remove(); activeToasts = activeToasts.filter(t => t !== toast); }, 300);
  }, 4500);
}

// ─── Hashing ─────────────────────────────────────────────────────────
function questionHash(q) { return JSON.stringify({ t: q.title, c: q.choices }); }

// ─── Send question to service worker ─────────────────────────────────
function sendQuestionToBackend(question) {
  lastSentHash = questionHash(question);
  const shortQ = question.title.length > 60 ? question.title.slice(0, 57) + '...' : question.title;
  updateStatus('Sending to AI...', shortQ);
  chrome.runtime.sendMessage({ action: 'processQuestion', question }, () => {
    if (chrome.runtime.lastError) {
      updateStatus('Error: ' + chrome.runtime.lastError.message);
      lastSentHash = null; lastSentTitle = null;
    }
  });
}

// ─── Message Handling ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case 'highlightAnswer': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);

      const answersFromAI = request.answers || [];

      // Reject stale answers that don't match current question's choices
      const currentChoices = currentQuestion?.choices || [];
      if (currentChoices.length > 0 && answersFromAI.length > 0) {
        const anyMatch = answersFromAI.some(a => {
          const aLow = a.toLowerCase().trim();
          // Allow "Image N" only if current choices also have Image N placeholders
          if (/^image\s*\d+$/i.test(aLow)) {
            return currentChoices.some(c => /^image\s*\d+$/i.test(c));
          }
          return currentChoices.some(c => {
            const cLow = c.toLowerCase().trim();
            return cLow === aLow || cLow.includes(aLow) || aLow.includes(cLow);
          });
        });
        if (!anyMatch) {
          console.warn('[kaBot] Stale answer rejected:', answersFromAI, 'vs choices:', currentChoices);
          sendResponse({ success: false });
          break;
        }
      }

      currentAnswer = answersFromAI.join(', ');
      const shortA = currentAnswer.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer;
      updateStatus('Answer received ✅', shortA);
      try { chrome.runtime.sendMessage({ action: 'updateAnswer', answer: currentAnswer }).catch(() => {}); } catch (_) {}
      cleanupOverlays();
      console.log('[kaBot] Answers from AI:', JSON.stringify(answersFromAI), 'multiSelect:', request.isMultiSelect);
      highlightAnswers(answersFromAI, request.isMultiSelect, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'getQuestion':
      sendResponse({ question: currentQuestion, answer: currentAnswer });
      break;

    case 'showError':
      updateStatus('Error ❌', request.message);
      showErrorToast(request.message);
      sendResponse({ success: true });
      if (currentQuestion && !hasRetried && !request.message?.includes('API key')) {
        hasRetried = true;
        pendingRetryHash = questionHash(currentQuestion);
        lastSentHash = pendingRetryHash;
        updateStatus('Retrying in 2s...');
        setTimeout(() => {
          if (currentQuestion && pendingRetryHash === questionHash(currentQuestion)) sendQuestionToBackend(currentQuestion);
          pendingRetryHash = null;
        }, 2000);
      } else {
        lastSentHash = null; lastSentTitle = null;
      }
      break;

    case 'checkStatus':
      sendResponse({ status: 'running', currentQuestion, timestamp: new Date().toISOString() });
      break;

    case 'getPinImageUrl':
      sendResponse({ imageUrl: extractPinImageUrl() });
      break;

    case 'placePin': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `📍 ${request.coords.x.toFixed(1)}%, ${request.coords.y.toFixed(1)}%`;
      updateStatus('Placing pin...', currentAnswer);
      try { chrome.runtime.sendMessage({ action: 'updateAnswer', answer: currentAnswer }).catch(() => {}); } catch (_) {}
      placePinOnSvg(request.coords, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'reorderJumble': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `🧩 ${request.answerWord}`;
      updateStatus('Solving jumble...', currentAnswer);
      try { chrome.runtime.sendMessage({ action: 'updateAnswer', answer: currentAnswer }).catch(() => {}); } catch (_) {}
      solveJumbleFromDOM(request.answerWord, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'setSlider': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `🎚️ ${request.value}`;
      updateStatus('Setting slider...', currentAnswer);
      try { chrome.runtime.sendMessage({ action: 'updateAnswer', answer: currentAnswer }).catch(() => {}); } catch (_) {}
      solveSliderFromDOM(request.value, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'typeOpenEnded': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `✏️ ${request.answer}`;
      updateStatus('Typing answer...', currentAnswer);
      try { chrome.runtime.sendMessage({ action: 'updateAnswer', answer: currentAnswer }).catch(() => {}); } catch (_) {}
      dispatchOpenEndedAnswer(request.answer, request.options);
      sendResponse({ success: true });
      break;
    }
  }
  return true;
});

// ─── Game Reset (clear stale dedup state) ────────────────────────────
window.addEventListener('kahootGameReset', () => {
  console.log('[kaBot] Game reset — clearing state');
  currentQuestion = null;
  currentAnswer = null;
  lastSentHash = null; lastSentTitle = null;
  pendingRetryHash = null;
  hasRetried = false;
  submitNonce++;
  cleanupOverlays();
  removeStatusIndicator();
});

// Non-scored question (survey/poll) → clear status since bot won't act
window.addEventListener('kahootNonScoredQuestion', (event) => {
  console.log(`[kaBot] Non-scored question (${event.detail?.type}) — clearing status`);
  removeStatusIndicator();
  cleanupOverlays();
});

// Detect navigation away from game screens (ranking, lobby, home)
// Kahoot is a SPA — content scripts can't intercept pushState, so we poll
(function watchNavigation() {
  const GAME_PATHS = ['/gameblock', '/getready', '/start'];
  let lastPath = location.pathname;

  setInterval(() => {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const inGame = GAME_PATHS.some(p => path.includes(p));
    if (!inGame && statusEl) {
      console.log(`[kaBot] Left game screen (${path}) — clearing status`);
      removeStatusIndicator();
      cleanupOverlays();
    }
  }, 2000);
})();

// ─── Question Detection ──────────────────────────────────────────────
window.addEventListener('kahootQuestionParsed', async (event) => {
  const q = event.detail;
  if (!q?.title) return;

  const isPin = q.type === 'pin_it';
  const isJumble = q.type === 'jumble';
  const isSlider = q.type === 'slider';
  const isOpenEnded = q.type === 'open_ended';

  if (!isPin && !isJumble && !isSlider && !isOpenEnded && (!Array.isArray(q.choices) || q.choices.length === 0)) return;

  // Hash-based dedup: skip if already sent this exact question+choices combo
  const incomingHash = questionHash({ title: q.title, choices: q.choices || [] });
  if (lastSentHash === incomingHash) {
    console.debug('[kaBot] Dedup: skipping duplicate WS event for "' + q.title.slice(0, 40) + '"');
    return;
  }

  // Title lock: prevent concurrent polling for the same question
  if (lastSentTitle === q.title) {
    console.debug('[kaBot] Dedup: already polling for "' + q.title.slice(0, 40) + '"');
    return;
  }
  lastSentTitle = q.title;

  // Capture loading bar timing before async work.
  // Kahoot renders the bar slightly after the WS event, so poll briefly to catch it.
  loadingEndsAt = 0;
  for (let i = 0; i < 10; i++) {
    const loadBar = document.querySelector('[data-functional-selector="loading-bar-progress"]');
    if (loadBar) {
      const cs = getComputedStyle(loadBar);
      const dur = parseFloat(cs.getPropertyValue('--animation-duration')) || 0;
      const del = parseFloat(cs.getPropertyValue('--animation-delay')) || 0;
      if (dur + del > 0) {
        // Buffer for intro animations (multi-select icon, double points badge)
        const introBuffer = 1500;
        loadingEndsAt = Date.now() + dur + del + introBuffer;
        console.log(`[kaBot] Loading bar found: ${dur}+${del}+${introBuffer}ms buffer = ${dur + del + introBuffer}ms total`);
        break;
      }
    }
    await new Promise(r => setTimeout(r, 50));
  }

  // Clean up previous question's overlays
  cleanupOverlays();

  // Jumble: poll DOM for tiles
  if (isJumble) {
    const domTiles = await pollForJumbleTiles();
    if (domTiles.length > 0) {
      q.choices = domTiles;
      console.log('[kaBot] Jumble tiles from DOM:', domTiles);
    } else if (!q.choices?.length) {
      console.warn('[kaBot] No jumble tiles found');
      return;
    }
  }

  // Slider: send to AI immediately with partial config (min/max come from DOM later)
  if (isSlider && !q.sliderConfig) {
    q.sliderConfig = { min: null, max: null, step: null, unit: '' };
  }

  await refreshSettings();

  // Resolve image-based choices from DOM before sending to AI
  if (!isPin && !isJumble && !isSlider && !isOpenEnded && q.choices.some(c => !c || /^Image \d+$/.test(c))) {
    const labels = await pollForImageLabels(q.choices.length);
    if (labels.length === q.choices.length && labels.some(l => l && !/^Image \d+$/i.test(l))) {
      q.choices = labels;
      console.log('[kaBot] Image choices resolved:', labels);
    } else {
      console.log('[kaBot] Image labels not resolved, using placeholders:', q.choices);
    }
  }

  // Check dedup again after async polling
  const postPollHash = questionHash({ title: q.title, choices: q.choices || [] });
  if (lastSentHash === postPollHash) {
    console.debug('[kaBot] Dedup: post-poll duplicate, skipping');
    return;
  }

  currentQuestion = { title: q.title, choices: q.choices || [], type: q.type, imageUrl: q.imageUrl, ...(q.sliderConfig ? { sliderConfig: q.sliderConfig } : {}) };
  submitNonce++;
  currentAnswer = null;
  hasRetried = false;
  pendingRetryHash = null;

  try { chrome.runtime.sendMessage({ action: 'updateQuestion', question: { title: q.title, choices: q.choices || [] } }).catch(() => {}); } catch (_) {}
  sendQuestionToBackend(q);
});

// ─── Cleanup ─────────────────────────────────────────────────────────
function cleanupOverlays() {
  document.querySelectorAll('.kabot-pin-crosshair, .kabot-jumble-badge, .kabot-checkmark').forEach(el => el.remove());
  for (const el of findAnswerElements()) {
    el.style.border = '';
    el.style.boxShadow = '';
    el.style.borderRadius = '';
    el.style.transition = '';
  }
}

// ─── DOM Polling Helpers ─────────────────────────────────────────────

function pollForImageLabels(expectedCount, attempt = 0) {
  // Image-based answer buttons take much longer to render than text ones.
  // 40 attempts × 250ms = 10 seconds max wait.
  return new Promise(resolve => {
    const tryExtract = () => {
      const elements = findAnswerElements();
      if (elements.length >= expectedCount) {
        const labels = elements.slice(0, expectedCount).map(el => cleanButtonText(el));
        const hasReal = labels.some(l => l.length > 0 && !/^image\s*\d+$/i.test(l));
        if (hasReal) { resolve(labels); return; }
      }
      if (attempt < 40) {
        setTimeout(() => pollForImageLabels(expectedCount, attempt + 1).then(resolve), 250);
      } else {
        // Last resort: return whatever we have
        const els = findAnswerElements();
        resolve(els.length > 0
          ? els.slice(0, expectedCount).map(el => cleanButtonText(el))
          : Array.from({ length: expectedCount }, (_, i) => `Image ${i + 1}`)
        );
      }
    };
    tryExtract();
  });
}

function pollForJumbleTiles(attempt = 0) {
  return new Promise(resolve => {
    const tryExtract = () => {
      const tiles = [];
      let i = 0;
      while (true) {
        const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
        if (!el) break;
        tiles.push(el.textContent?.trim() || '');
        i++;
      }
      if (tiles.length === 0) {
        const cards = document.querySelectorAll('[data-functional-selector^="draggable-jumble-card-"]');
        for (const card of cards) tiles.push(card.getAttribute('aria-label') || card.textContent?.trim() || '');
      }
      if (tiles.length > 0 && tiles.some(t => t.length > 0)) resolve(tiles);
      else if (attempt < 15) setTimeout(() => pollForJumbleTiles(attempt + 1).then(resolve), 150);
      else resolve(tiles);
    };
    tryExtract();
  });
}

function pollForJumbleTextEls(attempt = 0) {
  return new Promise(resolve => {
    const tryExtract = () => {
      const els = [];
      let i = 0;
      while (true) {
        const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
        if (!el) break;
        els.push(el);
        i++;
      }
      if (els.length > 0) {
        console.log(`[kaBot] Found ${els.length} jumble text elements after ${attempt} polls`);
        resolve(els);
      } else if (attempt < 20) {
        setTimeout(() => pollForJumbleTextEls(attempt + 1).then(resolve), 150);
      } else {
        resolve(els);
      }
    };
    tryExtract();
  });
}

// ─── Answer Element Finding ──────────────────────────────────────────

const ANSWER_SELECTORS = [
  'button[data-functional-selector^="answer-"]',
  '[data-functional-selector="answer-option"]',
  '.answer-option',
  '[data-functional-selector="answer"]',
  '.answer',
  '[data-functional-selector="answer-button"]',
  '.answer-button',
  'button[data-functional-selector*="answer"]',
  'button[class*="answer"]',
  'button[class*="choice__Choice"]',
];

function findAnswerElements() {
  for (const sel of ANSWER_SELECTORS) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) return Array.from(els);
  }
  return [];
}

// ─── Text Cleaning & Matching ────────────────────────────────────────

function cleanButtonText(el) {
  if (!el) return '';
  const img = el.querySelector('img[aria-label]');
  if (img) {
    const label = img.getAttribute('aria-label')?.trim();
    if (label) return label.toLowerCase();
  }
  // Clone and strip injected elements to avoid reading checkmarks
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.kabot-checkmark').forEach(c => c.remove());
  let text = clone.textContent.toLowerCase().trim().replace(/icon/gi, '').replace(/\s+/g, ' ').trim();
  // Deduplicate repeated text (Kahoot sometimes renders label twice in DOM)
  for (const divisor of [3, 2]) {
    if (text.length >= divisor * 2) {
      const chunk = text.length / divisor;
      if (Number.isInteger(chunk)) {
        const part = text.substring(0, chunk);
        if (part.repeat(divisor) === text) { text = part; break; }
      }
    }
  }
  return text;
}

function matchScore(buttonText, answer) {
  const a = buttonText.toLowerCase().trim();
  const b = answer.toLowerCase().trim();
  if (a === b) return 100;
  if (a.includes(b) && b.length > 2) return 85;
  if (b.includes(a) && a.length > 2) return 70;
  const wordsA = a.split(/\s+/), wordsB = b.split(/\s+/);
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb))).length;
  const maxLen = Math.max(wordsA.length, wordsB.length);
  if (maxLen === 0) return 0;
  return Math.round((overlap / maxLen) * 100);
}

// ─── Highlight & Click ──────────────────────────────────────────────

async function highlightAnswers(answers, isMultiSelect, options) {
  // Poll for answer buttons immediately — click the instant they appear.
  // Timeout: max(remaining loading time + 8s safety, 12s)
  const remaining = (loadingEndsAt > 0) ? Math.max(loadingEndsAt - Date.now(), 0) : 0;
  const maxWait = Math.max(remaining + 8000, 12000);
  const start = Date.now();
  const interval = 150; // fast polling

  if (remaining > 0) {
    console.log(`[kaBot] Loading bar: ${remaining}ms remaining, polling until buttons appear`);
  }

  while (Date.now() - start < maxWait) {
    const elements = findAnswerElements();
    if (elements.length > 0) {
      applyHighlights(elements, answers, isMultiSelect, options);
      return;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  updateStatus('No answer buttons found');
}

function applyHighlights(elements, answers, isMultiSelect, options) {
  const matchedElements = [];

  console.log('[kaBot] Button texts:', elements.map(el => cleanButtonText(el)));

  for (const answer of answers) {
    let bestEl = null, bestScore = 0, indexFallback = null;

    // "Image N" — direct index match
    const imageMatch = answer.match(/^Image\s*(\d+)$/i);
    if (imageMatch) {
      const idx = parseInt(imageMatch[1]) - 1;
      if (idx >= 0 && idx < elements.length && !matchedElements.some(m => m.el === elements[idx])) {
        matchedElements.push({ el: elements[idx], answer, score: 100 });
        continue;
      }
    }

    // "Answer N" / bare number fallback
    const numMatch = answer.match(/^(?:Answer|Option|Choice)?\s*(\d+)$/i);
    if (numMatch) {
      const idx = parseInt(numMatch[1]) - 1;
      if (idx >= 0 && idx < elements.length) indexFallback = elements[idx];
    }

    // Text matching
    for (const el of elements) {
      if (matchedElements.some(m => m.el === el)) continue;
      const text = cleanButtonText(el);
      const score = matchScore(text, answer);
      if (score === 100) { bestEl = el; bestScore = 100; break; }
      if (score > bestScore) { bestScore = score; bestEl = el; }
    }

    if (bestEl && bestScore >= 55) {
      console.log(`[kaBot] Matched "${answer}" → "${cleanButtonText(bestEl)}" (score=${bestScore})`);
      matchedElements.push({ el: bestEl, answer, score: bestScore });
    } else if (bestEl && bestScore >= 45 && !isMultiSelect && matchedElements.length === 0) {
      console.log(`[kaBot] Weak match "${answer}" → "${cleanButtonText(bestEl)}" (score=${bestScore})`);
      matchedElements.push({ el: bestEl, answer, score: bestScore });
    } else if (indexFallback && !matchedElements.some(m => m.el === indexFallback)) {
      console.log(`[kaBot] Index fallback for "${answer}"`);
      matchedElements.push({ el: indexFallback, answer, score: 50 });
    } else {
      console.warn(`[kaBot] No match for "${answer}" (best score: ${bestScore})`);
    }
  }

  if (matchedElements.length === 0) { updateStatus('Could not match answers'); return; }

  // Apply visual highlights + checkmarks
  if (options.highlight !== false && !options.silentMode) {
    for (const { el } of matchedElements) {
      el.style.border = '3px solid #00c853';
      el.style.boxShadow = '0 0 16px 4px rgba(0,200,83,.7)';
      el.style.borderRadius = '10px';
      el.style.transition = 'all .3s ease';
      el.animate([
        { transform: 'scale(1)', boxShadow: '0 0 12px 3px rgba(0,200,83,.5)' },
        { transform: 'scale(1.04)', boxShadow: '0 0 20px 5px rgba(0,200,83,.8)' },
        { transform: 'scale(1)', boxShadow: '0 0 12px 3px rgba(0,200,83,.5)' }
      ], { duration: 800, iterations: 3 });

      // For image-based answers, use a large floating badge overlay
      const hasImage = el.querySelector('img[data-functional-selector="image-answer"]');
      if (hasImage) {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        const badge = document.createElement('div');
        badge.className = 'kabot-checkmark';
        badge.textContent = '✅';
        badge.style.cssText = `
          position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
          font-size:3rem; z-index:10000; pointer-events:none;
          filter:drop-shadow(0 2px 8px rgba(0,0,0,0.7));
          animation:kabot-fadein .3s ease-out;
        `;
        el.appendChild(badge);
      } else {
        const check = document.createElement('span');
        check.textContent = ' ✅';
        check.style.cssText = 'font-size:1.2em; margin-left:6px; vertical-align:middle;';
        check.className = 'kabot-checkmark';
        el.appendChild(check);
      }
    }
  }

  // Auto-click
  if (options.autoClick !== false) {
    const matchedIndices = matchedElements.map(m => elements.indexOf(m.el)).filter(i => i >= 0);
    if (isMultiSelect && matchedIndices.length > 0) {
      waitForClickable(matchedElements[0].el, () => fireMultiClick(matchedIndices, elements), options);
    } else if (matchedIndices.length > 0) {
      waitForClickable(matchedElements[0].el, () => fireClick(matchedIndices[0]), options);
    }
  }
}

// ─── Click Execution ────────────────────────────────────────────────

function waitForClickable(element, callback, options, retries = 15) {
  if (!element) return;
  if (!element.disabled && element.offsetParent !== null) {
    const delay = options.answerDelay ?? 0;
    if (delay > 0) {
      if (!options.silentMode) showTimerOverlay(delay, callback);
      else setTimeout(callback, delay * 1000);
    } else {
      callback();
    }
  } else if (retries > 0) {
    setTimeout(() => waitForClickable(element, callback, options, retries - 1), 500);
  } else {
    updateStatus('Button never became clickable');
  }
}

function fireClick(index) {
  window.dispatchEvent(new CustomEvent('autoClickAnswer', { detail: index }));
  const shortA = currentAnswer?.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer;
  updateStatus('Answered ✅', shortA);
}

function fireMultiClick(indices, allElements) {
  // Send via WS (primary submission path)
  window.dispatchEvent(new CustomEvent('autoClickMultiSelect', { detail: indices }));
  // DOM clicks to sync React state / UI selection visuals
  for (const idx of indices) {
    if (allElements[idx]) {
      try { allElements[idx].click(); } catch (_) {}
    }
  }
  // Submit button as fallback — some Kahoot versions need it
  setTimeout(() => clickSubmitButton('multi-select'), 600);
  const shortA = currentAnswer?.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer;
  updateStatus('Answered ✅', shortA);
}

// ─── Unified Submit Button Finder ────────────────────────────────────

function clickSubmitButton(context = 'generic', attempt = 0, nonce = submitNonce) {
  if (nonce !== submitNonce) return;

  const SELECTORS = [
    'button[data-functional-selector="submit-button"]',
    'button[data-functional-selector="multi-select-submit-button"]',
    'button[data-functional-selector="multi-select-submit"]',
    'button[data-functional-selector="pin-answer-submit"]',
    'button[data-functional-selector="jumble-submit-button"]',
    'button[data-functional-selector="slider-submit"]',
    'button[data-functional-selector="text-answer-submit"]',
    'button[data-functional-selector*="submit"]',
    'button[data-functional-selector="confirm"]',
    'button[type="submit"]',
  ];

  for (const sel of SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled && btn.offsetParent !== null) {
      console.log(`[kaBot] Clicking ${context} submit via: ${sel}`);
      btn.click();
      updateStatus('Answered ✅', currentAnswer?.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer);
      return;
    }
  }

  // Text-based fallback
  for (const btn of document.querySelectorAll('button')) {
    const text = btn.textContent.trim().toLowerCase();
    if (['submit', 'confirm', 'done', 'check'].includes(text) && !btn.disabled && btn.offsetParent !== null) {
      console.log(`[kaBot] Clicking ${context} submit via text: "${text}"`);
      btn.click();
      updateStatus('Answered ✅', currentAnswer?.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer);
      return;
    }
  }

  if (attempt < 12) {
    setTimeout(() => clickSubmitButton(context, attempt + 1, nonce), 400);
  } else {
    console.log(`[kaBot] No ${context} submit button found after 12 attempts (WS likely already submitted)`);
    updateStatus('Answered ✅', currentAnswer?.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer);
  }
}

// ─── Timer Overlay ───────────────────────────────────────────────────

function removeTimerOverlay() { document.getElementById('kabot-timer')?.remove(); }

function showTimerOverlay(duration, callback) {
  removeTimerOverlay();
  if (!document.getElementById('kabot-timer-css')) {
    const css = document.createElement('style');
    css.id = 'kabot-timer-css';
    css.textContent = `
      @keyframes kabot-slide-in  { from { transform:translateX(120%); opacity:0 } to { transform:translateX(0); opacity:1 } }
      @keyframes kabot-slide-out { from { transform:translateX(0); opacity:1 } to { transform:translateX(120%); opacity:0 } }
    `;
    document.head?.appendChild(css);
  }

  const overlay = document.createElement('div');
  overlay.id = 'kabot-timer';
  overlay.style.cssText = `
    position:fixed; top:20px; right:20px;
    background:linear-gradient(135deg,rgba(138,43,226,.92),rgba(218,112,214,.92));
    color:#fff; padding:14px 18px; border-radius:12px;
    z-index:10001; font:600 14px/1.3 system-ui,sans-serif;
    box-shadow:0 6px 20px rgba(0,0,0,.35); min-width:180px;
    animation:kabot-slide-in .25s ease-out;
    backdrop-filter:blur(8px);
  `;

  const label = document.createElement('div');
  label.textContent = `Answering in ${duration}s…`;
  label.style.cssText = 'margin-bottom:8px; font-size:13px;';

  const track = document.createElement('div');
  track.style.cssText = 'width:100%; height:6px; border-radius:3px; background:rgba(255,255,255,.2); overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = `width:100%; height:100%; border-radius:3px; background:#fff; transition:width ${duration}s linear;`;
  track.appendChild(fill);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Skip wait';
  cancelBtn.style.cssText = 'margin-top:8px; background:rgba(255,255,255,.2); border:none; color:#fff; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;';

  overlay.append(label, track, cancelBtn);
  (document.body || document.documentElement).appendChild(overlay);
  requestAnimationFrame(() => { fill.style.width = '0%'; });

  let fired = false;
  const fire = () => { if (fired) return; fired = true; slideOutAndRemove(overlay, callback); };

  const timer = setTimeout(fire, duration * 1000);
  cancelBtn.addEventListener('click', () => { clearTimeout(timer); fire(); });
  fill.addEventListener('transitionend', () => { if (!fired) { clearTimeout(timer); fire(); } }, { once: true });
}

function slideOutAndRemove(el, afterRemove) {
  el.style.animation = 'kabot-slide-out .25s ease-in forwards';
  setTimeout(() => { el.remove(); afterRemove?.(); }, 260);
}

// ─── Pin Question Support ────────────────────────────────────────────

function extractPinImageUrl() {
  const svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
  if (svgEl) {
    const imgEl = svgEl.querySelector('image[href], image[xlink\\:href]');
    if (imgEl) {
      const url = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
      if (url) return url;
    }
  }
  const scaledImg = document.querySelector('[data-functional-selector="media-container__media-image"]');
  if (scaledImg) {
    const url = scaledImg.getAttribute('href') || scaledImg.getAttribute('src');
    if (url) return url;
  }
  return null;
}

async function placePinOnSvg(coords, options = {}) {
  // Poll aggressively for SVG — don't wait for full loading timer
  const deadline = (loadingEndsAt > 0 ? loadingEndsAt : Date.now()) + 5000;
  let svgEl = null;

  for (let attempt = 0; attempt < 80; attempt++) {
    svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
    if (svgEl) {
      const rect = svgEl.getBoundingClientRect();
      const isVisible = rect.width > 50 && rect.height > 50;
      const noLoadingOverlay = !document.querySelector('[data-functional-selector="loading-bar-progress"]');
      if (isVisible && noLoadingOverlay) {
        // Tiny settle for CSS transitions
        await new Promise(r => setTimeout(r, 100));
        console.log(`[kaBot] Pin: SVG visible, overlay clear (attempt ${attempt}, ${Date.now()})`);
        break;
      }
    }
    svgEl = null;
    if (Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 100)); // 100ms polls (fast)
  }

  if (!svgEl) {
    svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
    if (!svgEl) { updateStatus('Pin SVG not found'); return; }
    console.warn('[kaBot] Pin: proceeding despite overlay check');
  }

  console.log(`[kaBot] Pin: placing at ${coords.x.toFixed(1)}%, ${coords.y.toFixed(1)}%`);

  // Dispatch to injected.js for coordinate conversion + React state + WS submission
  // No submit button click needed — WS is the authoritative answer path
  const doPlace = () => {
    window.dispatchEvent(new CustomEvent('autoPinAnswer', { detail: { x: coords.x, y: coords.y } }));
  };

  if (options.autoClick !== false) {
    const delay = options.answerDelay ?? 0;
    if (delay > 0) {
      if (!options.silentMode) showTimerOverlay(delay, doPlace);
      else setTimeout(doPlace, delay * 1000);
    } else {
      doPlace();
    }
  } else {
    if (options.highlight !== false) showPinCrosshair(svgEl, coords);
    updateStatus('Pin here 📍', `${coords.x.toFixed(1)}%, ${coords.y.toFixed(1)}%`);
  }
}

// ─── Pin Crosshair ──────────────────────────────────────────────────

function showPinCrosshair(svgEl, coords) {
  document.querySelectorAll('.kabot-pin-crosshair').forEach(el => el.remove());

  const imgEl = svgEl.querySelector('image[href], image[xlink\\:href]') || svgEl.querySelector('image');
  const imgX = parseFloat(imgEl?.getAttribute('x') || '0');
  const imgY = parseFloat(imgEl?.getAttribute('y') || '0');
  const imgWidth = parseFloat(imgEl?.getAttribute('width') || '0');
  const imgHeight = parseFloat(imgEl?.getAttribute('height') || '0');
  const viewBox = svgEl.getAttribute('viewBox');
  let vbWidth = imgWidth, vbHeight = imgHeight;
  if (viewBox) { const vb = viewBox.trim().split(/[\s,]+/).map(Number); vbWidth = vb[2] || imgWidth; vbHeight = vb[3] || imgHeight; }

  const svgTargetX = imgX + (coords.x / 100) * (imgWidth || vbWidth);
  const svgTargetY = imgY + (coords.y / 100) * (imgHeight || vbHeight);

  let screenX, screenY;
  const ctm = svgEl.getScreenCTM();
  if (ctm) {
    const pt = svgEl.createSVGPoint();
    pt.x = svgTargetX; pt.y = svgTargetY;
    const sp = pt.matrixTransform(ctm);
    screenX = sp.x; screenY = sp.y;
  } else {
    const rect = svgEl.getBoundingClientRect();
    const vb = viewBox ? viewBox.trim().split(/[\s,]+/).map(Number) : [0, 0, rect.width, rect.height];
    screenX = rect.left + ((svgTargetX - vb[0]) / vb[2]) * rect.width;
    screenY = rect.top + ((svgTargetY - vb[1]) / vb[3]) * rect.height;
  }

  const crosshair = document.createElement('div');
  crosshair.className = 'kabot-pin-crosshair';
  crosshair.style.cssText = `position:fixed; left:${screenX}px; top:${screenY}px; transform:translate(-50%,-50%); z-index:9999; pointer-events:none; width:0; height:0;`;

  const ring = document.createElement('div');
  ring.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:40px; height:40px; border:3px solid #ff3333; border-radius:50%; animation:kabot-pulse 1.2s ease-in-out infinite;';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:12px; height:12px; background:#ff3333; border-radius:50%; box-shadow:0 0 6px rgba(255,51,51,0.6);';
  const hLine = document.createElement('div');
  hLine.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:60px; height:2px; background:rgba(255,51,51,0.7);';
  const vLine = document.createElement('div');
  vLine.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:2px; height:60px; background:rgba(255,51,51,0.7);';
  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'position:absolute; left:calc(50% + 16px); top:calc(50% + 16px); background:rgba(0,0,0,0.85); color:#fff; padding:3px 8px; border-radius:4px; font:600 11px/1.3 monospace; white-space:nowrap;';
  labelEl.textContent = `📍 ${coords.x.toFixed(0)}%, ${coords.y.toFixed(0)}%`;

  if (!document.getElementById('kabot-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'kabot-pulse-style';
    style.textContent = '@keyframes kabot-pulse { 0%,100% { width:40px; height:40px; opacity:.9 } 50% { width:56px; height:56px; opacity:.4 } }';
    document.head.appendChild(style);
  }

  crosshair.append(ring, dot, hLine, vLine, labelEl);
  (document.body || document.documentElement).appendChild(crosshair);

  let rafId;
  function updatePosition() {
    if (!crosshair.isConnected) return;
    const newCtm = svgEl.getScreenCTM();
    if (newCtm) {
      const pt2 = svgEl.createSVGPoint();
      pt2.x = svgTargetX; pt2.y = svgTargetY;
      const sp2 = pt2.matrixTransform(newCtm);
      crosshair.style.left = sp2.x + 'px';
      crosshair.style.top = sp2.y + 'px';
    }
    rafId = requestAnimationFrame(updatePosition);
  }
  rafId = requestAnimationFrame(updatePosition);

  const observer = new MutationObserver(() => {
    if (!crosshair.isConnected || !svgEl.isConnected || !document.querySelector('[data-functional-selector="pin-input-svg"]')) {
      crosshair.remove(); cancelAnimationFrame(rafId); observer.disconnect();
    }
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  setTimeout(() => { if (crosshair.isConnected) { crosshair.remove(); cancelAnimationFrame(rafId); observer.disconnect(); } }, 60000);
}

// ─── Jumble Solver ──────────────────────────────────────────────────

async function solveJumbleFromDOM(answerWord, options) {
  // Wait for loading bar to finish — arranger container doesn't exist during loading
  if (loadingEndsAt > 0) {
    const remaining = loadingEndsAt - Date.now();
    if (remaining > 0) {
      console.log(`[kaBot] Jumble: waiting ${remaining}ms for loading to finish`);
      await new Promise(r => setTimeout(r, remaining));
    }
  }

  // Poll for arranger container to confirm interactive screen is ready
  for (let i = 0; i < 30; i++) {
    if (document.querySelector('[class*="arranger__Container"]')) break;
    await new Promise(r => setTimeout(r, 200));
  }

  let injectedHandled = false;
  const onHandled = () => { injectedHandled = true; };
  window.addEventListener('kabotJumbleHandled', onHandled, { once: true });

  window.dispatchEvent(new CustomEvent('autoJumbleAnswer', { detail: { answerWord, autoClick: options.autoClick !== false } }));

  await new Promise(r => setTimeout(r, 1500));
  window.removeEventListener('kabotJumbleHandled', onHandled);

  if (injectedHandled) {
    console.log('[kaBot] Jumble handled by injected.js (React state)');
    updateStatus('Answered ✅ (jumble)', answerWord);
    return;
  }

  console.log('[kaBot] Injected.js did not handle jumble, trying DOM clicks');

  const textEls = await pollForJumbleTextEls();
  if (textEls.length === 0) { updateStatus('Jumble tiles not found'); return; }

  const labels = textEls.map(el => el.textContent?.trim() || '');
  console.log('[kaBot] Jumble tile labels:', labels);

  const order = computeTileOrder(answerWord, labels);
  if (!order) { updateStatus(`Can't map answer to tiles`); return; }
  console.log(`[kaBot] Tile order: [${order}] → "${order.map(i => labels[i]).join('')}"`);

  // Show badges
  if (options.highlight !== false && !options.silentMode) showJumbleBadges(textEls, order);

  if (options.autoClick === false) {
    updateStatus('Jumble order shown', answerWord);
    return;
  }

  const doClick = () => {
    clickJumbleTilesSequence(textEls, order, () => {
      setTimeout(() => clickSubmitButton('jumble'), 500);
    });
  };

  const delay = options.answerDelay ?? 0;
  if (delay > 0) {
    if (!options.silentMode) showTimerOverlay(delay, doClick);
    else setTimeout(doClick, delay * 1000);
  } else {
    doClick();
  }
}

// ─── Open-Ended (Type Answer) Support ────────────────────────────────

async function dispatchOpenEndedAnswer(answer, options = {}) {
  const myNonce = submitNonce;
  const { autoClick = true, answerDelay = 0 } = options;

  // Poll aggressively for text input — don't wait for loading bar
  // (same pattern as pin/slider: input may appear before loading animation ends)
  const deadline = (loadingEndsAt > 0 ? loadingEndsAt : Date.now()) + 5000;
  let inputReady = false;

  for (let attempt = 0; attempt < 80; attempt++) {
    const input = document.querySelector('input[data-functional-selector="text-answer-input"]');
    if (input && !input.disabled) {
      const noOverlay = !document.querySelector('[data-functional-selector="loading-bar-progress"]');
      if (noOverlay) {
        console.log(`[kaBot] Open-ended: input found, overlay clear (attempt ${attempt})`);
        inputReady = true;
        break;
      }
    }
    if (Date.now() > deadline) break;
    if (submitNonce !== myNonce) return;
    await new Promise(r => setTimeout(r, 100));
  }

  if (!inputReady) {
    // Fallback: try anyway if input exists
    const input = document.querySelector('input[data-functional-selector="text-answer-input"]');
    if (!input) { updateStatus('✏️ Input not found'); return; }
    console.warn('[kaBot] Open-ended: proceeding despite overlay check');
  }

  if (submitNonce !== myNonce) return;

  // Apply answer delay (stored in seconds)
  if (answerDelay > 0) {
    console.log(`[kaBot] Open-ended: waiting ${answerDelay}s delay`);
    await new Promise(r => setTimeout(r, answerDelay * 1000));
    if (submitNonce !== myNonce) return;
  }

  // Dispatch to injected.js which handles React value setting + WS submission
  window.dispatchEvent(new CustomEvent('autoTypeAnswer', {
    detail: { answer, autoClick }
  }));
  console.log(`[kaBot] Open-ended: dispatched "${answer}" to injected.js`);
  updateStatus('Answered ✅ (open-ended)', `✏️ ${answer}`);
}

// ─── Slider Support ─────────────────────────────────────────────────

async function solveSliderFromDOM(value, options) {
  const myNonce = submitNonce;

  // Send WS immediately — don't wait for UI to be interactive
  // Snap the value using config we already have from DOM polling
  const earlyInput = document.querySelector('input[data-functional-selector="slider-scale"]');
  if (earlyInput && options.autoClick !== false) {
    const rawMin = parseFloat(earlyInput.min), rawMax = parseFloat(earlyInput.max), rawStep = parseFloat(earlyInput.step);
    const min = isNaN(rawMin) ? 0 : rawMin, max = isNaN(rawMax) ? 100 : rawMax, step = isNaN(rawStep) ? 1 : rawStep;
    const snapped = Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step));
    window.dispatchEvent(new CustomEvent('sliderWSSend', { detail: { value: snapped } }));
    console.log(`[kaBot] Slider: early WS sent with snapped value ${snapped}`);
  }

  // Now poll for UI to become interactive (for visual feedback + submit click)
  const deadline = (loadingEndsAt > 0 ? loadingEndsAt : Date.now()) + 5000;
  let rangeInput = null;

  for (let attempt = 0; attempt < 80; attempt++) {
    rangeInput = document.querySelector('input[data-functional-selector="slider-scale"]');
    if (rangeInput) {
      const noLoadingOverlay = !document.querySelector('[data-functional-selector="loading-bar-progress"]');
      if (noLoadingOverlay) {
        await new Promise(r => setTimeout(r, 100));
        console.log(`[kaBot] Slider: range input found, overlay clear (attempt ${attempt})`);
        break;
      }
    }
    rangeInput = null;
    if (Date.now() > deadline) break;
    if (submitNonce !== myNonce) return;
    await new Promise(r => setTimeout(r, 100));
  }

  if (!rangeInput) {
    // Fallback: try anyway
    rangeInput = document.querySelector('input[data-functional-selector="slider-scale"]');
    if (!rangeInput) { updateStatus('🎚️ Slider not found'); return; }
    console.warn('[kaBot] Slider: proceeding despite overlay check');
  }

  // Extract config from DOM for logging / highlight
  const rawMin = parseFloat(rangeInput.min);
  const rawMax = parseFloat(rangeInput.max);
  const rawStep = parseFloat(rangeInput.step);
  const min = isNaN(rawMin) ? 0 : rawMin;
  const max = isNaN(rawMax) ? 100 : rawMax;
  const step = isNaN(rawStep) ? 1 : rawStep;
  const unit = rangeInput.getAttribute('aria-label') || '';
  console.log(`[kaBot] Slider: value=${value}, range=${min}-${max}, step=${step}, unit="${unit}"`);

  // Highlight the closest marker if highlight is on
  if (options.highlight !== false && !options.silentMode) {
    highlightSliderMarker(value);
  }

  if (options.autoClick === false) {
    updateStatus('Slider answer shown', `🎚️ ${value} ${unit}`);
    return;
  }

  const doSlider = () => {
    // WS already sent early — this just sets visual value + clicks submit
    window.dispatchEvent(new CustomEvent('autoSliderAnswer', {
      detail: { value, autoClick: true, skipWS: true }
    }));
    updateStatus('Answered ✅ (slider)', `🎚️ ${value} ${unit}`);
  };

  const delay = options.answerDelay ?? 0;
  if (delay > 0) {
    if (!options.silentMode) showTimerOverlay(delay, doSlider);
    else setTimeout(doSlider, delay * 1000);
  } else {
    doSlider();
  }
}

function highlightSliderMarker(targetValue) {
  // Find the marker closest to the target value
  const markers = document.querySelectorAll('.spectrum__MarkerContainer-sc-1q4py3v-1, [data-functional-selector*="marker-container"]');
  let bestMarker = null, bestDiff = Infinity;

  for (const m of markers) {
    const label = m.querySelector('[class*="NumberIndicator"]');
    if (!label) continue;
    const numText = label.textContent.replace(/\s/g, '').replace(/\u00a0/g, '');
    const num = parseFloat(numText);
    if (isNaN(num)) continue;
    const diff = Math.abs(num - targetValue);
    if (diff < bestDiff) { bestDiff = diff; bestMarker = m; }
  }

  if (bestMarker) {
    const dot = bestMarker.querySelector('[class*="Marker-sc"], [data-functional-selector*="marker"]');
    if (dot) {
      dot.style.border = '3px solid #00ff00';
      dot.style.boxShadow = '0 0 12px #00ff00';
      dot.style.borderRadius = '50%';
      dot.style.transition = 'all 0.3s ease';
    }
  }
}

// ─── Jumble Helpers ─────────────────────────────────────────────────

function computeTileOrder(answer, tiles) {
  const answerLower = answer.toLowerCase().replace(/[\s\-]/g, '');
  const tilesLower = tiles.map(t => t.toLowerCase().replace(/[\s\-]/g, ''));
  const used = new Set(), order = [];
  let pos = 0;

  while (pos < answerLower.length && order.length < tiles.length) {
    let found = false;
    const candidates = tilesLower.map((t, i) => ({ text: t, idx: i, len: t.length }))
      .filter(c => !used.has(c.idx)).sort((a, b) => b.len - a.len);
    for (const c of candidates) {
      if (answerLower.startsWith(c.text, pos)) {
        order.push(c.idx); used.add(c.idx); pos += c.text.length; found = true; break;
      }
    }
    if (!found) break;
  }
  if (order.length === tiles.length && pos === answerLower.length) return order;

  if (tiles.length > 8) return null;
  function permute(remaining, current) {
    if (remaining.length === 0) return current.map(i => tilesLower[i]).join('') === answerLower ? current : null;
    for (let j = 0; j < remaining.length; j++) {
      const next = [...current, remaining[j]];
      if (!answerLower.startsWith(next.map(i => tilesLower[i]).join(''))) continue;
      const result = permute([...remaining.slice(0, j), ...remaining.slice(j + 1)], next);
      if (result) return result;
    }
    return null;
  }
  return permute(tilesLower.map((_, i) => i), []);
}

function clickJumbleTilesSequence(textEls, order, onComplete, idx = 0) {
  if (idx >= order.length) {
    console.log('[kaBot] All jumble tiles clicked');
    if (onComplete) onComplete();
    return;
  }

  const originalLabels = textEls.map(el => el.textContent?.trim() || '');
  const targetLabel = originalLabels[order[idx]];

  let currentTextEl = null;
  for (let i = 0; ; i++) {
    const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
    if (!el) break;
    if (el.textContent?.trim() === targetLabel) { currentTextEl = el; break; }
  }

  if (!currentTextEl) {
    currentTextEl = textEls[order[idx]];
    if (!currentTextEl?.isConnected) {
      console.warn(`[kaBot] Tile "${targetLabel}" gone, skipping`);
      clickJumbleTilesSequence(textEls, order, onComplete, idx + 1);
      return;
    }
  }

  const rect = currentTextEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;

  const interactive = currentTextEl.closest('[draggable="true"]')
    || currentTextEl.closest('button')
    || currentTextEl.closest('[role="button"]')
    || currentTextEl.closest('[data-functional-selector*="card"]');
  const targets = [...new Set([interactive, currentTextEl].filter(Boolean))];

  const evtBase = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };

  for (const t of targets) {
    t.dispatchEvent(new PointerEvent('pointerdown', { ...evtBase, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    t.dispatchEvent(new MouseEvent('mousedown', evtBase));
  }

  setTimeout(() => {
    for (const t of targets) {
      t.dispatchEvent(new PointerEvent('pointerup', { ...evtBase, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      t.dispatchEvent(new MouseEvent('mouseup', evtBase));
      t.dispatchEvent(new MouseEvent('click', evtBase));
      t.click();
    }
    setTimeout(() => clickJumbleTilesSequence(textEls, order, onComplete, idx + 1), 500);
  }, 80);
}

function showJumbleBadges(textEls, order) {
  document.querySelectorAll('.kabot-jumble-badge').forEach(el => el.remove());

  for (let pos = 0; pos < order.length; pos++) {
    const textEl = textEls[order[pos]];
    if (!textEl) continue;

    const container = textEl.closest('[draggable="true"]')
      || textEl.closest('[data-functional-selector*="card"]')
      || textEl.closest('[data-functional-selector*="choice"]')
      || textEl.parentElement?.parentElement
      || textEl.parentElement;
    if (!container) continue;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const badge = document.createElement('div');
    badge.className = 'kabot-jumble-badge';
    badge.textContent = String(pos + 1);
    badge.style.cssText = `
      position:absolute; top:-8px; right:-8px;
      width:24px; height:24px; background:#ff3333; color:#fff; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font:bold 14px sans-serif; z-index:10000;
      box-shadow:0 2px 8px rgba(0,0,0,0.5); pointer-events:none;
      animation:kabot-fadein .3s ease ${pos * 0.1}s both;
    `;
    container.appendChild(badge);
  }

  const cleanup = () => { document.querySelectorAll('.kabot-jumble-badge').forEach(el => el.remove()); observer.disconnect(); };
  setTimeout(cleanup, 15000);
  const observer = new MutationObserver(() => {
    if (!document.querySelector('[data-functional-selector="question-choice-text-0"]')) { cleanup(); }
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

// ─── Global Styles ──────────────────────────────────────────────────
function injectGlobalStyles() {
  if (document.getElementById('kabot-global-css')) return;
  const s = document.createElement('style');
  s.id = 'kabot-global-css';
  s.textContent = '@keyframes kabot-fadein { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }';
  if (document.head) document.head.appendChild(s);
  else document.addEventListener('DOMContentLoaded', () => document.head?.appendChild(s));
}
injectGlobalStyles();
