# 版本号策略

本项目遵循[语义化版本 SemVer](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。

> 这是一个本地自部署的 Web 应用（git clone → npm install → npm start），不是发布到 npm 的包。版本号用于：标记发布节点、配合 git tag 形成可追溯的版本历史、帮助用户判断升级影响。

## 1. 版本号递增规则

| 位 | 何时递增 | 典型来源 |
|----|---------|---------|
| PATCH `x.y.Z` | 向后兼容的 bug 修复、小调整 | `fix:` `perf:` `style:` |
| MINOR `x.Y.0` | 向后兼容的新功能 | `feat:` |
| MAJOR `X.0.0` | 破坏性变更（见第 2 节） | `feat!:` `fix!:` 或 `BREAKING CHANGE` |

`docs:` `refactor:` `test:` `chore:` 等不改变用户可见行为的提交通常不触发发版；若含用户可感知的变更，按实际影响归入 PATCH 或 MINOR。

## 2. 什么是「破坏性变更」（MAJOR）

判定原则：**用户 `git pull && npm install && npm start` 后能否无感升级**。能 → 非 MAJOR；不能 → MAJOR。具体情形：

- **数据库无法自动迁移**：schema 变更需要用户手动干预才能启动（当前 `src/db.js` 的幂等启动迁移会自动消化绝大多数 schema 变更，这类**自动迁移属 MINOR，不属 MAJOR**）
- **运行环境要求提升**：`engines.node` 最低版本上调
- **配置不兼容**：`.env` / 配置项改名或删除且不兼容旧值
- **默认行为显著改变**：影响已有数据或既有工作流

MAJOR 必须在 CHANGELOG 单列 `### 破坏性变更` 并写明升级步骤。

## 3. Commit 规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增 DeepSeek 服务商          → MINOR
fix(db): 过滤作者省略标记            → PATCH
feat(reader)!: 改变默认导出格式      → MAJOR（! 表示 breaking）
```

## 4. CHANGELOG

- 文件：`CHANGELOG.md`，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格
- 顶部常驻 `## [Unreleased]`，未发版变更先写这里
- 发版时把 `[Unreleased]` 移到新的 `## [X.Y.Z] - YYYY-MM-DD`
- 分类：`### 新增` / `### 变更` / `### 修复` / `### 破坏性变更`

## 5. Git Tag

- 格式 `vX.Y.Z`（如 `v1.1.0`），使用附注标签（annotated tag）
- 命令：`git tag -a v1.1.0 -m "Release v1.1.0"`

## 6. 发版 Checklist

1. 查看自上个 tag 以来的提交，确定 bump 类型（PATCH/MINOR/MAJOR）
2. 更新 `package.json` 的 `version`
3. 更新 `CHANGELOG.md`：把 `[Unreleased]` 内容移到新版本段并补日期；重开空的 `[Unreleased]`
4. 提交：`git commit -am "chore(release): vX.Y.Z"`
5. 打 tag：`git tag -a vX.Y.Z -m "Release vX.Y.Z"`
6. 推送：`git push && git push --tags`
7. （可选）在 GitHub 创建 Release，描述引用 CHANGELOG 对应段

## 7. 升级方式（写给用户）

```bash
git pull
npm install      # 更新依赖
npm start        # 首次启动会自动执行数据库幂等迁移
```

破坏性变更（MAJOR）会在 CHANGELOG 的 `### 破坏性变更` 注明额外步骤。
