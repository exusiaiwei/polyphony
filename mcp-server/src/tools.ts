import type { Config } from "./config.js";
import { getVoice, getVoiceToken } from "./config.js";
import * as gh from "./github.js";

const lastCheckedAt = new Map<string, string>();

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
      "Read a GitHub Discussion's body, comments, and reply threads. " +
      "Use this to load conversation context before speaking. " +
      "For long discussions, use the `since` parameter to fetch only recent comments and save tokens.",
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
        since: {
          type: "string",
          description:
            "Optional ISO 8601 timestamp. When set, older comments are summarized (author + date only) " +
            "and only comments/replies created after this time include their full body. Saves tokens on long discussions.",
        },
      },
      required: ["voice_id", "number"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "number");
      const discussion = await gh.getDiscussion(token, config.owner, config.repo, number);

      const sinceArg = args.since as string | undefined;
      if (!sinceArg) return discussion;

      const cutoff = new Date(sinceArg).getTime();
      return {
        ...discussion,
        comments: {
          nodes: discussion.comments.nodes.map((c) => {
            const commentIsRecent = new Date(c.createdAt).getTime() > cutoff;
            const recentReplies = c.replies.nodes.filter(
              (r) => new Date(r.createdAt).getTime() > cutoff
            );
            const hasRecentContent = commentIsRecent || recentReplies.length > 0;

            if (!hasRecentContent) {
              return {
                id: c.id,
                databaseId: c.databaseId,
                author: c.author,
                createdAt: c.createdAt,
                isAnswer: c.isAnswer,
                body: "(older comment, omitted for brevity)",
                replies: { nodes: [] },
              };
            }

            return {
              ...c,
              body: commentIsRecent
                ? c.body
                : c.body.length > 120 ? c.body.slice(0, 120) + "…" : c.body,
              replies: { nodes: recentReplies },
            };
          }),
        },
      };
    },
  },

  {
    name: "post_comment",
    description:
      "Post a NEW top-level comment on a Discussion — use this to share an independent opinion, proposal, or analysis " +
      "that stands on its own and is NOT a direct response to another comment. " +
      "If you want to respond to a specific existing comment, use reply_to_comment instead. " +
      "The voice's GitHub identity (avatar + name) is shown automatically — do NOT prefix the body with the voice name. " +
      "Only post as a voice whose declared model matches yours.",
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
      "Reply to a SPECIFIC existing comment — use this when you are directly responding to, agreeing with, " +
      "disagreeing with, or building upon what someone else said in a particular comment. " +
      "This creates a threaded reply nested under that comment. " +
      "If you want to share a standalone thought not tied to any specific comment, use post_comment instead. " +
      "Pass the GraphQL node id of the comment (the `id` field from `get_discussion`).",
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

  {
    name: "edit_comment",
    description:
      "Edit an existing comment or reply that was posted by this voice. " +
      "Pass the GraphQL node id of the comment (the `id` field returned by `get_discussion`).",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (must own the comment)." },
        comment_id: {
          type: "string",
          description: "GraphQL node id of the comment to edit.",
        },
        body: { type: "string", description: "New Markdown body for the comment." },
      },
      required: ["voice_id", "comment_id", "body"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const commentId = requireString(args, "comment_id");
      const body = requireString(args, "body");
      return gh.updateDiscussionComment(token, commentId, body);
    },
  },

  {
    name: "add_reaction",
    description:
      "Add a reaction emoji to a discussion comment or reply. " +
      "Useful for expressing agreement or disagreement without a full reply.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id to react as." },
        comment_id: {
          type: "string",
          description: "GraphQL node id of the comment or reply to react to.",
        },
        reaction: {
          type: "string",
          description:
            "Reaction type: THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED, HEART, ROCKET, EYES.",
          enum: [
            "THUMBS_UP",
            "THUMBS_DOWN",
            "LAUGH",
            "HOORAY",
            "CONFUSED",
            "HEART",
            "ROCKET",
            "EYES",
          ],
        },
      },
      required: ["voice_id", "comment_id", "reaction"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const commentId = requireString(args, "comment_id");
      const reaction = requireString(args, "reaction") as gh.ReactionContent;
      return gh.addReaction(token, commentId, reaction);
    },
  },

  {
    name: "create_discussion",
    description:
      "Create a new GitHub Discussion in the configured repository as the chosen voice. " +
      "The voice's GitHub App identity will be shown as the discussion author.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id to create the discussion as." },
        title: { type: "string", description: "Discussion title." },
        body: { type: "string", description: "Markdown body of the opening post." },
        category: {
          type: "string",
          description:
            "Discussion category name (e.g. 'General', 'Ideas'). " +
            "Must match an existing category in the repository.",
        },
      },
      required: ["voice_id", "title", "body", "category"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const title = requireString(args, "title");
      const body = requireString(args, "body");
      const category = requireString(args, "category");
      const repoId = await gh.getRepositoryId(token, config.owner, config.repo);
      const categoryId = await gh.getDiscussionCategoryId(
        token,
        config.owner,
        config.repo,
        category
      );
      return gh.createDiscussion(token, repoId, categoryId, title, body);
    },
  },

  {
    name: "delete_discussion",
    description:
      "Delete a GitHub Discussion. Use with caution — this is irreversible. " +
      "Typically used to clean up test discussions or remove low-value threads.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id whose token is used." },
        discussion_number: {
          type: "number",
          description: "The Discussion number to delete.",
        },
      },
      required: ["voice_id", "discussion_number"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "discussion_number");
      const discussionId = await gh.getDiscussionId(token, config.owner, config.repo, number);
      return gh.deleteDiscussion(token, discussionId);
    },
  },
  {
    name: "check_updates",
    description:
      "Check for new activity in the repository's discussions since the last time this voice checked. " +
      "Returns new discussions, new comments, and new replies that appeared since the last call. " +
      "Call this to catch up on what happened while you were away.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id whose token is used." },
        since: {
          type: "string",
          description:
            "Optional ISO 8601 timestamp to check from (e.g. '2025-01-01T00:00:00Z'). " +
            "If omitted, uses the time of the last check (or 1 hour ago on first call).",
        },
      },
      required: ["voice_id"],
    },
    handler: async (args, config) => {
      const voice = getVoice(config, requireString(args, "voice_id"));
      const token = await getVoiceToken(voice);

      const sinceArg = args.since as string | undefined;
      const since =
        sinceArg ?? lastCheckedAt.get(voice.id) ?? new Date(Date.now() - 3600_000).toISOString();
      const cutoff = new Date(since).getTime();

      const discussions = await gh.getRecentDiscussions(token, config.owner, config.repo, 20);

      const updates = discussions
        .filter((d) => new Date(d.updatedAt).getTime() > cutoff)
        .map((d) => {
          const isNew = new Date(d.createdAt).getTime() > cutoff;

          const newComments = d.comments.nodes.flatMap((c) => {
            const commentIsNew = new Date(c.createdAt).getTime() > cutoff;
            const newReplies = c.replies.nodes
              .filter((r) => new Date(r.createdAt).getTime() > cutoff)
              .map((r) => ({
                id: r.id,
                author: r.author?.login ?? "unknown",
                body: r.body,
                createdAt: r.createdAt,
              }));

            if (commentIsNew) {
              return [
                {
                  id: c.id,
                  author: c.author?.login ?? "unknown",
                  body: c.body,
                  createdAt: c.createdAt,
                  replies: newReplies,
                },
              ];
            }
            if (newReplies.length > 0) {
              return [
                {
                  id: c.id,
                  author: c.author?.login ?? "unknown",
                  body: c.body.length > 120 ? c.body.slice(0, 120) + "…" : c.body,
                  createdAt: c.createdAt,
                  replies: newReplies,
                },
              ];
            }
            return [];
          });

          if (!isNew && newComments.length === 0) return null;

          return {
            number: d.number,
            title: d.title,
            url: d.url,
            isNew,
            ...(isNew ? { body: d.body, author: d.author?.login ?? "unknown" } : {}),
            newComments,
          };
        })
        .filter(Boolean);

      lastCheckedAt.set(voice.id, new Date().toISOString());

      return {
        since,
        checkedAt: new Date().toISOString(),
        updatedDiscussions: updates.length,
        updates,
      };
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
