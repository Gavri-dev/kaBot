// kAIhoot — OpenAI integration

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const API_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

export async function getOpenAISettings() {
  const { openaiApiKey, openaiModel } = await chrome.storage.sync.get(['openaiApiKey', 'openaiModel']);
  return {
    apiKey: (openaiApiKey || '').trim(),
    model: (openaiModel || 'gpt-5-mini').trim() || 'gpt-5-mini'
  };
}

// ─── Single-answer questions ────────────────────────────────────────

export async function answerQuestion(title, choices) {
  const { apiKey, model } = await getOpenAISettings();
  if (!apiKey) throw new Error('No OpenAI API key configured.');
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');

  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nReply with ONLY the number (1-${choices.length}) of the correct answer.`;

  const data = await callOpenAI(apiKey, model, prompt, {
    systemPrompt: 'You are a quiz-answering engine. Respond with ONLY a single number indicating the correct option. No words, no punctuation — just the digit.',
    maxTokens: 8,
    stop: ['\n', '.']
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  const match = raw.match(/\d+/);
  const idx = match ? parseInt(match[0], 10) : NaN;

  if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
    console.log(`[OpenAI] Parsed choice #${idx} → "${choices[idx - 1]}"`);
    return choices[idx - 1];
  }

  console.warn(`[OpenAI] Number parse failed, raw: "${raw}" — text fallback`);
  return await answerTextFallback(title, choices, apiKey, model);
}

// ─── Multi-select questions ─────────────────────────────────────────

export async function answerMultiSelect(title, choices) {
  const { apiKey, model } = await getOpenAISettings();
  if (!apiKey) throw new Error('No OpenAI API key configured.');
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');

  // Per-option YES/NO forces independent evaluation of each option
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nThis is a multi-select quiz — there are MULTIPLE correct answers (usually 2-4).\nFor EACH option, decide if it correctly answers the question.\nOnly reject an option if it is clearly wrong or refers to something that does not exist (e.g. a made-up name, fake organization, or fabricated fact).\nIf an option refers to something real and relevant to the question, mark it YES.\nRespond with one line per option: NUMBER:YES or NUMBER:NO`;

  const data = await callOpenAI(apiKey, model, prompt, {
    systemPrompt: 'You are a quiz-answering engine with strong general knowledge. For multi-select questions, evaluate EACH option independently. There are MULTIPLE correct answers — typically 2-4 out of the options given. Only mark NO for options that are clearly false, fabricated, or refer to things that do not exist. If an option refers to a real law, treaty, concept, event, or fact that is relevant to the question, mark it YES. Format: NUMBER:YES or NUMBER:NO, one per line.',
    maxTokens: 120,
    reasoningEffort: 'low'
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  console.log(`[OpenAI] Multi-select raw: "${raw}"`);

  // Parse "1:YES" / "2:NO" lines
  const yesNums = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/(\d+)\s*:\s*(YES|Y)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= choices.length) yesNums.push(n);
    }
  }

  if (yesNums.length > 0) {
    const unique = [...new Set(yesNums)];
    const result = unique.map(n => choices[n - 1]);
    console.log(`[OpenAI] Multi-select YES: [${unique.join(',')}] → ${JSON.stringify(result)}`);
    return result;
  }

  // Fallback: try parsing comma-separated numbers (in case model ignored format)
  const nums = [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
  const validNums = nums.filter(n => n >= 1 && n <= choices.length);
  if (validNums.length > 0) {
    const unique = [...new Set(validNums)];
    const result = unique.map(n => choices[n - 1]);
    console.log(`[OpenAI] Multi-select fallback parsed: [${unique.join(',')}] → ${JSON.stringify(result)}`);
    return result;
  }

  console.warn(`[OpenAI] Multi-select parse failed, raw: "${raw}" — single fallback`);
  const single = await answerTextFallback(title, choices, apiKey, model);
  return [single];
}

// ─── Pin-it questions ───────────────────────────────────────────────

export async function answerPinQuestion(title, imageUrl) {
  const { apiKey } = await getOpenAISettings();
  if (!apiKey) throw new Error('No OpenAI API key configured.');
  if (!imageUrl) throw new Error('No image URL for pin question.');

  const visionModel = 'gpt-4.1';

  const prompt = `You must place a pin on an image to answer this quiz question:
"${title}"

COORDINATE SYSTEM:
- X=0 is the LEFT edge, X=100 is the RIGHT edge
- Y=0 is the TOP edge, Y=100 is the BOTTOM edge
- The center of the image is X=50, Y=50

STEP-BY-STEP PROCESS:
1. First, describe what you see in the image (map? photo? diagram? chart?).
2. Identify what the question is asking you to locate.
3. Find that target in the image by examining the actual pixels carefully.
4. Pick a visible landmark near your target and estimate its coordinates first.
5. Then estimate your target's coordinates relative to that landmark.
6. Double-check: does the X value place the target at the right horizontal position?

IF THE IMAGE IS A WORLD MAP, use these reference points (measured from actual Kahoot maps):
- Alaska: X≈10, Y≈12  |  Central USA: X≈19, Y≈28  |  Florida: X≈23, Y≈32
- NYC: X≈25, Y≈27  |  Mexico: X≈17, Y≈35  |  Brazil: X≈32, Y≈58
- Greenland center: X≈35, Y≈10  |  Iceland: X≈39, Y≈13  |  UK/Ireland: X≈43, Y≈20
- Norway/Sweden: X≈48, Y≈14  |  Italy: X≈49, Y≈25  |  Egypt: X≈53, Y≈33
- South Africa: X≈52, Y≈72  |  Madagascar: X≈57, Y≈60  |  India: X≈70, Y≈38
- China: X≈77, Y≈28  |  Japan: X≈86, Y≈28  |  Australia: X≈84, Y≈65  |  NZ: X≈91, Y≈72

COMMON MAP ERROR: AI models consistently estimate X too low on world maps. Verify by checking: "Is my X value to the LEFT or RIGHT of UK (X≈43)?" Adjust if needed.

IF THE IMAGE IS NOT A MAP, ignore the reference points above and estimate purely from what you see.

Show your reasoning, then on the FINAL line output ONLY two numbers: X,Y
Example final line: 65.0,40.0`;

  console.log(`[OpenAI] Pin question — vision model: ${visionModel}`);

  const body = {
    model: visionModel,
    messages: [
      { role: 'system', content: 'You are a spatial reasoning expert. You will be shown an image and asked to place a pin at a specific location. You MUST describe what you see, reason step by step about where the target is, then estimate coordinates. Your final line must be ONLY X,Y (0-100 scale).' },
      { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }] }
    ],
    temperature: 0.2,
    max_tokens: 800
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // Vision needs more time
  let resp;
  try {
    resp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('OpenAI Vision request timed out (30s)');
    throw err;
  }
  clearTimeout(timeout);

  if (!resp.ok) {
    let errMsg;
    try { const e = await resp.json(); errMsg = e?.error?.message || `HTTP ${resp.status}`; }
    catch { errMsg = `HTTP ${resp.status}`; }
    throw new Error(`OpenAI Vision: ${errMsg}`);
  }

  const data = await resp.json();
  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  console.log(`[OpenAI] Vision response:\n${raw}`);

  const lines = raw.split('\n').reverse();
  let coordMatch = null;
  for (const line of lines) {
    coordMatch = line.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
    if (coordMatch) break;
  }
  if (!coordMatch) throw new Error(`Could not parse pin coordinates: ${raw}`);

  return {
    x: Math.max(0, Math.min(100, parseFloat(coordMatch[1]))),
    y: Math.max(0, Math.min(100, parseFloat(coordMatch[2])))
  };
}

// ─── Open-ended (type answer) questions ──────────────────────────────

export async function answerOpenEndedQuestion(title) {
  const { apiKey, model } = await getOpenAISettings();
  if (!apiKey) throw new Error('No OpenAI API key configured.');

  // Kahoot open-ended answers have a 20 character limit
  const prompt = `Quiz question: "${title}"\n\nThis is a fill-in-the-blank or short answer quiz question. Give the most likely intended answer.\nIf it's a fill-in-the-blank (contains ___ or a gap), give the word or short phrase that best completes the sentence.\nThink about what a teacher or quiz creator would expect as the correct answer.\nRespond with ONLY the answer — max 20 characters, no explanation.`;

  const data = await callOpenAI(apiKey, model, prompt, {
    systemPrompt: 'You answer quiz questions with short, precise answers. Your answer must be 20 characters or fewer. For fill-in-the-blank questions, give the single most expected word or phrase that completes the sentence. Think like a student answering a classroom quiz. Give only the answer — no explanation.',
    maxTokens: 24,
    reasoningEffort: 'medium'
  });

  let answer = (data?.choices?.[0]?.message?.content || '').trim();

  // Strip quotes if model wraps answer
  answer = answer.replace(/^["']|["']$/g, '');

  // Enforce 20 char limit
  if (answer.length > 20) {
    answer = answer.substring(0, 20);
  }

  if (!answer) throw new Error('Empty answer from AI');
  console.log(`[OpenAI] Open-ended answer: "${answer}" (${answer.length} chars)`);
  return answer;
}

// ─── Slider questions ────────────────────────────────────────────────

export async function answerSliderQuestion(title, sliderConfig) {
  const { apiKey, model } = await getOpenAISettings();
  if (!apiKey) throw new Error('No OpenAI API key configured.');

  const { min, max, step, unit } = sliderConfig;
  const hasRange = min != null && max != null;

  // Build range info and snap hints only when we have the full config
  let rangeInfo = '';
  let snapHint = '';
  if (hasRange) {
    rangeInfo = `\nRange: ${min} to ${max} (step: ${step || 'unknown'})${unit ? ` (unit: ${unit})` : ''}`;
    if (step) {
      const numSteps = Math.round((max - min) / step);
      if (numSteps <= 30) {
        const points = [];
        for (let i = 0; i <= numSteps; i++) points.push(min + i * step);
        snapHint = `\nValid values: ${points.join(', ')}`;
      } else {
        snapHint = `\nThe answer MUST be exactly: ${min} + (N × ${step}) for some integer N.`;
      }
    }
  } else {
    // WS didn't provide range — just include what we know
    if (unit) rangeInfo = `\nUnit: ${unit}`;
    if (step) rangeInfo += `${rangeInfo ? ', ' : '\n'}Step size: ${step}`;
  }

  const prompt = `Question: ${title}

This is a slider question on a quiz. You need to pick the correct numeric value.${rangeInfo}${snapHint}

IMPORTANT: Think carefully about the factual answer to this question first. This is a knowledge/trivia question — use your real-world knowledge to determine the correct answer${hasRange ? ', then pick the closest valid value in the range' : ''}.

Reply with ONLY a single number. No words, no units, no punctuation — just the number.`;

  const data = await callOpenAI(apiKey, model, prompt, {
    systemPrompt: 'You are a quiz-answering engine with strong general knowledge. For slider questions, think about the real-world factual answer first, then pick the closest valid value on the slider. Respond with ONLY a single number. No explanation, no units — just the number.',
    maxTokens: 32,
    reasoningEffort: 'low'
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  // Extract number, handling spaces/commas as thousand separators
  const cleaned = raw.replace(/[\s,]/g, '');
  const match = cleaned.match(/[\d.]+/);
  if (!match) throw new Error(`Could not parse slider answer: "${raw}"`);

  const value = parseFloat(match[0]);
  if (isNaN(value)) throw new Error(`Could not parse slider answer: "${raw}"`);
  console.log(`[OpenAI] Slider answer: ${value} (raw: "${raw}")`);
  return value;
}

// ─── Jumble ─────────────────────────────────────────────────────────

export async function answerJumbleQuestion(title, tiles) {
  const { apiKey, model } = await getOpenAISettings();
  if (!apiKey) throw new Error('No OpenAI API key configured.');
  if (!tiles || tiles.length === 0) throw new Error('No jumble tiles provided.');

  const tileList = tiles.map(t => `"${t}"`).join(', ');
  const prompt = `Question: ${title}\n\nThe answer is formed by arranging these tiles in the correct order: ${tileList}\n\nWhat word or phrase do these tiles spell when arranged correctly to answer the question?\nReply with ONLY the answer word/phrase. Nothing else.`;
  const useModel = model.includes('nano') ? 'gpt-5-mini' : model;

  const data = await callOpenAI(apiKey, useModel, prompt, {
    systemPrompt: 'You are a quiz expert. Given shuffled tiles that form a word/phrase, determine the correct answer. Reply with ONLY the answer word or phrase. No explanation, no quotes.',
    maxTokens: 50
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
  console.log(`[OpenAI] Jumble answer: "${raw}"`);
  return raw;
}

// ─── Text fallback ──────────────────────────────────────────────────

async function answerTextFallback(title, choices, apiKey, model) {
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nReply with the EXACT text of the correct option. Nothing else.`;

  const data = await callOpenAI(apiKey, model, prompt, {
    systemPrompt: 'You solve multiple-choice questions. Reply with ONLY the exact text of the correct option. No explanation, no numbering.',
    maxTokens: 80
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  const cleaned = raw.replace(/^["']|["']$/g, '').replace(/^\s*(?:[-*•]+|\(?[A-Da-d]\)|[A-Da-d][.:)]|\d{1,2}[.:)])\s*/g, '').trim();
  const lowered = cleaned.toLowerCase();

  const found =
    choices.find(c => c.toLowerCase().trim() === lowered) ||
    choices.find(c => c.toLowerCase().includes(lowered)) ||
    choices.find(c => lowered.includes(c.toLowerCase().trim()));
  if (found) return found;

  let bestChoice = choices[0], bestScore = 0;
  for (const choice of choices) {
    const score = fuzzyScore(lowered, choice.toLowerCase());
    if (score > bestScore) { bestScore = score; bestChoice = choice; }
  }
  return bestChoice;
}

function fuzzyScore(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb))).length;
  return overlap / Math.max(wordsA.length, wordsB.length);
}

// ─── Raw API call with timeout + retry ──────────────────────────────

async function callOpenAI(apiKey, model, userPrompt, opts = {}) {
  const { systemPrompt = 'You answer multiple-choice questions.', maxTokens = 40, stop = undefined, reasoningEffort = 'minimal' } = opts;
  const isGPT5 = /^gpt-5/i.test(model.trim());

  const body = {
    model,
    messages: [
      { role: isGPT5 ? 'developer' : 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
  };

  if (isGPT5) {
    // GPT-5 uses hidden reasoning tokens — pad max_completion_tokens accordingly
    const reasoningPads = { minimal: 200, low: 500, medium: 1200, high: 2500 };
    const reasoningPad = reasoningPads[reasoningEffort] ?? 500;
    body.max_completion_tokens = maxTokens + reasoningPad;
    body.reasoning_effort = reasoningEffort;
    // Note: GPT-5 does not support stop sequences
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0;
    if (stop) body.stop = stop;
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) console.log('[OpenAI] Retry attempt', attempt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const resp = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        console.log(`[OpenAI] Response: "${(data?.choices?.[0]?.message?.content || '').trim()}"`);
        return data;
      }
      if ((resp.status === 429 || resp.status >= 500) && attempt < MAX_RETRIES) {
        const backoff = Math.min(1000 * 2 ** attempt, 4000);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      let errMsg;
      try { const e = await resp.json(); errMsg = e?.error?.message || `HTTP ${resp.status}`; }
      catch { errMsg = `HTTP ${resp.status}`; }
      throw new Error(`OpenAI: ${errMsg}`);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err.name === 'AbortError' ? new Error('OpenAI request timed out') : err;
      if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 4000))); continue; }
      throw lastError;
    }
  }
  throw lastError ?? new Error('OpenAI call failed after all retries');
}
