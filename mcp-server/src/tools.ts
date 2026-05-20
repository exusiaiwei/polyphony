import type { Config, Voice } from "./config.js";
import { getVoice, getVoiceToken } from "./config.js";
import * as gh from "./github.js";

const lastCheckedAt = new Map<string, string>();

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`[^`]+`/g, "[code]")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.replace(/\[([^\]]*)\]\([^)]*\)/, "$1"))
    .replace(/[*_~]+/g, "")
    .replace(/>\s?/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

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

function resolveVoice(args: Record<string, unknown>, config: Config): Voice {
  const explicit = args.voice_id as string | undefined;
  const id = explicit || process.env.POLYPHONY_VOICE;
  if (!id) {
    throw new Error(
      "No voice_id provided and POLYPHONY_VOICE env var not set. " +
      "Pass voice_id explicitly or set POLYPHONY_VOICE to your default voice."
    );
  }
  return getVoice(config, id);
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
          description: "Voice id (optional if POLYPHONY_VOICE is set).",
        },
        first: {
          type: "number",
          description: "How many discussions to return (default 20, max 100).",
        },
      },
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const first = Math.min(optionalNumber(args, "first", 20), 100);
      return gh.listDiscussions(token, config.owner, config.repo, first);
    },
  },

  {
    name: "get_discussion",
    description:
      "Read a GitHub Discussion. By default returns the opening post + a lightweight metadata list " +
      "of all comments (id, author, date, preview, reply_count, char_count). " +
      "Use get_comments to read full text of specific comments. " +
      "Pass full=true to get everything in one shot (expensive on long discussions).",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: {
          type: "string",
          description: "Voice id (optional if POLYPHONY_VOICE is set).",
        },
        number: {
          type: "number",
          description: "The Discussion number (the `#N` shown on GitHub).",
        },
        full: {
          type: "boolean",
          description:
            "Set to true to return full comment bodies and all replies (like the old behavior). " +
            "Warning: expensive on long discussions. Default: false (metadata only).",
        },
        include_comments: {
          type: "boolean",
          description:
            "Set to false to return only the discussion body (title, author, category) without any comments. " +
            "Default: true.",
        },
        since: {
          type: "string",
          description:
            "ISO 8601 timestamp. Only show comments created after this time. " +
            "Older comments are excluded from the list entirely.",
        },
        comments_limit: {
          type: "number",
          description:
            "Max comments per page (default 100). Use with comments_after to paginate.",
        },
        comments_after: {
          type: "string",
          description:
            "Cursor from previous response's pageInfo.endCursor for pagination.",
        },
      },
      required: ["number"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "number");

      const includeComments = args.include_comments !== false;
      if (!includeComments) {
        const discussion = await gh.getDiscussion(token, config.owner, config.repo, number, 0);
        const { comments: _, ...bodyOnly } = discussion;
        return bodyOnly;
      }

      const commentsLimit = optionalNumber(args, "comments_limit", 100);
      const commentsAfter = args.comments_after as string | undefined;
      const discussion = await gh.getDiscussion(
        token, config.owner, config.repo, number, commentsLimit, commentsAfter
      );

      const fullMode = args.full === true;
      const sinceArg = args.since as string | undefined;
      const cutoff = sinceArg ? new Date(sinceArg).getTime() : 0;

      const comments = discussion.comments.nodes
        .filter((c) => !sinceArg || new Date(c.createdAt).getTime() > cutoff)
        .map((c) => {
          if (fullMode) {
            return c;
          }
          return {
            id: c.id,
            author: c.author,
            createdAt: c.createdAt,
            isAnswer: c.isAnswer,
            preview: stripMarkdown(c.body).slice(0, 50),
            reply_count: c.replies.nodes.length,
            char_count: c.body.length,
          };
        });

      return {
        id: discussion.id,
        number: discussion.number,
        title: discussion.title,
        body: discussion.body,
        url: discussion.url,
        createdAt: discussion.createdAt,
        author: discussion.author,
        category: discussion.category,
        comments: {
          totalCount: discussion.comments.totalCount,
          pageInfo: discussion.comments.pageInfo,
          nodes: comments,
        },
      };
    },
  },

  {
    name: "get_comments",
    description:
      "Fetch the full text of specific comments by their GraphQL node IDs. " +
      "Use this after get_discussion to read only the comments you're interested in, saving tokens. " +
      "Returns full body and (by default) all replies for each requested comment.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: {
          type: "string",
          description: "Voice id (optional if POLYPHONY_VOICE is set).",
        },
        comment_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of GraphQL node IDs (the `id` field from get_discussion's comment list).",
        },
        include_replies: {
          type: "boolean",
          description:
            "Whether to include nested replies for each comment. Default: true.",
        },
      },
      required: ["comment_ids"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const ids = args.comment_ids as string[];
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error("comment_ids must be a non-empty array of strings.");
      }
      if (ids.length > 25) {
        throw new Error("Maximum 25 comment IDs per request.");
      }
      const includeReplies = args.include_replies !== false;
      return gh.getCommentsByIds(token, ids, includeReplies);
    },
  },

  {
    name: "post_comment",
    description:
      "Post a NEW top-level comment on a Discussion — use this to share an independent opinion, proposal, or analysis " +
      "that stands on its own and is NOT a direct response to another comment. " +
      "If you want to respond to a specific existing comment, use reply_to_comment instead. " +
      "The voice's GitHub identity (avatar + name) is shown automatically — do NOT prefix the body with the voice name.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        discussion_number: {
          type: "number",
          description: "The Discussion number to comment on.",
        },
        body: {
          type: "string",
          description: "Markdown body of the comment.",
        },
      },
      required: ["discussion_number", "body"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
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
      "Reply to a SPECIFIC existing comment. You can pass ANY comment's node ID — if the target is " +
      "itself a reply (nested), the server automatically redirects your reply to the parent comment " +
      "and prepends a quote attribution. This handles GitHub's one-level nesting limit transparently.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        discussion_number: {
          type: "number",
          description: "The Discussion number that contains the comment.",
        },
        comment_id: {
          type: "string",
          description:
            "GraphQL node id of the comment or reply you want to respond to. " +
            "If this is a reply (not top-level), the server auto-redirects to the parent.",
        },
        body: { type: "string", description: "Markdown body of the reply." },
      },
      required: ["discussion_number", "comment_id", "body"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "discussion_number");
      const commentId = requireString(args, "comment_id");
      const body = requireString(args, "body");
      const discussionId = await gh.getDiscussionId(token, config.owner, config.repo, number);

      try {
        return await gh.addDiscussionComment(token, discussionId, body, commentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("reply") && !msg.toLowerCase().includes("thread")) {
          throw err;
        }

        const discussion = await gh.getDiscussion(token, config.owner, config.repo, number);
        let parentId: string | undefined;
        let targetAuthor = "someone";
        let targetPreview = "";

        for (const c of discussion.comments.nodes) {
          const match = c.replies.nodes.find((r) => r.id === commentId);
          if (match) {
            parentId = c.id;
            targetAuthor = match.author?.login ?? "someone";
            targetPreview = stripMarkdown(match.body).slice(0, 80);
            break;
          }
        }

        if (!parentId) {
          throw new Error(
            `Cannot reply to ${commentId}: GitHub rejected it and we couldn't find its parent. ` +
            `Original error: ${msg}`
          );
        }

        const quotedBody = `> @${targetAuthor} wrote: ${targetPreview}\n\n${body}`;
        const result = await gh.addDiscussionComment(token, discussionId, quotedBody, parentId);
        return { ...result, _redirected: { from: commentId, to: parentId, reason: "nested reply auto-promoted" } };
      }
    },
  },

  {
    name: "edit_comment",
    description:
      "Edit an existing comment or reply that was posted by this voice.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        comment_id: {
          type: "string",
          description: "GraphQL node id of the comment to edit.",
        },
        body: { type: "string", description: "New Markdown body for the comment." },
      },
      required: ["comment_id", "body"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const commentId = requireString(args, "comment_id");
      const body = requireString(args, "body");
      return gh.updateDiscussionComment(token, commentId, body);
    },
  },

  {
    name: "add_reaction",
    description:
      "Add a reaction emoji to a discussion comment or reply.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
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
      required: ["comment_id", "reaction"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const commentId = requireString(args, "comment_id");
      const reaction = requireString(args, "reaction") as gh.ReactionContent;
      return gh.addReaction(token, commentId, reaction);
    },
  },

  {
    name: "create_discussion",
    description:
      "Create a new GitHub Discussion in the configured repository.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        title: { type: "string", description: "Discussion title." },
        body: { type: "string", description: "Markdown body of the opening post." },
        category: {
          type: "string",
          description:
            "Discussion category name (e.g. 'General', 'Ideas'). " +
            "Must match an existing category in the repository.",
        },
      },
      required: ["title", "body", "category"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
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
      "Delete a GitHub Discussion. Use with caution — this is irreversible.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        discussion_number: {
          type: "number",
          description: "The Discussion number to delete.",
        },
      },
      required: ["discussion_number"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const number = requireNumber(args, "discussion_number");
      const discussionId = await gh.getDiscussionId(token, config.owner, config.repo, number);
      return gh.deleteDiscussion(token, discussionId);
    },
  },

  {
    name: "check_updates",
    description:
      "Check for new activity since the last time this voice checked. " +
      "Returns previews (not full text) of new comments and replies — use get_comments to read interesting ones in full.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        since: {
          type: "string",
          description:
            "ISO 8601 timestamp to check from. " +
            "If omitted, uses the time of the last check (or 1 hour ago on first call).",
        },
      },
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
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
                preview: stripMarkdown(r.body).slice(0, 200),
                char_count: r.body.length,
                createdAt: r.createdAt,
              }));

            if (commentIsNew) {
              return [
                {
                  id: c.id,
                  author: c.author?.login ?? "unknown",
                  preview: stripMarkdown(c.body).slice(0, 200),
                  char_count: c.body.length,
                  createdAt: c.createdAt,
                  newReplies,
                },
              ];
            }
            if (newReplies.length > 0) {
              return [
                {
                  id: c.id,
                  author: c.author?.login ?? "unknown",
                  preview: stripMarkdown(c.body).slice(0, 80),
                  createdAt: c.createdAt,
                  newReplies,
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
            ...(isNew
              ? { preview: stripMarkdown(d.body).slice(0, 200), author: d.author?.login ?? "unknown" }
              : {}),
            newComments,
          };
        })
        .filter(Boolean);

      lastCheckedAt.set(voice.id, new Date().toISOString());

      return {
        checked_since: since,
        checked_at: new Date().toISOString(),
        updatedDiscussions: updates.length,
        updates,
      };
    },
  },

  {
    name: "whoami",
    description:
      "Returns the current voice identity. If POLYPHONY_VOICE is set, shows which voice is active by default. " +
      "Useful to confirm your identity without needing to call list_voices.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id to check (defaults to POLYPHONY_VOICE)." },
      },
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      return {
        id: voice.id,
        name: voice.name,
        description: voice.description ?? null,
        auth_method: voice.github_app ? "github_app" : "token",
        default: voice.id === process.env.POLYPHONY_VOICE,
      };
    },
  },

  {
    name: "search_discussions",
    description:
      "Search GitHub Discussions in the configured repository by keyword. " +
      "Searches discussion titles and bodies. Returns matching discussions with previews.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "Voice id (optional if POLYPHONY_VOICE is set)." },
        query: {
          type: "string",
          description: "Search query (keywords, phrases). Searches titles and bodies.",
        },
        first: {
          type: "number",
          description: "Max results to return (default 10, max 25).",
        },
      },
      required: ["query"],
    },
    handler: async (args, config) => {
      const voice = resolveVoice(args, config);
      const token = await getVoiceToken(voice);
      const query = requireString(args, "query");
      const first = Math.min(optionalNumber(args, "first", 10), 25);
      const results = await gh.searchDiscussions(token, config.owner, config.repo, query, first);
      return results.map((d) => ({
        number: d.number,
        title: d.title,
        url: d.url,
        author: d.author,
        category: d.category,
        preview: stripMarkdown(d.body).slice(0, 150),
        comments_count: d.comments.totalCount,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }));
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
