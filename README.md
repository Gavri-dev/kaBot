<div align="center">

# 🤖 kAIhoot

### AI-Powered Kahoot Auto-Answer Chrome Extension

**The most complete Kahoot AI assistant — supporting every question type, including ones no other tool can handle.**

[![Version](https://img.shields.io/badge/Version-3.4.0-blueviolet?style=for-the-badge)](https://github.com/Gavri-dev/kAIhoot/releases)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![OpenAI](https://img.shields.io/badge/Powered_by-OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com)

---

**No quiz ID needed · No paywall · No server · BYO API key · Works on any live game**

> ⚠️ **Requires the host to have "Show questions & answers on players' devices" enabled in Kahoot settings.** This is on by default for most games. If the host disables it, the extension has no question data to work with.

</div>

---

## ⚡ What Makes This Different

Most Kahoot tools only handle basic multiple-choice. Some need the Quiz ID beforehand. Others hide behind a paywall or shared server that gets rate-limited.

**kAIhoot works on every question type Kahoot offers**, answers in real-time during live games, and runs entirely on your own OpenAI key — no middleman, no limits, no accounts.

| Feature | kAIhoot | QuizGPT | KahootGPT |
|---|:---:|:---:|:---:|
| Multiple Choice | ✅ | ✅ | ✅ |
| True/False | ✅ | ✅ | ✅ |
| Multi-Select | ✅ | ✅ | ✅ |
| Pin-It (Map/Image)🔥 | ✅  | ❌ | ❌ |
| Jumble (Reorder)🔥 | ✅  | ❌ | ❌ |
| Slider (Numeric)🔥 | ✅  | ❌ | ❌ |
| Open-Ended (Type)🔥 | ✅  | ❌ | ❌ |
| Vision AI for images🔥 | ✅ | ❌ | ❌ |
| Works on custom quizzes | ✅ | ✅ | ❌ |
| No Quiz ID needed | ✅ | ✅ | ❌ |
| BYO API key (no paywall) | ✅ | ❌ | ❌ |
| GPT-5 support | ✅ | ❌ | ❌ |
| Answer delay (stealth) | ✅ | ❌ | ✅ |
| Silent mode | ✅ | ❌ | ❌ |
| Free & open source | ✅ | ❌ | ❌ |

---

## 🧠 Supported Question Types

### 📝 Multiple Choice & True/False
Reads the question and all choices from the WebSocket, sends to GPT, highlights and clicks the correct answer. Handles image-based choices by reading `aria-label` attributes.

### ☑️ Multi-Select
Evaluates each option independently using a YES/NO per-option prompt strategy. Filters out fabricated or nonsensical choices and selects all correct answers — typically 2-4 out of the options.

### 📍 Pin-It (Map & Image Questions)
Sends the image to **GPT-4.1 Vision** with a detailed coordinate system and landmark reference points for world maps. Places the pin on the correct location via SVG coordinate injection. *No other Kahoot tool does this.*

### 🧩 Jumble (Reorder)
Reads shuffled tiles, asks GPT for the correct order, computes the tile permutation mapping, then simulates drag-and-click reordering through React's virtual DOM — including fiber tree manipulation for React state updates.

### 🎚️ Slider (Numeric)
Asks GPT the factual question, snaps the answer to the nearest valid step value using offset math (`min + round((value - min) / step) * step`), sends the WS answer during the loading animation for speed, then sets the visual slider and clicks submit.

### ✏️ Open-Ended (Type Answer)
Generates a short answer within the character limit, types it character-by-character with simulated keyboard events (keydown → InputEvent → keyup) to work with React controlled inputs, then submits.

---

## 🛠️ Installation

### From Source (Recommended)

1. **Download** — Clone or download this repository
   ```bash
   git clone https://github.com/Gavri-dev/kAIhoot.git
   ```

2. **Load in Chrome**
   - Navigate to `chrome://extensions/`
   - Enable **Developer Mode** (top right toggle)
   - Click **Load unpacked**
   - Select the `kAIhoot` folder

3. **Add your API key**
   - Click the extension icon in Chrome
   - Expand the OpenAI settings
   - Paste your [OpenAI API key](https://platform.openai.com/api-keys)
   - Model defaults to `gpt-5-mini` (fast + cheap), but you can use any model

4. **Join a Kahoot game** — the extension activates automatically on `kahoot.it`

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| **Highlight Answer** | ✅ On | Visually highlights the correct answer with a green glow |
| **Auto-Click** | ✅ On | Automatically clicks/submits the answer |
| **Answer Delay** | 0s | Adds a configurable delay (0-30s) before answering — shows a countdown overlay |
| **Silent Mode** | ❌ Off | Hides all on-screen indicators (status badge, timer, highlights) |
| **Model** | `gpt-5-mini` | Any OpenAI model — `gpt-5-mini`, `gpt-5`, `gpt-4.1`, etc. |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│  Kahoot.it (Browser Tab)                            │
│                                                     │
│  ┌─────────────┐     ┌──────────────┐               │
│  │ injected.js │◄───►│  Kahoot WS   │               │
│  │ (page ctx)  │     │  Server      │               │
│  └──────┬──────┘     └──────────────┘               │
│         │ CustomEvents                              │
│  ┌──────▼──────┐                                    │
│  │ content.js  │  DOM manipulation, status UI,      │
│  │ (content)   │  answer delay, pin/jumble/slider   │
│  └──────┬──────┘                                    │
│         │ chrome.runtime messages                   │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│  autoresponder.js (Service Worker)                  │
│  Routes questions to the right handler              │
│         │                                           │
│  ┌──────▼──────┐     ┌──────────────┐               │
│  │  openai.js  │────►│  OpenAI API  │               │
│  │             │◄────│              │               │
│  └─────────────┘     └──────────────┘               │
└─────────────────────────────────────────────────────┘
```

**How it works:**

1. **`injected.js`** hooks into the page's WebSocket and intercepts question data as Kahoot sends it to the client — before the UI even renders
2. **`content.js`** enriches the question (image labels, slider config from DOM) and sends it to the service worker
3. **`autoresponder.js`** routes it to the correct handler in **`openai.js`** based on question type
4. The AI response flows back through the chain: service worker → content script → injected script → DOM manipulation + WS submission

**Speed optimizations:**
- Questions are sent to AI the instant they arrive via WebSocket — during the loading animation
- Slider and jumble answers are sent via WS before the UI is interactive
- Pin placement starts polling for the SVG at 100ms intervals, not waiting for any buffer

---

## 🔒 Privacy & Security

- **Your API key stays local** — stored in Chrome's `chrome.storage.sync`, never sent anywhere except OpenAI
- **No external servers** — zero backend, no analytics, no telemetry
- **No data collection** — the extension doesn't log or transmit anything
- **Minimal permissions** — only `storage` and access to `kahoot.it` and `api.openai.com`

---

## 💰 API Cost

Using `gpt-5-mini` (default), a typical 20-question Kahoot game costs roughly **$0.01-0.03** in API credits. Pin-it questions cost slightly more (~$0.02 each) because they use `gpt-4.1` for vision.

---

## 🧪 Tested With

- ✅ Standard quiz (4-choice)
- ✅ True/False
- ✅ Multi-select (2-4 correct answers)
- ✅ Pin-it with world maps
- ✅ Pin-it with custom images
- ✅ Jumble (3-8 tiles)
- ✅ Slider with numeric ranges
- ✅ Open-ended with character limits
- ✅ Image-based answer choices
- ✅ Mixed-type quizzes
- ✅ Surveys/polls (auto-skipped, non-scored)

---

## 🤝 Credits

Built by [@Gavri-dev](https://github.com/Gavri-dev).

Originally based on [QuizGPT](https://github.com/im23b-busere/QuizGPT) by [@im23b-busere](https://github.com/im23b-busere) (MIT License).

Extended with full question type coverage, vision AI, React DOM manipulation, WS-first submission, and numerous speed/robustness improvements.

---

## ⚠️ Disclaimer

This project is for **educational and research purposes only**. It demonstrates how browser extensions can interact with web applications through WebSocket interception and DOM manipulation.

This project is **not affiliated with Kahoot! or OpenAI**. Kahoot! and the K! logo are trademarks of Kahoot! AS. Use responsibly and only in settings where you have permission.

---

## 📄 License

[MIT License](LICENSE) — do whatever you want, just include the copyright notice.

---

<div align="center">

**If this helped you, drop a ⭐ — it helps others find it.**

</div>
