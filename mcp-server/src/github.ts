import { graphql } from "@octokit/graphql";

function client(token: string) {
  return graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
}

export interface DiscussionSummary {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  author: { login: string } | null;
  category: { name: string } | null;
  comments: { totalCount: number };
}

export async function listDiscussions(
  token: string,
  owner: string,
  repo: string,
  first: number
): Promise<DiscussionSummary[]> {
  const data = await client(token)<{
    repository: { discussions: { nodes: DiscussionSummary[] } };
  }>(
    `query($owner:String!, $repo:String!, $first:Int!) {
      repository(owner:$owner, name:$repo) {
        discussions(first:$first, orderBy:{field:UPDATED_AT, direction:DESC}) {
          nodes {
            number
            title
            url
            updatedAt
            author { login }
            category { name }
            comments { totalCount }
          }
        }
      }
    }`,
    { owner, repo, first }
  );
  return data.repository.discussions.nodes;
}

export interface CommentReply {
  id: string;
  databaseId: number | null;
  body: string;
  createdAt: string;
  author: { login: string } | null;
}

export interface Comment extends CommentReply {
  isAnswer: boolean;
  replies: { nodes: CommentReply[] };
}

export interface CommentsPage {
  totalCount: number;
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
  nodes: Comment[];
}

export interface Discussion {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  author: { login: string } | null;
  category: { name: string } | null;
  comments: CommentsPage;
}

export async function getDiscussion(
  token: string,
  owner: string,
  repo: string,
  number: number,
  commentsFirst = 100,
  commentsAfter?: string
): Promise<Discussion> {
  const data = await client(token)<{ repository: { discussion: Discussion } }>(
    `query($owner:String!, $repo:String!, $number:Int!, $commentsFirst:Int!, $commentsAfter:String) {
      repository(owner:$owner, name:$repo) {
        discussion(number:$number) {
          id
          number
          title
          body
          url
          createdAt
          author { login }
          category { name }
          comments(first:$commentsFirst, after:$commentsAfter) {
            totalCount
            pageInfo { endCursor hasNextPage }
            nodes {
              id
              databaseId
              body
              createdAt
              isAnswer
              author { login }
              replies(first:50) {
                nodes {
                  id
                  databaseId
                  body
                  createdAt
                  author { login }
                }
              }
            }
          }
        }
      }
    }`,
    { owner, repo, number, commentsFirst, commentsAfter: commentsAfter ?? null }
  );
  return data.repository.discussion;
}

export async function getDiscussionId(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<string> {
  const data = await client(token)<{ repository: { discussion: { id: string } } }>(
    `query($owner:String!, $repo:String!, $number:Int!) {
      repository(owner:$owner, name:$repo) {
        discussion(number:$number) { id }
      }
    }`,
    { owner, repo, number }
  );
  return data.repository.discussion.id;
}

export interface PostedComment {
  id: string;
  url: string;
  body: string;
  createdAt: string;
  author: { login: string } | null;
}

export async function addDiscussionComment(
  token: string,
  discussionId: string,
  body: string,
  replyToId?: string
): Promise<PostedComment> {
  const data = await client(token)<{
    addDiscussionComment: { comment: PostedComment };
  }>(
    `mutation($discussionId:ID!, $body:String!, $replyToId:ID) {
      addDiscussionComment(input:{ discussionId:$discussionId, body:$body, replyToId:$replyToId }) {
        comment {
          id
          url
          body
          createdAt
          author { login }
        }
      }
    }`,
    { discussionId, body, replyToId: replyToId ?? null }
  );
  return data.addDiscussionComment.comment;
}

export async function updateDiscussionComment(
  token: string,
  commentId: string,
  body: string
): Promise<PostedComment> {
  const data = await client(token)<{
    updateDiscussionComment: { comment: PostedComment };
  }>(
    `mutation($commentId:ID!, $body:String!) {
      updateDiscussionComment(input:{ commentId:$commentId, body:$body }) {
        comment {
          id
          url
          body
          createdAt
          author { login }
        }
      }
    }`,
    { commentId, body }
  );
  return data.updateDiscussionComment.comment;
}

export type ReactionContent =
  | "THUMBS_UP"
  | "THUMBS_DOWN"
  | "LAUGH"
  | "HOORAY"
  | "CONFUSED"
  | "HEART"
  | "ROCKET"
  | "EYES";

export async function addReaction(
  token: string,
  subjectId: string,
  content: ReactionContent
): Promise<{ content: string; user: { login: string } | null }> {
  const data = await client(token)<{
    addReaction: { reaction: { content: string; user: { login: string } | null } };
  }>(
    `mutation($subjectId:ID!, $content:ReactionContent!) {
      addReaction(input:{ subjectId:$subjectId, content:$content }) {
        reaction {
          content
          user { login }
        }
      }
    }`,
    { subjectId, content }
  );
  return data.addReaction.reaction;
}

export async function getRepositoryId(
  token: string,
  owner: string,
  repo: string
): Promise<string> {
  const data = await client(token)<{ repository: { id: string } }>(
    `query($owner:String!, $repo:String!) {
      repository(owner:$owner, name:$repo) { id }
    }`,
    { owner, repo }
  );
  return data.repository.id;
}

export async function getDiscussionCategoryId(
  token: string,
  owner: string,
  repo: string,
  categoryName: string
): Promise<string> {
  const data = await client(token)<{
    repository: {
      discussionCategories: { nodes: { id: string; name: string }[] };
    };
  }>(
    `query($owner:String!, $repo:String!) {
      repository(owner:$owner, name:$repo) {
        discussionCategories(first:25) {
          nodes { id name }
        }
      }
    }`,
    { owner, repo }
  );
  const cat = data.repository.discussionCategories.nodes.find(
    (c) => c.name.toLowerCase() === categoryName.toLowerCase()
  );
  if (!cat) {
    const known = data.repository.discussionCategories.nodes
      .map((c) => c.name)
      .join(", ");
    throw new Error(
      `Discussion category "${categoryName}" not found. Available: ${known}`
    );
  }
  return cat.id;
}

export interface CreatedDiscussion {
  id: string;
  number: number;
  title: string;
  url: string;
}

export async function createDiscussion(
  token: string,
  repositoryId: string,
  categoryId: string,
  title: string,
  body: string
): Promise<CreatedDiscussion> {
  const data = await client(token)<{
    createDiscussion: { discussion: CreatedDiscussion };
  }>(
    `mutation($repositoryId:ID!, $categoryId:ID!, $title:String!, $body:String!) {
      createDiscussion(input:{ repositoryId:$repositoryId, categoryId:$categoryId, title:$title, body:$body }) {
        discussion {
          id
          number
          title
          url
        }
      }
    }`,
    { repositoryId, categoryId, title, body }
  );
  return data.createDiscussion.discussion;
}

export interface DiscussionWithComments {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  body: string;
  author: { login: string } | null;
  category: { name: string } | null;
  comments: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      author: { login: string } | null;
      replies: {
        nodes: Array<{
          id: string;
          body: string;
          createdAt: string;
          author: { login: string } | null;
        }>;
      };
    }>;
  };
}

export async function getRecentDiscussions(
  token: string,
  owner: string,
  repo: string,
  first: number
): Promise<DiscussionWithComments[]> {
  const data = await client(token)<{
    repository: { discussions: { nodes: DiscussionWithComments[] } };
  }>(
    `query($owner:String!, $repo:String!, $first:Int!) {
      repository(owner:$owner, name:$repo) {
        discussions(first:$first, orderBy:{field:UPDATED_AT, direction:DESC}) {
          nodes {
            number
            title
            url
            createdAt
            updatedAt
            body
            author { login }
            category { name }
            comments(first:100) {
              nodes {
                id
                body
                createdAt
                author { login }
                replies(first:50) {
                  nodes {
                    id
                    body
                    createdAt
                    author { login }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { owner, repo, first }
  );
  return data.repository.discussions.nodes;
}

export async function deleteDiscussion(
  token: string,
  discussionId: string
): Promise<{ id: string }> {
  const data = await client(token)<{
    deleteDiscussion: { discussion: { id: string } };
  }>(
    `mutation($id:ID!) {
      deleteDiscussion(input:{ id:$id }) {
        discussion { id }
      }
    }`,
    { id: discussionId }
  );
  return data.deleteDiscussion.discussion;
}
