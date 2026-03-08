<div align="center">

# 🤖 kAIhoot

### AI-Powered Kahoot Auto-Answer Chrome Extension

**The most complete Kahoot AI assistant - supporting every question type, including ones no other tool can handle.**

[![Version](https://img.shields.io/badge/Version-3.4.0-blueviolet?style=for-the-badge)](https://github.com/Gavri-dev/kAIhoot/releases)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![OpenAI](https://img.shields.io/badge/Powered_by-OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/api-keys)

**No quiz ID needed · No paywall · No server · BYO API key · Works on any live game**

> ⚠️ **Requires the host to have "Show questions & answers on players' devices" enabled in Kahoot settings.** This is on by default for most games. If the host disables it, the extension has no question data to work with.

</div>

## ⚡ What Makes This Different

Most Kahoot tools only handle basic multiple-choice. Some need the Quiz ID beforehand. Others hide behind a paywall or shared server that gets rate-limited.

kAIhoot works on **every** question type Kahoot offers, answers in real-time during live games, and runs entirely on your own OpenAI key. No middleman, no limits, no accounts.

| Feature | kAIhoot | QuizGPT | KahootGPT |
|---|:---:|:---:|:---:|
| Multiple Choice | ✅ | ✅ | ✅ |
| True/False | ✅ | ✅ | ✅ |
| Multi-Select | ✅ | ✅ | ✅ |
| Pin-It (Map/Image) 🔥 | ✅ | ❌ | ❌ |
| Jumble (Reorder) 🔥 | ✅ | ❌ | ❌ |
| Slider (Numeric) 🔥 | ✅ | ❌ | ❌ |
| Open-Ended (Type) 🔥 | ✅ | ❌ | ❌ |
| Vision AI for images 🔥 | ✅ | ❌ | ❌ |
| Works on custom quizzes | ✅ | ✅ | ❌ |
| No Quiz ID needed | ✅ | ✅ | ❌ |
| BYO API key (no paywall) | ✅ | ❌ | ❌ |
| GPT-5 support | ✅ | ❌ | ❌ |
| Answer delay (stealth) | ✅ | ❌ | ✅ |
| Silent mode | ✅ | ❌ | ❌ |
| Free & open source | ✅ | ❌ | ❌ |

## 🧠 Supported Question Types

**📝 Multiple Choice & True/False** - Reads the question and all choices from the WebSocket, sends to GPT, highlights and clicks the correct answer. Handles image-based choices by reading `aria-label` attributes.

**☑️ Multi-Select** - Evaluates each option independently using a YES/NO per-option prompt strategy. Filters out fabricated or nonsensical choices and selects all correct answers (typically 2-4 out of the options).

**📍 Pin-It (Map & Image Questions)** - Sends the image to GPT-4.1 Vision with a coordinate system and landmark reference points for world maps. Places the pin on the correct location via SVG coordinate injection. No other Kahoot tool does this.

**🧩 Jumble (Reorder)** - Reads shuffled tiles, asks GPT for the correct order, computes the tile permutation mapping, then reorders through React fiber tree manipulation and drag-click simulation.

**🎚️ Slider (Numeric)** - Asks GPT the factual question, snaps the answer to the nearest valid step value using offset math (`min + round((value - min) / step) * step`), sends the WS answer during the loading animation for speed, then sets the visual slider and clicks submit.

**✏️ Open-Ended (Type Answer)** - Generates a short answer within the character limit, types it character-by-character with simulated keyboard events (keydown → InputEvent → keyup) to work with React controlled inputs, then submits.

## 🛠️ Installation

1. **Download** - Clone or download this repository
   ```bash
   git clone https://github.com/Gavri-dev/kAIhoot.git
   ```

2. **Load in Chrome** - Go to `chrome://extensions/`, enable **Developer Mode** (top right), click **Load unpacked**, and select the `kAIhoot` folder.

3. **Add your API key** - Click the extension icon, expand OpenAI settings, and paste your [OpenAI API key](https://platform.openai.com/api-keys). Model defaults to `gpt-5-mini` (fast + cheap), but you can use any model.

4. **Join a Kahoot game** - the extension activates automatically on `kahoot.it`

## ⚙️ Settings

| Setting | Default | What it does |
|---|---|---|
| Highlight Answer | ✅ On | Green glow on the correct answer |
| Auto-Click | ✅ On | Automatically clicks/submits |
| Answer Delay | 0s | Configurable delay (0-30s) with countdown overlay |
| Silent Mode | ❌ Off | Hides all on-screen indicators |
| Model | `gpt-5-mini` | Any OpenAI model (`gpt-5-mini`, `gpt-5`, `gpt-4.1`, etc.) |

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

`injected.js` hooks into the page's WebSocket and intercepts question data as Kahoot sends it - before the UI even renders. `content.js` enriches the question (image labels, slider config from DOM) and passes it to the service worker. `autoresponder.js` routes it to the right handler in `openai.js`, and the answer flows back through the chain into DOM manipulation + WS submission.

Questions are sent to AI the instant they arrive via WebSocket (during the loading animation). Slider and jumble answers are submitted via WS before the UI is even interactive. Pin placement polls the SVG at 100ms intervals instead of waiting for buffers.

## 🔒 Privacy

Your API key is stored in `chrome.storage.sync` and only sent to OpenAI. There's no backend, no analytics, no telemetry, no data collection. The extension only has permissions for `storage`, `kahoot.it`, and `api.openai.com`.

## 💰 API Cost

A typical 20-question game on `gpt-5-mini` costs about $0.01-0.03. Pin-it questions are slightly more (~$0.02 each) because they use `gpt-4.1` for vision.

## 🧪 Tested With

Standard quiz (4-choice), true/false, multi-select (2-4 correct), pin-it with world maps and custom images, jumble (3-8 tiles), slider with numeric ranges, open-ended with character limits, image-based answer choices, mixed-type quizzes, and surveys/polls (auto-skipped since they're non-scored).

## 🤝 Credits

Built by [@Gavri-dev](https://github.com/Gavri-dev). Originally based on [QuizGPT](https://github.com/im23b-busere/QuizGPT) by [@im23b-busere](https://github.com/im23b-busere) (MIT License). Extended with full question type coverage, vision AI, React DOM manipulation, WS-first submission, and a lot of speed/robustness work.

## ⚠️ Disclaimer

Educational and research purposes only. Demonstrates how browser extensions interact with web applications through WebSocket interception and DOM manipulation. Not affiliated with Kahoot! or OpenAI. Use responsibly.

## 📄 License

[MIT](LICENSE) - do whatever you want, just keep the copyright notice.

<div align="center">

**If this helped you, drop a ⭐**

</div>
