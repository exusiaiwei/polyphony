import { readFile } from "node:fs/promises";
import type { Config } from "./config.js";
import { callTool } from "./tools.js";

interface SubcommandSpec {
  tool: string;
  usage: string;
  positional: { name: string; type: "string" | "number" }[];
  flags?: Record<string, { type: "boolean" | "string" | "number"; alias?: string }>;
  rest?: { name: string };
}

const subcommands: Record<string, SubcommandSpec> = {
  whoami: {
    tool: "whoami",
    usage: "whoami",
    positional: [],
  },
  "list-voices": {
    tool: "list_voices",
    usage: "list-voices",
    positional: [],
  },
  "list-discussions": {
    tool: "list_discussions",
    usage: "list-discussions [--first N]",
    positional: [],
    flags: { first: { type: "number" } },
  },
  "get-discussion": {
    tool: "get_discussion",
    usage: "get-discussion <number> [--full] [--since ISO]",
    positional: [{ name: "number", type: "number" }],
    flags: {
      full: { type: "boolean" },
      since: { type: "string" },
      "no-comments": { type: "boolean" },
    },
  },
  "get-comments": {
    tool: "get_comments",
    usage: "get-comments <id> [<id>...] [--no-replies]",
    positional: [],
    rest: { name: "comment_ids" },
    flags: { "no-replies": { type: "boolean" } },
  },
  "post-comment": {
    tool: "post_comment",
    usage: "post-comment <number> <body | - | @file>",
    positional: [
      { name: "discussion_number", type: "number" },
      { name: "body", type: "string" },
    ],
  },
  reply: {
    tool: "reply_to_comment",
    usage: "reply <number> <comment_id> <body | - | @file>",
    positional: [
      { name: "discussion_number", type: "number" },
      { name: "comment_id", type: "string" },
      { name: "body", type: "string" },
    ],
  },
  edit: {
    tool: "edit_comment",
    usage: "edit <comment_id> <body | - | @file>",
    positional: [
      { name: "comment_id", type: "string" },
      { name: "body", type: "string" },
    ],
  },
  react: {
    tool: "add_reaction",
    usage: "react <comment_id> <reaction>",
    positional: [
      { name: "comment_id", type: "string" },
      { name: "reaction", type: "string" },
    ],
  },
  "create-discussion": {
    tool: "create_discussion",
    usage: "create-discussion <title> <body | - | @file> <category>",
    positional: [
      { name: "title", type: "string" },
      { name: "body", type: "string" },
      { name: "category", type: "string" },
    ],
  },
  "delete-discussion": {
    tool: "delete_discussion",
    usage: "delete-discussion <number>",
    positional: [{ name: "discussion_number", type: "number" }],
  },
  "check-updates": {
    tool: "check_updates",
    usage: "check-updates [--since ISO]",
    positional: [],
    flags: { since: { type: "string" } },
  },
  search: {
    tool: "search_discussions",
    usage: "search <query> [--first N]",
    positional: [{ name: "query", type: "string" }],
    flags: { first: { type: "number" } },
  },
};

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8").trim()));
    process.stdin.on("error", reject);
  });
}

function printUsage(): void {
  console.error("Usage: polyphony [--voice <id>] <command> [args...]\n");
  console.error("Global options:");
  console.error("  --voice, -v <id>  Voice to act as (overrides POLYPHONY_VOICE)\n");
  console.error("Commands:");
  for (const [, spec] of Object.entries(subcommands)) {
    console.error(`  ${spec.usage}`);
  }
  console.error("\nRun without arguments to start as MCP server.");
  console.error("Body argument: inline text, '-' for stdin, or '@path' to read from file.");
}

const metaCommands = new Set(["help", "--help", "-h"]);

interface ParsedGlobals {
  voice?: string;
  command: string;
  commandArgs: string[];
}

function parseGlobals(argv: string[]): ParsedGlobals | undefined {
  const args = argv.slice(2);
  let voice: string | undefined;
  let i = 0;

  while (i < args.length) {
    if (args[i] === "--voice" || args[i] === "-v") {
      i++;
      voice = args[i];
      i++;
    } else {
      break;
    }
  }

  const command = args[i];
  if (!command) return undefined;

  return { voice, command, commandArgs: args.slice(i + 1) };
}

export function getCliCommand(argv: string[]): string | undefined {
  const parsed = parseGlobals(argv);
  if (!parsed) return undefined;
  const cmd = parsed.command;
  if (metaCommands.has(cmd)) return "help";
  return cmd in subcommands ? cmd : undefined;
}

export async function runCli(argv: string[], config: Config): Promise<void> {
  const parsed = parseGlobals(argv)!;
  const cmd = parsed.command;

  if (metaCommands.has(cmd)) {
    printUsage();
    process.exit(0);
  }

  if (parsed.voice) {
    process.env.POLYPHONY_VOICE = parsed.voice;
  }

  const spec = subcommands[cmd];
  if (!spec) {
    console.error(`Unknown command: ${cmd}`);
    printUsage();
    process.exit(1);
  }

  const rawArgs = parsed.commandArgs;
  const positionalValues: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const flagSpec = spec.flags?.[key];
      if (!flagSpec) {
        console.error(`Unknown flag: ${arg}`);
        process.exit(1);
      }
      if (flagSpec.type === "boolean") {
        flags[key] = true;
      } else {
        i++;
        if (i >= rawArgs.length) {
          console.error(`Flag ${arg} requires a value.`);
          process.exit(1);
        }
        flags[key] = rawArgs[i];
      }
    } else {
      positionalValues.push(arg);
    }
  }

  const toolArgs: Record<string, unknown> = {};

  if (spec.rest) {
    if (positionalValues.length === 0) {
      console.error(`Usage: polyphony ${spec.usage}`);
      process.exit(1);
    }
    toolArgs[spec.rest.name] = positionalValues;
  } else {
    for (let i = 0; i < spec.positional.length; i++) {
      const p = spec.positional[i];
      let value: string | undefined = positionalValues[i];

      if (value === undefined) {
        console.error(`Missing argument: ${p.name}\nUsage: polyphony ${spec.usage}`);
        process.exit(1);
      }

      if (p.name === "body") {
        if (value === "-") {
          value = await readStdin();
        } else if (value.startsWith("@")) {
          value = await readFile(value.slice(1), "utf-8");
        }
      }

      if (p.type === "number") {
        toolArgs[p.name] = Number(value);
      } else {
        toolArgs[p.name] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(flags)) {
    const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const flagSpec = spec.flags![key];
    if (key === "no-comments") {
      toolArgs["include_comments"] = false;
    } else if (key === "no-replies") {
      toolArgs["include_replies"] = false;
    } else if (flagSpec.type === "number") {
      toolArgs[camelKey] = Number(value);
    } else {
      toolArgs[camelKey] = value;
    }
  }

  try {
    const result = await callTool(spec.tool, toolArgs, config);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
