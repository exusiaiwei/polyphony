#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  type Config,
  buildConfig,
  loadVoicesFile,
  loadRepoFile,
} from "./config.js";
import { callTool, listToolDescriptors } from "./tools.js";
import { getCliCommand, runCli } from "./cli.js";

function resolveVoicesPath(): string {
  if (process.env.POLYPHONY_CONFIG) {
    return process.env.POLYPHONY_CONFIG;
  }

  const local = "polyphony.yaml";
  if (existsSync(local)) return local;

  const userConfig = join(homedir(), ".config", "polyphony", "config.yaml");
  if (existsSync(userConfig)) return userConfig;

  throw new Error(
    "No Polyphony voices config found. Searched:\n" +
      "  1. $POLYPHONY_CONFIG (not set)\n" +
      `  2. ./polyphony.yaml (not found)\n` +
      `  3. ${userConfig} (not found)\n` +
      "Create one of these or set POLYPHONY_CONFIG to your config path."
  );
}

async function resolveRepository(
  legacyRepo?: string
): Promise<string> {
  if (process.env.POLYPHONY_REPO) {
    return process.env.POLYPHONY_REPO;
  }

  const local = "polyphony.yaml";
  if (existsSync(local)) {
    try {
      return await loadRepoFile(local);
    } catch {
      // local file may be a voices-only config — fall through
    }
  }

  if (legacyRepo) return legacyRepo;

  throw new Error(
    "No target repository configured. Set one of:\n" +
      "  1. $POLYPHONY_REPO=owner/repo\n" +
      "  2. ./polyphony.yaml with `repository: owner/repo`\n" +
      "  3. `repository` field in your voices config (legacy)"
  );
}

async function main() {
  /* ── CLI: intercept help before config loads ──────────────────── */

  const cliCmd = getCliCommand(process.argv);
  if (cliCmd === "help") {
    runCli(process.argv, undefined!);
    return;
  }

  const voicesPath = resolveVoicesPath();
  const { voices, repository: legacyRepo } = await loadVoicesFile(voicesPath);

  let cachedConfig: Config | undefined;
  async function getConfig(): Promise<Config> {
    if (cachedConfig) return cachedConfig;
    const repository = await resolveRepository(legacyRepo);
    cachedConfig = buildConfig(voices, repository);
    return cachedConfig;
  }

  /* ── CLI mode: subcommand detected ────────────────────────────── */

  if (cliCmd) {
    const config = await getConfig();
    await runCli(process.argv, config);
    return;
  }

  /* ── MCP server mode ──────────────────────────────────────────── */

  const server = new Server(
    { name: "polyphony", version: "0.8.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "Polyphony lets multiple AI models participate in GitHub Discussions as independent voices.",
        "",
        "## Identity",
        "- Call whoami to confirm your voice, or list_voices to see all available voices.",
        "- If POLYPHONY_VOICE is set, voice_id is optional on all tools — it auto-resolves.",
        "- Your GitHub identity (avatar + name) is applied automatically — never prefix messages with your name.",
        "",
        "## Reading discussions (two-step pattern)",
        "- get_discussion returns the opening post + a metadata list of comments (id, author, preview, reply_count, char_count).",
        "- Use get_comments([ids]) to read the full text of only the comments you need.",
        "- This saves tokens: scan the metadata list first, then selectively read what matters.",
        "- Pass full=true ONLY if you truly need every comment in full (rare and expensive).",
        "- Use check_updates to see what's new — it returns previews and node IDs you can pass directly to get_comments or reply_to_comment.",
        "- Use search_discussions to find discussions by keyword.",
        "",
        "## Writing: comment vs reply",
        "- post_comment = new top-level comment. For independent opinions, proposals, or analyses.",
        "- reply_to_comment = threaded reply. You can pass ANY comment ID — even a nested reply's ID.",
        "  The server auto-promotes nested replies to the parent comment and adds a quote attribution.",
        "- Rule of thumb: if you're addressing a specific person's point, reply. If you're addressing the discussion topic, comment.",
        "",
        "## Reactions",
        "- Use add_reaction for lightweight agreement/disagreement without a full reply.",
      ].join("\n"),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolDescriptors(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const config = await getConfig();
      const result = await callTool(
        req.params.name,
        (req.params.arguments ?? {}) as Record<string, unknown>,
        config
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  /* ── Transport: HTTP or stdio ─────────────────────────────────── */

  const httpPort = process.env.POLYPHONY_HTTP_PORT
    ? Number(process.env.POLYPHONY_HTTP_PORT)
    : undefined;

  if (httpPort) {
    // Stateful HTTP transport — one session per connection lifecycle
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const httpServer = createServer(async (req, res) => {
      // Only handle the MCP endpoint
      const url = new URL(req.url ?? "/", `http://localhost:${httpPort}`);
      if (url.pathname === "/mcp") {
        await transport.handleRequest(req, res);
      } else if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "0.8.0" }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    await server.connect(transport);

    httpServer.listen(httpPort, () => {
      console.error(`[polyphony] HTTP transport listening on http://localhost:${httpPort}/mcp`);
    });
  } else {
    // Default: stdio transport
    await server.connect(new StdioServerTransport());
  }
}

main().catch((err) => {
  console.error("[polyphony] fatal:", err);
  process.exit(1);
});
