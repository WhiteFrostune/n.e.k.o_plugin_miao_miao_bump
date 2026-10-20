# 喵喵碰碰大作战 · 插件设计简报

## Identity Lock

- plugin_id：`miao_miao_bump`
- folder：`plugin/plugins/miao_miao_bump/`
- name：喵喵碰碰大作战
- entry：`plugin.plugins.miao_miao_bump:MiaoMiaoBumpPlugin`
- main class：`MiaoMiaoBumpPlugin`
- GitHub repository：`WhiteFrostune/n.e.k.o_plugin_miao_miao_bump`
- author：`WhiteFrostune`

## Purpose

提供猫娘泳圈物理弹射游戏，先验证连续碰撞、水阻和自然停稳的手感，再拓展角色技能与回合对战。

## Package Type and Capabilities

- 类型：独立 `plugin`。
- 当前状态：`0.1.0.dev0` 规划与骨架，无可玩界面。
- 0.1.0 目标：浏览器碰撞练习场、手感调试与必要的插件生命周期。
- 架构：游戏与物理循环在浏览器执行；Python 仅承担必要的公开 SDK 接入。

## First Version Scope

矩形水池、三个占位泳圈、拖拽发射、圆形刚体碰撞、池壁反弹、水阻、停稳、重置、固定测试布局和调参区。细节见 [0.1.0 规划](docs/ROADMAP_0.1.0.md)。

## Out of Scope

正式精灵动画、攻击血量、角色技能、电脑对战、联网、长期存档及模型调用。

## Inferred Technical Needs

- 当前 manifest：作者、SDK 兼容范围、国际化和手动启动设置。
- 后续界面：Static UI 加载 Canvas、Matter.js 和插件本地资源；原因是独立游戏引擎脚本与渲染循环需要。
- 当前仅保留异步生命周期，无模块导入副作用，无运行时工具入口或额外权限。
- 调试参数先存在页面内，不接外部服务，不要求凭据。

## Read Context Plan

依据仓库 neko-plugin 技能、公开 SDK、插件 CLI、UI 规范和对应检查工具实施。

## Write Workspace

`plugin/plugins/miao_miao_bump/`。不修改宿主平台代码。该目录作为独立 Git 仓库管理。

## Risk Follow-ups

当前无未决外部依赖或账号需求。GitHub 操作仅使用用户本机 Git/GitHub CLI 现有登录，不连接 Codex 的 GitHub 账号服务。
