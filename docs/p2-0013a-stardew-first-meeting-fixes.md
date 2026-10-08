# P2-0013A：星露谷初见体验修复

## Outcome

在进入 P2-0014 前补齐 Mod 初见闭环：玩家先选择同伴，再使用星露谷原生捏脸界面定义同伴外观；外观能持久化并由原生农夫渲染器显示。晨间 DSH 提案在任意游戏菜单关闭后仍能可靠出现，并直接展示人格生成、带游戏地点名且不泄露工程坐标的自然话语。

## Non-goals

- 不增加任何修改金钱、物品、时间、关系或世界状态的作弊能力。
- `AllowCheatCapabilities` 只是一道默认关闭的未来能力闸门；打开它不会凭空增加本版本不存在的能力。
- 不修改 DSH 内核，不引入自制捏脸 UI 或自制人物美术。
- 不重构社交聊天、成长资产或 P2-0014 Dream Event Spine。

## Small design

- Mod 复用 `CharacterCustomization.Source.Wizard`。打开前暂存玩家外观并临时套入同伴外观，关闭时捕获同伴外观、恢复玩家外观；存档只保留同伴外观 JSON。
- 世界显形改用同一份外观构造临时 `Farmer`，由 `FarmerRenderer` 合成身体、头发、衣物与颜色。
- Generic Mod Config Menu 为可选集成：公开允许作弊能力闸门、聊天/重试/重新捏脸快捷键；未安装时快捷键与 `config.json` 仍可用。
- 收到 DSH action request 后暂停桥接超时推进，直到原生菜单空闲并完成玩家选择。
- decision wire 升至 `0.1.1`，proposal 新增必填 `utterance`。DSH 工具约束它以角色第一人称自然生成、必须使用观察中的 `locationDisplayName`、不得泄露机器 target/坐标；Mod 逐字展示，不再套本地晨间模板。

## Acceptance checks

1. 新存档选择同伴后立刻进入原生捏脸；完成前不发布晨间 DSH turn。
2. 已选同伴但没有外观的旧存档会补一次捏脸；之后可用配置中的快捷键重新捏脸。
3. `companion-presence` 显示完整合成人物，而不是裸 `farmer_base`。
4. GMCM 安装时可看到 `AllowCheatCapabilities`、聊天键、重试键和重新捏脸键；作弊闸门默认关闭且本任务不增加作弊能力。
5. 背包/设置等菜单持续打开超过请求超时时间，DSH 提案仍保留；关闭菜单后出现且不报超时。
6. 晨间弹窗只显示经验证的 DSH `utterance`，包含游戏地点显示名，不出现 `:tile:` 或目标坐标，不拼接本地模板。
7. 聚焦 TypeScript 测试、C# core 测试、Mod 构建、文档检查与 `git diff --check` 通过。

## Negative paths

- 原生 DSH 缺失/无效话语时继续显式报错，不生成本地兜底台词。
- 捏脸菜单异常退出时恢复玩家原外观，不覆盖已有同伴外观。
- GMCM 未安装时 Mod 仍正常加载。

## Allowed files and commands

- `stardew-mod/**`
- `player2-core/**`, `player2-core.tests/**`
- `packages/contracts/**`, `packages/dsh-companion-plugin/**`
- `scripts/**`, `docs/**`, workspace README/package metadata when required by the wire bump
- `git`, `dotnet`, `npm`, repository verification scripts；不改 CI、依赖锁文件或 DSH 内核。

## Risk and authority

- L2：包含玩家权限配置面与跨语言 bridge contract 变更。
- Owner authority：当前对话明确要求这些修复并要求优先开发进度。

## Stop condition

上述 acceptance checks 达成并记录剩余手工游戏烟测项后停止；不顺带进入 P2-0014。
