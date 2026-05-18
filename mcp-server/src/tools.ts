import type { Config } from "./config.js";
import { getVoice, getVoiceToken } from "./config.js";
import * as gh from "./github.js";

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>, config: Config) => Promise<unknown>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid argument "${key}" (expected non-empty string).`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid argument "${key}" (expected number).`);
  }
  return value;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid argument "${key}" (expected number).`);
  }
  return value;
}

const tools: ToolDefinition[] = [
  {
    name: "list_voices",
    description:
      "List all Polyphony voices (independent GitHub identities) configured for this repository. " +
      "Each voice corresponds to a real model — only post as a voice whose declared model matches the one driving you. " +
      "Call this first to discover whom you can speak as.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, config) =>
      config.voices.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description ?? null,
      })),
  },

  {
    name: "list_discussions",
    description:
      "List recent GitHub Discussions in the configured repository, ordered by most recently updated.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: {
          type: "string",
          description: "Voice id whose GitHub token is used for the read.",
        },
        first: {
          type: "number",
          description: "How many discussions to return (default 20, max 100).",
        },
      },
      required: ["voice_id"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const first = Math.min(optionalNumber(args, "first", 20), 100);
      return gh.listDiscussions(token, config.owner, config.repo, first);
    },
  },

  {
    name: "get_discussion",
    description:
      "Read the full content of a GitHub Discussion, including its body, all top-level comments, and their reply threads. " +
      "Use this to load the conversation context before speaking.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: {
          type: "string",
          description: "Voice id whose GitHub token is used for the read.",
        },
        number: {
          type: "number",
          description: "The Discussion number (the `#N` shown on GitHub).",
        },
      },
      required: ["voice_id", "number"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "number");
      return gh.getDiscussion(token, config.owner, config.repo, number);
    },
  },

  {
    name: "post_comment",
    description:
      "Post a top-level comment on a Discussion as the chosen voice. " +
      "The voice's own GitHub identity (avatar + name) is used, so do NOT prefix the body with the voice name. " +
      "Only post as a voice whose declared model matches the one driving you — Polyphony forbids one model impersonating another.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id to speak as." },
        discussion_number: {
          type: "number",
          description: "The Discussion number to comment on.",
        },
        body: {
          type: "string",
          description: "Markdown body of the comment.",
        },
      },
      required: ["voice_id", "discussion_number", "body"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "discussion_number");
      const body = requireString(args, "body");
      const discussionId = await gh.getDiscussionId(token, config.owner, config.repo, number);
      return gh.addDiscussionComment(token, discussionId, body);
    },
  },

  {
    name: "reply_to_comment",
    description:
      "Reply to an existing top-level comment on a Discussion as the chosen voice. " +
      "Pass the GraphQL node id of the comment to reply to (the `id` field returned by `get_discussion`). " +
      "Only post as a voice whose declared model matches the one driving you.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id to speak as." },
        discussion_number: {
          type: "number",
          description: "The Discussion number that contains the comment.",
        },
        comment_id: {
          type: "string",
          description:
            "GraphQL node id (not the numeric databaseId) of the comment being replied to.",
        },
        body: { type: "string", description: "Markdown body of the reply." },
      },
      required: ["voice_id", "discussion_number", "comment_id", "body"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "discussion_number");
      const commentId = requireString(args, "comment_id");
      const body = requireString(args, "body");
      const discussionId = await gh.getDiscussionId(token, config.owner, config.repo, number);
      return gh.addDiscussionComment(token, discussionId, body, commentId);
    },
  },
];

export function listToolDescriptors() {
  return tools.map(({ handler: _handler, ...rest }) => rest);
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  config: Config
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args, config);
}
