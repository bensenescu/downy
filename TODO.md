# OpenClaw Cloud — TODO

Running list of work beyond v1. Each section is scoped to hand off to a single agent.

---

## 2. OpenClaw-style onboarding flow

Current first-run experience: the four identity files get silently seeded with our generic text, and the user is dropped into an empty chat. OpenClaw (the reference project) has a much better onboarding that introduces the agent and walks the user through setting up their identity.

- Research OpenClaw's onboarding (repo: https://github.com/zeroclaw-labs/zeroclaw and original OpenClaw) — what prompts it uses, what it asks the user, how it writes the initial `SOUL.md` / `IDENTITY.md` / `USER.md`.
- Copy OpenClaw's onboarding prompts directly into our seed content in `src/worker/agent/core-files.ts` to start. Customize afterward.
- Build a first-run UX: detect that `USER.md` is still empty (or has only the seed template), and route the user into an onboarding sequence that walks through filling in the four files — probably a guided multi-turn chat where Claw asks questions and writes to the files as it learns.

**Agent brief:** Read OpenClaw's source to extract its onboarding prompts. Replace our current seed content with OpenClaw's. Design and build a first-run guided onboarding flow that the agent drives.

---

## 6. Tiptap for markdown editing

Current editor is a plain `<textarea>` (`src/components/markdown/MarkdownEditor.tsx`). Upgrade to Tiptap for identity-file editing and for the onboarding flow.

- Tiptap — https://tiptap.dev — is a headless rich-text editor framework on top of ProseMirror. Tiptap v3 supports React.
- Use the `StarterKit` extension plus a Markdown-aware extension (either `@tiptap/pm` with a markdown serializer or a community `tiptap-markdown` package).
- Reference the todo-app's `TiptapTodoInput.tsx` and its `DateTokenDecoration` extension for our in-house patterns, but we'll want full markdown support rather than single-line.
- Research with context7: fetch current Tiptap docs for Markdown and React usage.

**Agent brief:** Research Tiptap's current markdown editing story (use context7 if available, otherwise WebFetch). Replace `MarkdownEditor` with a Tiptap-based editor while keeping the same `{ value, onChange }` interface. Use it for the four identity files and the upcoming onboarding flow.

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
