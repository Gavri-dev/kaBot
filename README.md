<div align="center">

# 🤖 kAIhoot

### AI-Powered Kahoot Auto-Answer Chrome Extension

**The most complete Kahoot AI assistant - supports every major scored question type, including ones most other tools cannot handle.**

[![Version](https://img.shields.io/badge/Version-3.5.0-blueviolet?style=for-the-badge)](https://github.com/Gavri-dev/kAIhoot/releases)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-blue?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![OpenAI](https://img.shields.io/badge/Powered_by-OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/api-keys)

**No quiz ID needed · No paywall · No server · Bring your own API key · Works on live games**

> ⚠️ The host needs to have **"Show questions & answers on players' devices"** enabled in their Kahoot settings. This is on by default for most games. If the host turns it off, the extension will not have enough question data to answer.

</div>

## 📑 Table of Contents

| | |
|---|---|
| [⚡ What Makes This Different](#-what-makes-this-different) | [🏗️ How It Works](#️-how-it-works) |
| [🧠 Supported Question Types](#-supported-question-types) | [🔒 Privacy](#-privacy) |
| [🛠️ Installation](#️-installation) | [💰 API Cost](#-api-cost) |
| [⚙️ Settings](#️-settings) | [🧪 Development & Testing](#-development--testing) |
| [🔧 Troubleshooting](#-troubleshooting) | [📌 Notes & Limitations](#-notes--limitations) |

## ⚡ What Makes This Different

Most Kahoot tools only handle basic multiple-choice. Some need the Quiz ID beforehand. Others are paywalled or rely on a shared backend that gets rate-limited, breaks, or disappears.

kAIhoot works in real time during live games, supports every major scored question type, and runs entirely on your own OpenAI key. There is no middleman, no shared answer server, and no account to create beyond OpenAI.

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
| Bring your own API key | ✅ | ❌ | ❌ |
| GPT-5 support | ✅ | ❌ | ❌ |
| Answer delay | ✅ | ❌ | ✅ |
| Silent mode | ✅ | ❌ | ❌ |
| Free & open source | ✅ | ❌ | ❌ |

## 🧠 Supported Question Types

**📝 Multiple Choice & True/False** - Reads the question and choices from the live game payload, sends them to OpenAI, then highlights and optionally clicks the best answer.

**☑️ Multi-Select** - Evaluates options independently and selects all answers that are genuinely correct, while rejecting clearly wrong or fabricated options.

**📍 Pin-It (Map & Image Questions)** - Uses a vision-capable model to estimate the correct location from the image. Pin answers are inherently approximate, so they are handled more carefully than standard quiz answers.

**🧩 Jumble (Reorder)** - Reads the shuffled tiles, asks the model for the correct order, computes the needed permutation, then reorders the tiles in the client.

**🎚️ Slider (Numeric)** - Asks the model for the best numeric answer, snaps it to the nearest legal step value, and answers as quickly as possible.

**✏️ Open-Ended (Type Answer)** - Generates a short answer within the character limit, types it into the input, and submits it automatically.

## 🛠️ Installation

### Step 1: Download the extension

**Option A: Download ZIP (easiest, no git needed)**

1. Click the green **Code** button at the top of this page
2. Click **Download ZIP**
3. Extract the downloaded ZIP to a folder on your computer
4. Remember where you extracted it, you will need that folder in the next step

**Option B: Clone with Git**

If you have Git installed, open a terminal and run:

```bash
git clone https://github.com/Gavri-dev/kAIhoot.git
```

### Step 2: Load the extension in Chrome

1. Open `chrome://extensions/`
2. Turn **Developer mode** on
3. Click **Load unpacked**
4. Select the folder that directly contains `manifest.json`
5. The extension should now appear in your extensions list

If you see a `manifest.json` error, make sure you selected the folder that directly contains `manifest.json`, not a parent folder.

### Step 3: Get an OpenAI API key

The extension uses your own OpenAI API key to answer questions. A small amount of credit goes a long way.

1. Go to [platform.openai.com](https://platform.openai.com) and sign in
2. Add billing at [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing)
3. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
4. Create a new secret key
5. Copy and save it somewhere safe

### Step 4: Configure the extension

1. Click the extensions icon in Chrome
2. Open **kAIhoot**
3. Expand **OpenAI Settings**
4. Paste your API key into the **API Key** field
5. Leave the main model as `gpt-5-mini` unless you want to experiment
6. Save your settings

### Step 5: Play

1. Go to [kahoot.it](https://kahoot.it) and join a live game
2. The extension activates automatically
3. When a question appears, kAIhoot reads it, sends it to OpenAI, and highlights or answers it based on your settings

If you want it to wait before answering, increase the **Answer Delay** setting in the popup.

## ⚙️ Settings

| Setting | Default | What it does |
|---|---|---|
| Highlight Answer | ✅ On | Highlights the suggested answer on screen |
| Auto-Click | ✅ On | Automatically clicks or submits answers when supported |
| Answer Delay | 0s | Wait 0-30 seconds before answering |
| Silent Mode | ❌ Off | Hides status indicators and most visual feedback |
| Model | `gpt-5-mini` | Main model for standard text questions |
| Vision Model | `gpt-4.1` | Used for image-heavy / pin-style questions |

## 🏗️ How It Works

When you join a Kahoot game, the extension intercepts the WebSocket connection between your browser and Kahoot's servers. As soon as a question reaches the client, kAIhoot extracts the question data, enriches it with DOM information when useful, sends it to OpenAI, and then highlights or answers it.

```text
┌─────────────────────────────────────────────────────┐
│  Kahoot.it (Browser Tab)                            │
│                                                     │
│  ┌─────────────┐     ┌──────────────┐               │
│  │ injected.js │◄───►│  Kahoot WS   │               │
│  │ (page ctx)  │     │  Server      │               │
│  └──────┬──────┘     └──────────────┘               │
│         │ CustomEvents                              │
│  ┌──────▼──────┐                                    │
│  │ content.js  │  DOM interaction, status UI,       │
│  │ (content)   │  delay handling, pin/jumble/etc.   │
│  └──────┬──────┘                                    │
│         │ chrome.runtime messages                   │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│  autoresponder.js (Service Worker)                  │
│  Routes question data to the right handler          │
│         │                                           │
│  ┌──────▼──────┐     ┌──────────────┐               │
│  │  openai.js  │────►│  OpenAI API  │               │
│  │             │◄────│              │               │
│  └─────────────┘     └──────────────┘               │
└─────────────────────────────────────────────────────┘
```

`injected.js` hooks the page-side WebSocket. `content.js` manages page state, DOM interaction, and UI timing. `autoresponder.js` routes questions by type, and `openai.js` formats model requests and parses the results.

v3.5.0 also refactors the higher-risk parsing and matching logic into reusable core modules, making the extension easier to maintain and safer when model output is imperfect.

## 🔒 Privacy

Your OpenAI API key is stored locally in `chrome.storage.local` and is only sent to OpenAI. There is no backend, no analytics, no telemetry, and no answer relay server. The extension only requests the permissions it needs for storage and the relevant sites.

## 💰 API Cost

A typical 20-question game on `gpt-5-mini` is very cheap. Image-heavy and pin-style questions cost more because they use a vision-capable model. In practice, a few dollars of OpenAI credit can last a long time unless you play constantly or choose larger models.

## 🧪 Development & Testing

v3.5.0 adds a more maintainable internal structure and basic release tooling:

- reusable core matching/parsing modules under `scripts/core/`
- dedicated Kahoot DOM adapter helpers
- unit tests for critical matching and parsing logic
- syntax-check tooling for release sanity checks

Recommended commands:

```bash
npm test
npm run check
```

## 🔧 Troubleshooting

**Extension does not activate / no status badge appears**
- Make sure you are on `kahoot.it`
- Refresh the page after loading or updating the extension
- Check `chrome://extensions/` and make sure kAIhoot is enabled

**No API key / key not saved**
- Re-open the popup and save the key again
- Make sure the key starts with `sk-`
- If you upgraded from an older version, the key should be migrated automatically

**Answers are wrong or empty**
- Make sure your OpenAI account has billing enabled
- Try a stronger model for harder questions
- Remember that pin answers can be approximate even when working correctly

**Some question types do not answer**
- The host may have disabled **Show questions & answers on players' devices**
- Polls and surveys are intentionally skipped because they are not scored

**Chrome shows a manifest error**
- You likely selected the wrong folder when loading the extension

## 📌 Notes & Limitations

- Pin answers are inherently approximate because they depend on visual interpretation rather than discrete choices.
- The extension is optimized for current Kahoot behavior. Future DOM or client changes may require updates.
- Model output is validated more carefully in v3.5.0, so ambiguous answers are more likely to be rejected instead of auto-clicked.

## 🧪 Tested With

Standard quiz, true/false, multi-select, pin-it, jumble, slider, open-ended, image-based answer choices, and mixed-type quizzes.

## 🤝 Credits

Built by [@Gavri-dev](https://github.com/Gavri-dev). Originally based on [QuizGPT](https://github.com/im23b-busere/QuizGPT) by [@im23b-busere](https://github.com/im23b-busere) (MIT License). Expanded with full question-type coverage, vision handling, WS-first answering, safer matching, and maintainability improvements.

## ⚠️ Disclaimer

Educational and research purposes only. Demonstrates how browser extensions can interact with web applications through WebSocket interception and DOM manipulation. Not affiliated with Kahoot! or OpenAI. Use responsibly.

## 📄 License

[MIT](LICENSE) - do whatever you want, just keep the copyright notice.

<div align="center">

**Latest release: v3.5.0**  
See `CHANGELOG.md` or the GitHub Releases page for version-specific changes.

**If this helped you, drop a ⭐**

</div>
