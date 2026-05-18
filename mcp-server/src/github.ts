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
  replies: { nodes: CommentReply[] };
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
  comments: { nodes: Comment[] };
}

export async function getDiscussion(
  token: string,
  owner: string,
  repo: string,
  number: number
): Promise<Discussion> {
  const data = await client(token)<{ repository: { discussion: Discussion } }>(
    `query($owner:String!, $repo:String!, $number:Int!) {
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
          comments(first:100) {
            nodes {
              id
              databaseId
              body
              createdAt
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
    { owner, repo, number }
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
