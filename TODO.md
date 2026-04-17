# OpenClaw Cloud — TODO

Running list of work beyond v1. Each section is scoped to hand off to a single agent.

---

## 1. Redo the UI with DaisyUI

Current UI uses the `sea-ink` / `lagoon` / `foam` palette and custom `island-shell` classes inherited from the TanStack Start template. We don't like the look.

- Port the DaisyUI + Tailwind setup from `/Users/bensenescu/every-app-workspaces/open-seo` — reference its `src/client/styles/app.css`, `package.json` (daisyui version), and component patterns under `src/client/components/ui/` (button.tsx, modal.tsx, dropdown-menu.tsx, checkbox.tsx, etc.).
- Replace the custom island-shell aesthetic with the standard DaisyUI components and theme used by open-seo.
- Chat page, Settings page, Workspace page, Header — all rebuilt on DaisyUI.
- Keep the existing route structure (`/`, `/settings`, `/settings/$file`, `/workspace`, `/workspace/$`).

**Agent brief:** Compare open-seo's client styling setup to emily's current setup. Port the stack wholesale. Rebuild the five views on DaisyUI components, matching open-seo's visual conventions. Run `npm run ci:check` to verify it still passes.

---

## 2. OpenClaw-style onboarding flow

Current first-run experience: the four identity files get silently seeded with our generic text, and the user is dropped into an empty chat. OpenClaw (the reference project) has a much better onboarding that introduces the agent and walks the user through setting up their identity.

- Research OpenClaw's onboarding (repo: https://github.com/zeroclaw-labs/zeroclaw and original OpenClaw) — what prompts it uses, what it asks the user, how it writes the initial `SOUL.md` / `IDENTITY.md` / `USER.md`.
- Copy OpenClaw's onboarding prompts directly into our seed content in `src/worker/agent/core-files.ts` to start. Customize afterward.
- Build a first-run UX: detect that `USER.md` is still empty (or has only the seed template), and route the user into an onboarding sequence that walks through filling in the four files — probably a guided multi-turn chat where Claw asks questions and writes to the files as it learns.

**Agent brief:** Read OpenClaw's source to extract its onboarding prompts. Replace our current seed content with OpenClaw's. Design and build a first-run guided onboarding flow that the agent drives.

---

## 3. Bug: settings-file route isn't working

`/settings/$file` route is broken — navigating to e.g. `/settings/SOUL.md` doesn't load the file correctly. Unclear if it's a routing issue (dot in the param eating the segment) or a fetch/serialization issue. Reproduce, identify the root cause, fix.

Relevant files:

- `src/routes/settings.$file.tsx`
- `src/routes/settings.tsx` (the `<Link to="/settings/$file" params={{ file: ... }}>`)
- `src/worker/handlers/files.ts` (core-file GET/PUT)
- `src/lib/api-client.ts` (`readCoreFile` / `writeCoreFile`)

**Agent brief:** Reproduce the bug in `wrangler dev`. Figure out if TanStack is splitting the segment on `.`, if the encoding round-trips correctly, or if something else is off. Write a fix. Add a test if there's an easy place to add one.

---

## 4. Re-examine the "optional / fallback" patterns

The v1 implementation paved over two design questions with optional/fallback helpers instead of picking a side. Investigate whether these are actually necessary or just lazy.

### 4a. `readOrSeedCoreFile`

Does seeding on read actually need to happen lazily in `beforeTurn` + `listCoreFiles` + `readCoreFile`? Or should seeding happen _once_, intentionally, at DO creation or via an explicit onboarding step? The current lazy-seed-on-read means every code path has to know about the seed case.

File: `src/worker/agent/core-files.ts` (`readOrSeedCoreFile`), used in `build-system-prompt.ts` and `OpenClawAgent.ts`.

### 4b. `request` with `nullable` flag

The single `request<T>` helper accepts a `nullable` option that changes whether 404 throws or returns `null`. This is a behavior flag masquerading as an option. Should it be two distinct functions with distinct names? Or — better — should the server just not 404 for core files (since they're always seeded) and only 404 for workspace files, where we _do_ need the nullable path?

File: `src/lib/api-client.ts`.

**Agent brief:** Think about whether each "optional" is pulling its weight. Redesign to be explicit and intentional. If seeding should be an init step, make it one. If one branch only ever returns 404 and the other never does, their types should reflect that.

---

## 5. Type safety review

We took some shortcuts the first time that deserve a second pass.

### 5a. `Reflect.get` in MessageView

`src/components/chat/MessageView.tsx` uses `Reflect.get(value, key)` to dodge oxlint's `no-unsafe-type-assertion`. This is a code smell. The message-part parsing should use Zod schemas (or properly typed UIMessage parts from the AI SDK) to extract `input.query` / `input.url` / `input.path` safely.

### 5b. Type assertion disables in api-client, files handler, get-agent

Three places use `// eslint-disable-next-line typescript/no-unsafe-type-assertion`:

- `src/lib/api-client.ts` — `(await res.json()) as T`
- `src/worker/handlers/files.ts` — `JSON.parse(text) as T`
- `src/worker/lib/get-agent.ts` — `env.OpenClawAgent.get(id) as DurableObjectStub<OpenClawAgent>`

The first two could use Zod schemas for real validation. The third may go away if we type the DO binding properly — investigate whether we can augment the wrangler-generated `DurableObjectNamespace` to `DurableObjectNamespace<OpenClawAgent>`.

### 5c. Verify `wrangler types` is being run

User suspicion: maybe the worker-configuration types aren't fully accurate. Confirm `npm run cf-typegen` is up to date and that `worker-configuration.d.ts` is current. Consider wiring `cf-typegen` into `predev` / `prebuild`.

**Agent brief:** Replace the three eslint-disables with honest Zod schemas. Replace `Reflect.get` with typed parsing. Figure out the DO binding generic type. Make sure wrangler types are regenerated automatically.

---

## 6. Tiptap for markdown editing

Current editor is a plain `<textarea>` (`src/components/markdown/MarkdownEditor.tsx`). Upgrade to Tiptap for identity-file editing and for the onboarding flow.

- Tiptap — https://tiptap.dev — is a headless rich-text editor framework on top of ProseMirror. Tiptap v3 supports React.
- Use the `StarterKit` extension plus a Markdown-aware extension (either `@tiptap/pm` with a markdown serializer or a community `tiptap-markdown` package).
- Reference the todo-app's `TiptapTodoInput.tsx` and its `DateTokenDecoration` extension for our in-house patterns, but we'll want full markdown support rather than single-line.
- Research with context7: fetch current Tiptap docs for Markdown and React usage.

**Agent brief:** Research Tiptap's current markdown editing story (use context7 if available, otherwise WebFetch). Replace `MarkdownEditor` with a Tiptap-based editor while keeping the same `{ value, onChange }` interface. Use it for the four identity files and the upcoming onboarding flow.

---

## 7. Render thinking / reasoning blocks in chat

Current chat UI collapses all reasoning into a single `<details>summary="thinking…"</summary>` block per message. We want opencode-style individual thinking steps rendered inline as the model reasons.

User will share an opencode screenshot for reference (pending).

Relevant files:

- `src/components/chat/MessageView.tsx` — `part.type === "reasoning"` handling
- AI SDK v6 `UIMessage.parts` shape

**Agent brief:** Wait for the user's opencode reference screenshot. Then redesign the reasoning-part rendering to show structured thinking steps inline. Likely: each `reasoning` part becomes its own collapsible block with a distinctive visual style; consecutive reasoning chunks in the same message group together.

---

## 8. Voice input via Whisper transcription

Let users record a voice message in the chat and have it transcribed via Cloudflare Workers AI's Whisper model before sending.

- Cloudflare Workers AI hosts OpenAI's Whisper — model IDs: `@cf/openai/whisper` (base, multilingual) and `@cf/openai/whisper-large-v3-turbo` (faster / more accurate for longer audio). Verify current options in the Workers AI catalog at https://developers.cloudflare.com/workers-ai/models/.
- Client: add a microphone button next to the send button in `src/components/chat/InputBox.tsx`. Use `MediaRecorder` + `navigator.mediaDevices.getUserMedia` to capture audio. Show a waveform or recording timer while active. Stop-and-send or stop-and-review flow (decide based on UX).
- Server: add an endpoint (`POST /api/transcribe` or an agent RPC method) that accepts the audio blob, calls `env.AI.run("@cf/openai/whisper", { audio: [...bytes] })` or similar, and returns the transcript. See Workers AI docs for the exact input shape (expects a byte array of the raw audio).
- Insert the transcript into the input textarea. User can then edit before submitting, or auto-submit — configurable.

**Agent brief:** Confirm the current Whisper model IDs and request shape in Workers AI docs. Build the `POST /api/transcribe` endpoint that wraps `env.AI.run`. Add a mic button to `InputBox.tsx` that records, uploads, and drops the transcript into the input. Handle permissions denial, recording errors, and empty transcripts gracefully.

---

## Parking lot / future

- Exa → configurable: allow swapping to Brave or Tavily via env var.
- Model selector: UI to pick a Workers AI model without editing wrangler.jsonc.
- Context-block compaction for very long threads (Think's `configureSession` supports this; skipped for v1).
- Self-authored extensions via codemode (needs Worker Loader closed-beta access).
- Sub-agent Facets for deep research delegation.
- Conversation branching (Think's tree-structured sessions).
- Scheduled `HEARTBEAT.md` routines via DO Alarms.
- Deploy-to-Cloudflare button + one-click onboarding for distribution.
