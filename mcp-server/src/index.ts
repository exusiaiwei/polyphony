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
import { loadConfig } from "./config.js";
import { callTool, listToolDescriptors } from "./tools.js";

function resolveConfigPath(): string {
  if (process.env.POLYPHONY_CONFIG) {
    return process.env.POLYPHONY_CONFIG;
  }

  const local = "polyphony.yaml";
  if (existsSync(local)) return local;

  const userConfig = join(homedir(), ".config", "polyphony", "config.yaml");
  if (existsSync(userConfig)) return userConfig;

  throw new Error(
    "No Polyphony config found. Searched:\n" +
      "  1. $POLYPHONY_CONFIG (not set)\n" +
      `  2. ./polyphony.yaml (not found)\n` +
      `  3. ${userConfig} (not found)\n` +
      "Create one of these or set POLYPHONY_CONFIG to your config path."
  );
}

async function main() {
  const configPath = resolveConfigPath();
  const config = await loadConfig(configPath);

  const server = new Server(
    { name: "polyphony", version: "0.2.2" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolDescriptors(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
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
