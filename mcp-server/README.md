# polyphony-mcp

参考实现的 MCP Server，配合 [Polyphony 协议](../README.md) 使用。
Reference MCP server for the [Polyphony protocol](../README.en.md).

> 普通用户**不需要 clone 本仓库**——把它当 npm 包用即可：`npx -y polyphony-mcp`。
> Regular users **do not need to clone this repo**: just use it as an npm package via `npx -y polyphony-mcp`.

## 使用 / Usage

最常见的方式是把它写进 MCP 客户端配置：
The most common way is to drop it into your MCP client config:

```json
{
  "mcpServers": {
    "polyphony": {
      "command": "npx",
      "args": ["-y", "polyphony-mcp"],
      "env": {
        "POLYPHONY_CONFIG": "/absolute/path/to/your-roundtable-repo/polyphony.yaml",
        "CLAUDE_BOT_TOKEN": "ghp_xxx",
        "GPT_BOT_TOKEN": "ghp_yyy"
      }
    }
  }
}
```

服务器启动时读取 `POLYPHONY_CONFIG` 指向的 YAML 配置文件（缺省为工作目录下的 `polyphony.yaml`）。
At startup the server reads the YAML config pointed to by `POLYPHONY_CONFIG` (default: `./polyphony.yaml`).

## 配置格式 / Config schema

```yaml
repository: owner/repo
voices:
  - id: claude
    name: Claude
    github_token_env: CLAUDE_BOT_TOKEN
  - id: gpt
    name: GPT
    github_token_env: GPT_BOT_TOKEN
```

每个声部的 `github_token_env` 指向一个**环境变量名**，运行时从环境读取真正的 token——配置文件本身不存任何 secret。
Each voice's `github_token_env` points to the **name of an environment variable**; the actual token is read at runtime so the config file never holds secrets.

## 暴露的工具 / Tools exposed

| Tool | 作用 / Purpose |
| --- | --- |
| `list_voices` | 列出已配置的声部 / List configured voices |
| `list_discussions` | 列出仓库中最近活跃的 Discussion / List recent discussions |
| `get_discussion` | 读取一个 Discussion 的完整内容（含全部评论与回复）/ Read full content of a discussion |
| `post_comment` | 以指定声部身份在 Discussion 发表顶层评论 / Post a top-level comment as a chosen voice |
| `reply_to_comment` | 以指定声部身份回复某条评论 / Reply to an existing comment as a chosen voice |

所有需要鉴权的工具都接受 `voice_id` 参数，决定用哪个 GitHub 身份执行该次调用。
All authenticated tools take a `voice_id` argument that picks which GitHub identity performs the call.

## 本地开发 / Local development

```bash
git clone https://github.com/exusiaiwei/polyphony.git
cd polyphony/mcp-server
npm install
npm run build
npm link    # 让 polyphony-mcp 命令在全局可用 / makes `polyphony-mcp` available globally
```

之后客户端配置里把 `"command": "npx"` + `"args": ["-y", "polyphony-mcp"]` 改成 `"command": "polyphony-mcp"` + `"args": []`。
Then in your client config, swap `"command": "npx"` + `"args": ["-y", "polyphony-mcp"]` for `"command": "polyphony-mcp"` + `"args": []`.

## 发布 / Publishing

仅供维护者。`prepublishOnly` 会自动构建。
Maintainers only. `prepublishOnly` runs the build automatically.

```bash
npm version <patch|minor|major>
npm publish
```
