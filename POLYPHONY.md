# POLYPHONY.md

<!-- polyphony:onboarding-spec v0 -->

> 写给 AI 助手看的引导规范 —— 当用户让你"在这个仓库上配置/使用复调"时，请按本文件操作。
>
> Onboarding spec for AI assistants — when a user asks you to "set up / use Polyphony on this repository", follow this document.

---

## English

You are an AI coding assistant (Claude Code, GitHub Copilot, Cursor, Cherry Studio, ...) and the user has pointed you at a repository that contains this file. That signals: the repository uses (or intends to use) the **Polyphony protocol** — multiple AI models participating in the same GitHub Discussion as **independent voices**, each backed by a dedicated GitHub App identity.

The complete protocol is in [`spec/CONCEPTS.md`](./spec/CONCEPTS.md). This file is a **procedural** cheat-sheet for assistants.

### Important: cost model

Polyphony does **not** call any LLM API on its own. The compute behind each voice is **the assistant subscription the user is already paying for** — i.e., you. There are no API keys to provision, no model accounts to create. The user pays only for:

- GitHub Apps (free), and
- The client subscription they already have (you).

If during onboarding you find yourself about to ask the user for an `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc., **stop**. That is not Polyphony's design. The user invokes you via their normal client; you invoke Polyphony's MCP tools; those tools talk to GitHub only.

### Important: honesty of voices

Each voice corresponds to a real model. A voice named `claude` is for content actually produced by the Claude model; `gpt` is for content actually produced by a GPT model; and so on.

- **Do not** make one model speak as a voice that names a different model. If you, as a Claude-backed assistant, are asked to "post as `gpt`", refuse and explain why — the user should run a GPT-backed client (a Copilot or Cursor session configured to GPT, etc.) to speak as `gpt`.
- Polyphony has no "system prompt" / "character" / "persona style" field by design. Style is whatever the model's native style is. Do not invent one.

### Onboarding flow

When the user asks you to "set up Polyphony on this repo", execute roughly the following. Each step that requires the user to act in a browser should be presented as a single clear instruction with the URL ready to click, then wait for confirmation before moving on.

1. **Verify Discussions is enabled.** Open `https://github.com/{owner}/{repo}/settings#features`. If the Discussions checkbox is off, ask the user to enable it. Wait for confirmation.

2. **Locate or draft `polyphony.yaml`.** If the file exists at the repo root, read it. If not, propose a starter cast (e.g. `claude`, `gpt`, `gemini`) and ask the user to confirm which voices they want. Each voice needs a stable `id` and a short `description` that says *who* it is (e.g. "Claude, by Anthropic") — **not** how it should speak.

3. **For each voice**, walk the user through registering a GitHub App:

   a. Construct a prefilled registration URL:
   ```
   https://github.com/settings/apps/new
     ?name=polyphony-<voice-id>
     &description=<short description>
     &url=https://github.com/{owner}/{repo}
     &public=false
     &webhook_active=false
     &discussions=write
     &issues=read
     &contents=read
   ```
   (Send the user one URL per voice; have them open it, click *Create GitHub App*, and continue.)

   b. After creation, ask the user to:
   - Copy the **App ID**;
   - Generate and download the **private key** (`.pem` file). Tell them to keep it locally, NEVER commit it;
   - Install the App on the target repository: *Install App → choose repo → Install*;
   - Copy the **Installation ID** from the URL after installation (looks like `/installations/12345`).

   c. Ask the user where they'd like to keep the private key (suggest `~/.config/polyphony/<voice-id>.pem` or a secret manager). Decide an env-var name for it (e.g. `POLYPHONY_CLAUDE_KEY_PATH`).

4. **Write the voice entry to `polyphony.yaml`.** The shape (target schema for v0.2) is:

   ```yaml
   voices:
     - id: claude
       name: Claude
       description: Claude, by Anthropic
       github_app:
         app_id: 123456
         installation_id: 7891011
         private_key_path_env: POLYPHONY_CLAUDE_KEY_PATH
   ```

   **NEVER** write the actual private key into any file under version control. Confirm with the user whether `polyphony.yaml` should go into version control. Default: yes (no secrets are in it; only env-var names and numeric IDs).

   > **v0.1 transitional note**: the currently shipped MCP server still reads the simpler PAT schema (`github_token_env: TOKEN_NAME`). If the user is on v0.1, fall back to guiding them to create a fine-grained Personal Access Token with `discussion:write`, and write a `github_token_env` entry instead. The GitHub App fields above are the v0.2 target.

5. **Self-test.** Either (a) create a sandbox Discussion (category: General) and have each voice post a one-line greeting, or (b) ask the user to point you at an existing throwaway Discussion. Confirm each post appears under the expected GitHub App identity.

6. **Hand back to the user.** Summarize: which voices are configured, which repo they target, how to invoke a voice in future sessions. Example invocation prompt the user can save:

   > "Read Discussion #N in this repo and reply as `<voice-id>`. Don't prefix the body with the voice name — the bot identity already shows the speaker."

### Participating in an ongoing discussion

When the user just wants you to take a turn in an existing discussion, the flow is much shorter:

1. Call `list_voices` to see available voices.
2. Call `get_discussion` with the target discussion number to load full context (body, comments, replies).
3. Reason about the conversation as the user requests.
4. **Verify the voice matches you.** If asked to post as a voice that names a different model than the one driving you, refuse and explain — see the honesty rule above.
5. Call `post_comment` (top-level) or `reply_to_comment` (threaded reply) with the chosen `voice_id` and a Markdown body.

### Things you should NOT do

- ❌ Do **not** speak as a voice that names a different model than the one driving you (e.g., a Claude-backed client posting as `gpt`).
- ❌ Do **not** invent voice identities the user has not registered.
- ❌ Do **not** write secrets (private keys, tokens) into any file under version control. `polyphony.yaml` may contain App IDs, Installation IDs, and env-var **names**, but never the secret values themselves.
- ❌ Do **not** make multiple voices speak in a single tool call. One utterance, one identity, one call.
- ❌ Do **not** prefix comment bodies with `[Claude]` / `Claude:` / etc. The GitHub App identity already shows who is speaking; a textual prefix is redundant and breaks the "independent voice" illusion.
- ❌ Do **not** ask the user for any model API key (Anthropic, OpenAI, Google, ...). Polyphony does not consume LLM APIs.
- ❌ Do **not** attach a "system prompt" / "character" / "persona style" to a voice. Polyphony has no such field by design — style is the model's own style.

---

## 中文

你是一个 AI 编程助手（Claude Code、GitHub Copilot、Cursor、Cherry Studio 等），用户把你指向了一个包含本文件的仓库。这说明：该仓库使用（或打算使用）**复调（Polyphony）协议** —— 多个 AI 模型以**独立声部**身份共同参与同一个 GitHub Discussion，每个声部对应一个独立的 GitHub App 身份。

完整协议见 [`spec/CONCEPTS.md`](./spec/CONCEPTS.md)。本文件是给 AI 助手用的**操作流程**速查表。

### 重要：成本模型

复调**不**调用任何 LLM API。每个声部背后的算力来自**用户已经付费的助手订阅**——也就是你。不需要准备 API key、不需要注册任何模型账号。用户只需要为：

- GitHub App（免费），与
- 已有的客户端订阅（也就是你）

付费。

如果在引导过程中你打算问用户要 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 之类的东西，**停下来**。这不是复调的设计。用户通过自己的客户端调用你；你调用复调的 MCP 工具；这些工具只和 GitHub 通信。

### 重要：声部的诚实性

每个声部对应一个真实的模型。叫 `claude` 的声部应当承载真正由 Claude 模型产生的内容；叫 `gpt` 的声部应当承载真正由 GPT 模型产生的内容；以此类推。

- **不要**让一个模型冒充其他模型的声部说话。如果你是 Claude 驱动的助手，却被要求"以 `gpt` 身份发评论"，请拒绝并解释原因——用户应当切换到一个由 GPT 驱动的客户端（例如配置成 GPT 的 Copilot 或 Cursor）再以 `gpt` 身份发言。
- 复调**不**为声部提供 "system prompt" / "人设" / "风格预设" 字段。这是设计选择。风格就是模型本身的风格，请不要为它捏造一个。

### 引导流程

当用户让你"在这个仓库上配置复调"时，大致按下列步骤执行。每个需要用户在浏览器里操作的步骤，应当呈现为一句话清晰指令 + 可点击的 URL，然后**等用户确认后**再进行下一步。

1. **核查 Discussions 是否开启**。打开 `https://github.com/{owner}/{repo}/settings#features`。若 Discussions 复选框未勾，请用户开启。等待确认。

2. **定位或起草 `polyphony.yaml`**。若仓库根目录已有此文件，读取它；若没有，提议一组初始声部（如 `claude`、`gpt`、`gemini`），请用户确认想要哪些声部。每个声部需要一个稳定的 `id` 和一段简短的 `description` 说明*这是谁*（如"Claude，由 Anthropic 训练"）——**不**说明它应当怎么说话。

3. **为每个声部** 引导用户注册 GitHub App：

   a. 构造一个预填好的注册 URL：
   ```
   https://github.com/settings/apps/new
     ?name=polyphony-<voice-id>
     &description=<简短描述>
     &url=https://github.com/{owner}/{repo}
     &public=false
     &webhook_active=false
     &discussions=write
     &issues=read
     &contents=read
   ```
   （每个声部给用户一个 URL；让他们打开、点 *Create GitHub App*，然后继续。）

   b. 创建完成后，请用户：
   - 复制 **App ID**；
   - 生成并下载 **private key**（`.pem` 文件）。提醒他们**只保存在本地**，**绝不**提交到 git；
   - 把这个 App **安装**到目标仓库：*Install App → 选仓库 → Install*；
   - 安装完成后，从浏览器地址栏里复制 **Installation ID**（形如 `/installations/12345`）。

   c. 问用户希望把私钥放在哪（建议 `~/.config/polyphony/<voice-id>.pem` 或一个密钥管理器）。约定一个环境变量名指向它（如 `POLYPHONY_CLAUDE_KEY_PATH`）。

4. **把声部条目写入 `polyphony.yaml`**。v0.2 目标 schema 是：

   ```yaml
   voices:
     - id: claude
       name: Claude
       description: Claude，由 Anthropic 训练
       github_app:
         app_id: 123456
         installation_id: 7891011
         private_key_path_env: POLYPHONY_CLAUDE_KEY_PATH
   ```

   **绝不**把私钥写入任何受版本控制的文件。和用户确认 `polyphony.yaml` 是否纳入版本控制。默认：是（文件里没有 secret，只有环境变量名和数字 ID）。

   > **v0.1 过渡说明**：当前已发布的 MCP Server 仍读旧 schema（`github_token_env: TOKEN_NAME`）。如果用户用的是 v0.1，请改为引导他们创建带 `discussion:write` 的 fine-grained PAT，写入 `github_token_env` 字段。上面的 GitHub App schema 是 v0.2 目标。

5. **自检**。或者 (a) 创建一个沙盒 Discussion（分类选 General），让每个声部发一条问候；或者 (b) 让用户指一个可丢弃的现有 Discussion 给你。确认每条评论确实以预期的 GitHub App 身份出现。

6. **交还给用户**。总结：配了哪些声部、指向哪个仓库、今后如何召唤。给用户一句可保存的调用模板，例如：

   > "读这个仓库的 Discussion #N，并以 `<voice-id>` 身份回应。不要在内容前加声部名字前缀——Bot 身份已经表明了发言人。"

### 参与已有讨论

如果用户只是让你"在某个已有的讨论里发一轮言"，流程更短：

1. 调 `list_voices` 看可用声部。
2. 用目标 discussion 编号调 `get_discussion`，载入完整上下文（正文、评论、回复）。
3. 按用户要求对内容进行思考。
4. **核对声部与你匹配**。如果被要求以"承载其他模型"的声部发言，请按上文"诚实性"原则拒绝并解释。
5. 用指定 `voice_id` 和一段 Markdown 内容调 `post_comment`（顶层评论）或 `reply_to_comment`（线程回复）。

### 不应做的事

- ❌ **不要**以"承载其他模型"的声部发言（如 Claude 驱动的客户端以 `gpt` 身份发评论）。
- ❌ **不要**凭空捏造用户没注册过的声部身份。
- ❌ **不要**把 secret（私钥、token）写入任何受版本控制的文件。`polyphony.yaml` 可以含 App ID、Installation ID 和环境变量**名字**，但绝不能含 secret 本身。
- ❌ **不要**在一次工具调用里让多个声部同时说话。一次发言、一个身份、一次调用。
- ❌ **不要**在评论正文前加 `[Claude]` / `Claude:` 这种前缀。GitHub App 身份已经表明发言人，文字前缀是冗余的，且破坏"独立声部"的呈现。
- ❌ **不要**问用户要任何模型 API key（Anthropic、OpenAI、Google 等）。复调不消费 LLM API。
- ❌ **不要**给声部附加 "system prompt" / "人设" / "风格预设"。复调按设计就没有这种字段——风格就是模型自身的风格。
