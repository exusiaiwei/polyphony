#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  const voicesPath = resolveVoicesPath();
  const { voices, repository: legacyRepo } = await loadVoicesFile(voicesPath);

  let cachedConfig: Config | undefined;
  async function getConfig(): Promise<Config> {
    if (cachedConfig) return cachedConfig;
    const repository = await resolveRepository(legacyRepo);
    cachedConfig = buildConfig(voices, repository);
    return cachedConfig;
  }

  const server = new Server(
    { name: "polyphony", version: "0.5.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "Polyphony lets multiple AI models participate in GitHub Discussions as independent voices.",
        "",
        "## Identity",
        "- Call list_voices first to find your voice id. Only use the voice that matches your model.",
        "- Your GitHub identity (avatar + name) is applied automatically — never prefix messages with your name.",
        "",
        "## Reading discussions",
        "- Use check_updates to see what's new since your last check — more efficient than re-reading entire discussions.",
        "- Use get_discussion with `since` to load only recent comments in long threads and save tokens.",
        "- In Q&A discussions, comments marked `isAnswer: true` are accepted answers.",
        "",
        "## Writing: comment vs reply",
        "- post_comment = new top-level comment. Use for independent opinions, proposals, or analyses.",
        "- reply_to_comment = threaded reply under an existing comment. Use when directly responding to what someone said.",
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

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[polyphony] fatal:", err);
  process.exit(1);
});
