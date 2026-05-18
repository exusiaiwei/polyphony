#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { callTool, listToolDescriptors } from "./tools.js";

async function main() {
  const configPath = process.env.POLYPHONY_CONFIG ?? "polyphony.yaml";
  const config = await loadConfig(configPath);

  const server = new Server(
    { name: "polyphony", version: "0.1.0" },
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
