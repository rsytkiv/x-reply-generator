# X Reply Generator

A Chrome extension that drafts one short reply for any post on x.com, in **your** style.
Click **Reply idea** under a post, edit the text if you want, copy it, and post it yourself.
No auto-posting, no accounts, no server: it talks to Claude with your own API key.

[Інструкція українською ↓](#інструкція-українською)

## Install (about 2 minutes)

1. Download the latest `x-reply-generator-vX.Y.Z.zip` from [Releases](../../releases) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and pick the unzipped folder.
3. The settings page opens. Paste your API key (see below), press **Save key**, then **Test key**.
4. In **Your reply style**: describe the replies you want, paste a few replies you really wrote, press
   **Generate style**. Read the result, try it on a post with **Try it**, then press **Save style**.
5. Open x.com. Every post (except ads) has a **Reply idea** button.

To update: download the new zip, replace the folder, and press ↻ on the extension in `chrome://extensions`.
Your key, style, and saved replies stay.

### The API key

- Create one at [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys) and add a bit of credit.
- A **Claude Pro or Max subscription doesn't work** here. The API is billed separately, pay as you go.
- Cost: about **$0.0002 per reply** on the default model (Claude Haiku 5.5), so 1,000 replies is roughly $0.20.
  Generating a style costs about $0.02 once.
- Tip: make a separate key with a monthly spend limit.

## Using it

- **Reply idea**: the first click writes a reply. Reopening the same post shows the saved one, with no API call.
- **Regenerate**: a different take. Up to 5 versions per post, switch with ‹ ›.
- **+ my angle**: steer it, e.g. `agree, but mention maintenance costs`.
- Posts that are mostly a picture or video: the model can't see media, so it asks you for an angle first.
- Toolbar icon: on a post page it uses that post. Anywhere else you can paste text.

## Your style

The settings page has:

- **Style prompt**: plain instructions plus examples (Goal / Voice / Never / Examples). You can generate it,
  edit it by hand, or press **Reset to default** for the built-in casual, lowercase, networking style.
- **Reply language**: English, Ukrainian, or the same as the post.
- **Reply length**: short (often a few words) or medium (a sentence or two).
- **all lowercase**: on by default.

Some rules are always on, whatever the style says: no made-up facts or personal experience, never guessing
names from handles, never mentioning prompts, no em dashes, and post text is treated as data, never as
instructions. Changing the style means new replies; old saved ones aren't reused.

## Privacy

- Only the post you click (plus its parent or quoted post) is sent, only to `api.anthropic.com`, only when you click.
- Your key, style, and saved replies live in this Chrome profile (`chrome.storage.local`). The key is stored
  unencrypted on your computer and can't be read by x.com or other extensions.
- No analytics, no tracking, no browsing history.
- If X auto-translates a post for you, the translated text is what gets sent.

---

## Інструкція українською

Розширення для Chrome, яке пише один короткий реплай на будь-який пост на x.com **у твоєму стилі**.
Натискаєш **Reply idea** під постом, за потреби редагуєш, копіюєш і публікуєш сам.

**Встановлення (2 хвилини)**

1. Завантаж останній `x-reply-generator-vX.Y.Z.zip` з [Releases](../../releases) і розпакуй.
2. Відкрий `chrome://extensions`, увімкни **Developer mode** (справа вгорі), натисни **Load unpacked** і вибери розпаковану папку.
3. Відкриється сторінка налаштувань. Встав API-ключ, натисни **Save key**, потім **Test key**.
4. У розділі **Your reply style**:
   - опиши, які реплаї хочеш (можна українською);
   - встав кілька своїх справжніх відповідей;
   - натисни **Generate style**.

   Прочитай результат, перевір на пості через **Try it** і натисни **Save style**.
   Якщо хочеш реплаї українською, вибери **Reply language → Ukrainian**.
5. Відкрий x.com: під кожним постом (крім реклами) з'явиться кнопка **Reply idea**.

**API-ключ**

- Створи ключ на [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys) і поповни баланс.
- **Підписка Claude Pro чи Max тут не підходить.** API оплачується окремо, за використання.
- Ціна: приблизно **$0.0002 за реплай**, тобто ~$0.20 за 1000 відповідей. Генерація стилю коштує ~$0.02 один раз.
- Порада: зроби окремий ключ із місячним лімітом витрат.

**Оновлення:** завантаж новий zip, заміни папку і натисни ↻ біля розширення в `chrome://extensions`. Ключ, стиль і збережені реплаї лишаються.

---

## For developers

```bash
npm install
npm run build
```

Then **Load unpacked** the `dist/` folder.

| Command | What it does |
|---|---|
| `npm run build` / `npm run watch` | Bundle into `dist/` (the version comes from `package.json`) |
| `npm test` | Unit tests: extractor on X-shaped HTML, prompt, postprocess, cache, dedup, quality checks, style generator |
| `npm run typecheck` | TypeScript |
| `npm run e2e` | Loads the built extension in Playwright's Chromium against a fake x.com and a mocked API |
| `npm run eval:style` | Runs 28 sample posts through the real model with the default style (needs `ANTHROPIC_API_KEY` in `.env`, under a cent) |

**Releasing:** bump `version` in `package.json`, commit, then push a tag `vX.Y.Z`. The Release workflow
checks the tag matches, runs the tests, builds, and attaches the zip to a GitHub Release.

### How a reply is made

- One call to Claude Haiku 5.5 (`effort: medium`, thinking off, max 200 tokens).
- The system prompt is fixed rules (`buildSystemPrompt` in `src/prompt/system.ts`) plus the user's style inside `<style>`.
- With the "short" length setting, about 40% of plain generations ask for a 1-4 word reaction.
- The last 10 replies across all posts are kept locally and sent along, so replies don't repeat the same wording.
- A cheap check runs on every reply. If it is too long, repeats a recent opener or phrase, claims experience the
  user never shared, isn't in English (when English is selected), or talks about prompts, there is **one** retry.
  A reply that still talks about prompts is never shown.
- The cache key includes a hash of the full system prompt, so a style change never brings back old replies.

### Changing the built-in rules or default style

Edit `src/prompt/system.ts`, bump `PROMPT_VERSION` in `src/config.ts`, and record the new hash in
`tests/prompt.test.ts` (the failing test prints it).

### Where things live

- `src/content/extract.ts`: all X DOM selectors. If X changes its markup, this is the file to fix.
- `src/background/`: API calls, style generator, cache (`chrome.storage.local`), in-flight request sharing.
- `src/ui/reply-panel.ts`: the panel used on the page and in the toolbar popup.
- `src/options/`: the settings page.
- `docs/PLAN.md`: the original design notes (Ukrainian).
