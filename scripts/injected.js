// kaBot — WebSocket interception layer (page context)

(function () {
  'use strict';

  const TAG = '[kaBot]';
  const OldWebSocket = window.WebSocket;

  window.__kahootWS = null;
  window.kahootClientId = null;
  window.kahootGameId = null;
  window.kahootQuestionIndex = 0;
  window.kahootMessageId = 0;
  window.kahootDataId = 45;
  window.kahootWSTiles = [];

  const ANSWERABLE_TYPES = new Set(['quiz', 'true_false', 'multiple_select_quiz', 'pin_it', 'jumble', 'slider', 'open_ended']);
  const PIN_TYPES = new Set(['pin_it']);
  const JUMBLE_TYPES = new Set(['jumble']);
  const SLIDER_TYPES = new Set(['slider']);
  const OPEN_ENDED_TYPES = new Set(['open_ended']);

  // ─── WebSocket Hook ──────────────────────────────────────────────

  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OldWebSocket(url, protocols) : new OldWebSocket(url);
    window.__kahootWS = ws;

    ws.addEventListener('message', function (event) {
      try {
        if (typeof event.data !== 'string') return;
        const data = JSON.parse(event.data);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item.clientId && !window.kahootClientId) window.kahootClientId = item.clientId;
          if (item.data?.gameid && window.kahootGameId !== item.data.gameid) {
            window.kahootGameId = item.data.gameid;
            window.kahootQuestionIndex = 0;
            console.log(TAG, 'Game joined:', window.kahootGameId);
          }
          if (item.id) {
            const msgId = parseInt(item.id, 10);
            if (!isNaN(msgId) && msgId > window.kahootMessageId) window.kahootMessageId = msgId;
          }
          if (item.data?.content) parseQuestionContent(item.data.content);
        }
      } catch (_) {}
    });

    ws.addEventListener('open', () => console.log(TAG, 'WS connected'));

    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      try {
        const parsed = JSON.parse(data);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item.data?.content) {
            const content = typeof item.data.content === 'string' ? JSON.parse(item.data.content) : item.data.content;
            if (content.type) console.log(TAG, 'WS OUT:', content.type, JSON.stringify(content).slice(0, 200));
          }
        }
      } catch (_) {}
      return origSend(data);
    };

    ws.addEventListener('close', () => {
      console.log(TAG, 'WS closed');
      window.__kahootWS = null;
      window.kahootClientId = null;
      window.kahootGameId = null;
      window.kahootQuestionIndex = 0;
      window.kahootMessageId = 0;
      window.dispatchEvent(new CustomEvent('kahootGameReset'));
    });

    return ws;
  };

  window.WebSocket.prototype = OldWebSocket.prototype;
  Object.defineProperties(window.WebSocket, {
    CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 }
  });

  // ─── Helpers ─────────────────────────────────────────────────────

  const _decodeEl = document.createElement('textarea');
  function decodeEntities(str) {
    if (typeof str !== 'string') return String(str ?? '');
    _decodeEl.innerHTML = str;
    return _decodeEl.value.replace(/<[^>]*>/g, '');
  }

  const NON_SCORED_TYPES = new Set(['survey', 'word_cloud', 'poll']);

  // ─── Question Parsing ────────────────────────────────────────────

  function parseQuestionContent(raw) {
    try {
      const content = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!content.title && !content.question) return;

      // Signal non-scored types so the UI can clean up
      if (NON_SCORED_TYPES.has(content.type)) {
        window.dispatchEvent(new CustomEvent('kahootNonScoredQuestion', { detail: { type: content.type } }));
        return;
      }

      if (!ANSWERABLE_TYPES.has(content.type)) return;

      const isPin = PIN_TYPES.has(content.type);
      const isJumble = JUMBLE_TYPES.has(content.type);
      const isSlider = SLIDER_TYPES.has(content.type);
      const isOpenEnded = OPEN_ENDED_TYPES.has(content.type);

      let choices = [];
      let sliderConfig = null;

      if (isSlider) {
        // Extract slider range from WS content
        // Kahoot sends range info in various possible fields
        const range = content.range || content.slider || {};
        sliderConfig = {
          min: range.min ?? content.min ?? null,
          max: range.max ?? content.max ?? null,
          step: range.step ?? content.step ?? null,
          unit: range.unit ?? content.unit ?? ''
        };
        console.log(TAG, 'Slider config from WS:', JSON.stringify(sliderConfig));

      } else if (isJumble) {
        const rawChoices = content.choices || [];
        choices = rawChoices.map(c => {
          if (typeof c === 'string') return decodeEntities(c);
          return decodeEntities(c.answer || c.text || c.label || String(c));
        });
        // DOM fallback for tiles
        if (choices.length === 0 || choices.every(c => !c)) {
          let i = 0;
          while (true) {
            const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
            if (!el) break;
            choices.push(el.textContent?.trim() || '');
            i++;
          }
        }
        console.log(TAG, 'Jumble tiles:', choices);
        window.kahootWSTiles = [...choices];
        if (choices.length === 0) return;

      } else if (!isPin && !isSlider && !isOpenEnded) {
        const rawChoices = content.choices || [];
        choices = rawChoices.map(c => {
          if (typeof c === 'string') return decodeEntities(c);
          let text = c.answer || c.text || c.label || '';
          if (typeof text === 'string' && text.trim()) return decodeEntities(text);
          const alt = c.imageMetadata?.altText || c.alt || c.description || '';
          if (alt) return decodeEntities(alt);
          return '';
        });

        // For image-based choices, use "Image N" placeholders.
        // Content.js will poll the DOM for real aria-labels before sending to AI.
        const hasImages = choices.some(c => c === '') &&
          rawChoices.some(c => typeof c === 'object' && (c.image || c.imageUrl || c.media?.image || c.media?.url));
        if (hasImages) {
          choices = choices.map((c, i) => c || `Image ${i + 1}`);
        }
        if (choices.length === 0) return;
      }

      let imageUrl = content.image || content.media?.image || content.media?.url || null;

      const question = {
        title: decodeEntities(content.title || content.question),
        choices: (isPin || isSlider || isOpenEnded) ? [] : choices,
        type: content.type,
        questionIndex: content.questionIndex ?? window.kahootQuestionIndex,
        imageUrl,
        ...(isSlider && sliderConfig ? { sliderConfig } : {})
      };

      window.kahootQuestionIndex = question.questionIndex;
      window.dispatchEvent(new CustomEvent('kahootQuestionParsed', { detail: question }));
    } catch (_) {}
  }

  // ─── WS Payload Builder ──────────────────────────────────────────

  function makePayload(contentObj) {
    const { kahootGameId: gameid, kahootClientId: clientId } = window;
    window.kahootMessageId++;
    return [{
      id: String(window.kahootMessageId),
      channel: '/service/controller',
      data: {
        gameid, type: 'message', host: 'kahoot.it',
        id: window.kahootDataId,
        content: JSON.stringify(contentObj)
      },
      clientId, ext: {}
    }];
  }

  function wsSend(payload) {
    const ws = window.__kahootWS;
    if (!ws || ws.readyState !== OldWebSocket.OPEN || !window.kahootGameId || !window.kahootClientId) {
      console.warn(TAG, 'Cannot send — WS not ready');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }

  // ─── Answer Event Listeners ──────────────────────────────────────

  window.sendAutoClickMessage = function (choice) {
    wsSend(makePayload({ type: 'quiz', choice, questionIndex: window.kahootQuestionIndex }));
  };

  window.sendMultiSelectMessage = function (choices) {
    wsSend(makePayload({ type: 'multiple_select_quiz', choice: choices, questionIndex: window.kahootQuestionIndex }));
  };

  // Pin answer
  window.addEventListener('autoPinAnswer', function (event) {
    const { x, y } = event.detail;
    console.log(TAG, 'Pin:', x + '%,', y + '%');

    const svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
    if (!svgEl) { console.warn(TAG, 'Pin SVG not found'); return; }

    // Convert % to SVG image coords, then to screen coords via getScreenCTM
    const imgEl = svgEl.querySelector('image');
    const imgW = parseFloat(imgEl?.getAttribute('width') || '2363');
    const imgH = parseFloat(imgEl?.getAttribute('height') || '1268');
    const svgX = (x / 100) * imgW;
    const svgY = (y / 100) * imgH;

    let clientX, clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = svgX; pt.y = svgY;
      const sp = pt.matrixTransform(ctm);
      clientX = sp.x; clientY = sp.y;
    } else {
      const rect = svgEl.getBoundingClientRect();
      clientX = rect.left + (x / 100) * rect.width;
      clientY = rect.top + (y / 100) * rect.height;
    }

    // Try React setPinValue via memoizedProps and stateNode
    const fiberKey = Object.keys(svgEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let pinSet = false;

    if (fiberKey) {
      let fiber = svgEl[fiberKey];
      let depth = 0;
      while (fiber && depth < 40) {
        if (fiber.memoizedProps?.setPinValue) {
          fiber.memoizedProps.setPinValue({ x: x / 100, y: y / 100 });
          pinSet = true;
          console.log(TAG, 'setPinValue called at depth', depth);
          break;
        }
        if (fiber.stateNode?.setPinValue) {
          fiber.stateNode.setPinValue({ x: x / 100, y: y / 100 });
          pinSet = true;
          break;
        }
        fiber = fiber.return;
        depth++;
      }

    // Also try dispatching to state hooks with pin-like objects
      if (!pinSet) {
        fiber = svgEl[fiberKey];
        depth = 0;
        while (fiber && depth < 40) {
          let hook = fiber.memoizedState;
          while (hook) {
            const val = hook.memoizedState;
            if (val && typeof val === 'object' && ('x' in val || 'pinX' in val) && hook.queue?.dispatch) {
              if ('pinX' in val) hook.queue.dispatch({ pinX: x / 100, pinY: y / 100 });
              else hook.queue.dispatch({ x: x / 100, y: y / 100 });
              pinSet = true;
              break;
            }
            hook = hook.next;
          }
          if (pinSet) break;
          fiber = fiber.return; depth++;
        }
      }
    }

    // React onMouseDown/onMouseUp via props
    const propsKey = Object.keys(svgEl).find(k => k.startsWith('__reactProps$'));
    if (propsKey) {
      const props = svgEl[propsKey];
      const fakeEvt = {
        clientX, clientY, pageX: clientX + window.scrollX, pageY: clientY + window.scrollY,
        button: 0, buttons: 1, preventDefault() {}, stopPropagation() {}, persist() {},
        target: svgEl, currentTarget: svgEl,
        nativeEvent: new MouseEvent('mousedown', { clientX, clientY, bubbles: true }),
        type: 'mousedown'
      };
      if (props.onMouseDown) props.onMouseDown(fakeEvt);
      if (props.onMouseUp) { fakeEvt.type = 'mouseup'; props.onMouseUp(fakeEvt); }
    }

    // Native events
    const evtInit = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
    svgEl.dispatchEvent(new MouseEvent('mousedown', evtInit));
    svgEl.dispatchEvent(new MouseEvent('mouseup', evtInit));
    svgEl.dispatchEvent(new MouseEvent('click', evtInit));

    // WS
    wsSend(makePayload({
      type: 'pin_it', pinX: x / 100, pinY: y / 100,
      questionIndex: window.kahootQuestionIndex
    }));

    console.log(TAG, 'Pin complete, setPinValue=' + pinSet);

    // Click submit button after a short delay to let React update
    setTimeout(() => {  // 300ms is enough — setPinValue is synchronous
      const btn = document.querySelector('button[data-functional-selector="pin-answer-submit"]')
                || document.querySelector('button[data-functional-selector*="submit"]');
      if (btn) {
        btn.click();
        console.log(TAG, 'Pin submit clicked');
      } else {
        console.log(TAG, 'Pin submit button not found');
      }
    }, 300);
  });

  // Auto-click single
  window.addEventListener('autoClickAnswer', e => window.sendAutoClickMessage(e.detail));

  // Auto-click multi-select
  window.addEventListener('autoClickMultiSelect', e => window.sendMultiSelectMessage(e.detail));

  // ─── Jumble Reorder ──────────────────────────────────────────────

  window.addEventListener('autoJumbleAnswer', async function (event) {
    const { answerWord, autoClick } = event.detail;
    console.log(TAG, 'Jumble answer:', answerWord, 'autoClick:', autoClick);

    if (!autoClick) {
      console.log(TAG, 'AutoClick off — skipping WS and React for jumble');
      return;
    }

    const wsTiles = window.kahootWSTiles || [];
    console.log(TAG, 'WS tiles:', wsTiles);
    if (wsTiles.length === 0 || !answerWord) return;

    // WS submission
    const wsOrder = computeTileOrder(answerWord, wsTiles);
    if (wsOrder) {
      console.log(TAG, 'WS order:', wsOrder, '→', wsOrder.map(i => wsTiles[i]).join(''));
      wsSend(makePayload({ type: 'jumble', choice: wsOrder, answer: wsOrder, sequence: wsOrder, questionIndex: window.kahootQuestionIndex }));
      // WS submission is the real answer — signal content.js to skip DOM fallback
      window.dispatchEvent(new CustomEvent('kabotJumbleHandled'));
    }

    // React state manipulation (visual reorder + submit)
    let arrangerEl = document.querySelector('[class*="arranger__Container"]');
    if (!arrangerEl) {
      // Poll briefly for arranger to render
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 200));
        arrangerEl = document.querySelector('[class*="arranger__Container"]');
        if (arrangerEl) break;
      }
    }
    if (!arrangerEl) {
      console.log(TAG, 'No arranger container found — relying on WS submission only');
      return;
    }

    const domLabels = [];
    let i = 0;
    while (true) {
      const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
      if (!el) break;
      domLabels.push(el.textContent?.trim() || '');
      i++;
    }

    const domOrder = computeTileOrder(answerWord, domLabels);
    if (!domOrder) { console.warn(TAG, 'Could not compute DOM order'); return; }
    console.log(TAG, 'DOM labels:', domLabels, 'DOM order:', domOrder);

    let reactReordered = false;
    const fk = Object.keys(arrangerEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fk) {
      let f = arrangerEl[fk], depth = 0;
      while (f && depth < 30) {
        if (f.memoizedProps?.setOrder) {
          try { f.memoizedProps.setOrder(domOrder); reactReordered = true; } catch (_) {}
        }
        let hook = f.memoizedState, hi = 0;
        while (hook) {
          const val = hook.memoizedState;
          if (Array.isArray(val) && val.length === domLabels.length && val.every(v => typeof v === 'number')) {
            if (hook.queue?.dispatch) {
              hook.queue.dispatch(domOrder);
              reactReordered = true;
            }
          }
          hook = hook.next; hi++;
        }
        if (reactReordered) break;
        f = f.return; depth++;
      }
    }

    if (reactReordered) {
      console.log(TAG, 'React state reordered');
      let attempts = 0;
      function trySubmit() {
        attempts++;
        const btn = findSubmitButton();
        if (btn) {
          btn.click();
          const pk = Object.keys(btn).find(k => k.startsWith('__reactProps$'));
          if (pk && btn[pk]?.onClick) {
            try { btn[pk].onClick({ preventDefault() {}, stopPropagation() {}, persist() {}, target: btn, currentTarget: btn, type: 'click', nativeEvent: new MouseEvent('click') }); } catch (_) {}
          }
        } else if (attempts < 15) {
          setTimeout(trySubmit, 500);
        }
      }
      setTimeout(trySubmit, 600);
      window.dispatchEvent(new CustomEvent('kabotJumbleHandled'));
    }
  });

  // ─── Slider Answer ────────────────────────────────────────────────

  // Early WS-only send (fires before UI is interactive for speed)
  window.addEventListener('sliderWSSend', function (event) {
    const { value } = event.detail;
    console.log(TAG, 'Slider early WS:', value);
    wsSend(makePayload({
      type: 'slider',
      choice: value,
      questionIndex: window.kahootQuestionIndex
    }));
  });

  window.addEventListener('autoSliderAnswer', function (event) {
    const { value, autoClick, skipWS } = event.detail;
    console.log(TAG, 'Slider answer:', value, 'autoClick:', autoClick, 'skipWS:', !!skipWS);

    // Find the range input
    const rangeInput = document.querySelector('input[data-functional-selector="slider-scale"]');
    if (!rangeInput) {
      console.warn(TAG, 'Slider range input not found');
      return;
    }

    // Snap value to slider's step/min/max (offset from min, not from 0)
    const rawMin = parseFloat(rangeInput.min);
    const rawMax = parseFloat(rangeInput.max);
    const rawStep = parseFloat(rangeInput.step);
    const min = isNaN(rawMin) ? 0 : rawMin;
    const max = isNaN(rawMax) ? 100 : rawMax;
    const step = isNaN(rawStep) ? 1 : rawStep;
    const snapped = min + Math.round((value - min) / step) * step;
    const clamped = Math.max(min, Math.min(max, snapped));
    console.log(TAG, `Slider: target=${value}, snapped=${clamped} (min=${min}, max=${max}, step=${step})`);

    // Set value using React-compatible setter
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(rangeInput, clamped);
    } else {
      rangeInput.value = clamped;
    }

    // Trigger React's synthetic events
    rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
    rangeInput.dispatchEvent(new Event('change', { bubbles: true }));

    if (!autoClick) {
      console.log(TAG, 'AutoClick off — slider value set but not submitting');
      return;
    }

    // WS submission (skip if already sent early by content.js)
    if (!skipWS) {
      wsSend(makePayload({
        type: 'slider',
        choice: clamped,
        questionIndex: window.kahootQuestionIndex
      }));
      console.log(TAG, 'WS OUT: slider', JSON.stringify({ type: 'slider', choice: clamped }));
    }

    // Click submit after short delay for React to update
    setTimeout(() => {
      const btn = document.querySelector('button[data-functional-selector="slider-submit"]')
                || findSubmitButton();
      if (btn) {
        btn.click();
        console.log(TAG, 'Slider submit clicked');
      } else {
        console.log(TAG, 'Slider submit button not found');
      }
    }, 300);
  });

  // ─── Shared Helpers ──────────────────────────────────────────────

  function findSubmitButton() {
    for (const sel of [
      '[data-functional-selector="submit-button"]',
      '[data-functional-selector="multi-select-submit-button"]',
      '[data-functional-selector="multi-select-submit"]',
      '[data-functional-selector="jumble-submit-button"]',
      '[data-functional-selector="slider-submit"]',
      '[data-functional-selector="text-answer-submit"]',
      '[data-functional-selector="pin-answer-submit"]',
      '[data-functional-selector="confirm"]',
      '[data-functional-selector*="submit"]',
      'button[type="submit"]'
    ]) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && btn.offsetParent !== null) return btn;
    }
    for (const btn of document.querySelectorAll('button')) {
      const text = btn.textContent.trim().toLowerCase();
      if (['submit', 'confirm', 'done', 'check'].includes(text) && !btn.disabled && btn.offsetParent !== null) return btn;
    }
    return null;
  }

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

  // ─── Open-ended Text Answer ─────────────────────────────────────────

  window.addEventListener('autoTypeAnswer', async function (event) {
    const { answer, autoClick } = event.detail;
    console.log(TAG, 'Open-ended answer:', answer, 'autoClick:', autoClick);

    const input = document.querySelector('input[data-functional-selector="text-answer-input"]');
    if (!input) {
      console.warn(TAG, 'Open-ended input not found');
      return;
    }

    // Respect the maxLength attribute if present
    // Note: input.maxLength returns -1 when no maxlength is set, which would break .slice()
    const rawMaxLen = parseInt(input.getAttribute('maxlength'), 10);
    const maxLen = (rawMaxLen > 0) ? rawMaxLen : 20;
    const trimmed = answer.slice(0, maxLen);

    // Type character-by-character with simulated keystrokes for React controlled inputs.
    // Async delay between chars prevents React batching from dropping inputs.
    input.focus();

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      const currentVal = trimmed.slice(0, i + 1);

      // Set the native value to include this character
      if (nativeSetter) {
        nativeSetter.call(input, currentVal);
      } else {
        input.value = currentVal;
      }

      // Dispatch keyboard events like a real keystroke
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

      // Small yield between chars so React can process each update
      if (i < trimmed.length - 1) await new Promise(r => setTimeout(r, 12));
    }

    console.log(TAG, 'Open-ended typed:', input.value, '(expected:', trimmed + ')');

    if (!autoClick) {
      console.log(TAG, 'AutoClick off — answer typed but not submitting');
      return;
    }

    // Poll for submit button to become enabled (React needs to process keystrokes)
    for (let i = 0; i < 20; i++) {
      const btn = document.querySelector('button[data-functional-selector="text-answer-submit"]')
                || findSubmitButton();
      if (btn && !btn.disabled) {
        btn.click();
        console.log(TAG, 'Open-ended submit clicked');
        return;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    console.log(TAG, 'Open-ended submit button not found/enabled after polling');
  });

  console.log(TAG, 'Injected — listening');
})();
