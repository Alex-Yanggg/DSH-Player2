# `@dsh-player2/dsh-companion-plugin`

This is the Player-owned DeepSeek Harness composition for actionless social turns and permission-seeking decision turns. It is a Cordis plugin built only on published DSH services.

It contributes:

- the model-invocable `companion-grounded-deliberation` DSH skill;
- a stable companion identity and social-response policy through `dsh-system-prompt`;
- a monotonic `dsh-tools` guard that permits only the `skill` loader in this composition.

The default `social` mode retains that exact authority. `decision` mode instead contributes the `companion-grounded-decision` skill and three fixed-path tools:

- `game_observe` reads one Player-authored immutable turn envelope;
- `companion_propose` validates cited observation and capability ids, then writes one deterministic proposal;
- `game_request_action` writes one immutable `awaiting-player` request and never executes it.

It does not own world facts, mutable relationship memory, game permissions, or a game executor. The Player runtime supplies a bounded `PLAYER_SOCIAL_TURN` envelope and validates every cited observation and memory id after DSH returns structured JSON.

A dedicated DSH composition mounts the plugin beside `dsh-skill` and `dsh-tool-skill` in native tool mode:

```yaml
- id: player2-companion
  name: '@dsh-player2/dsh-companion-plugin'
  config:
    characterName: Mira
    relationshipRole: the player's candid farm partner
    mode: social
```

For a dedicated decision composition, set `mode: decision` and a trusted local `bridgeDirectory`. The model cannot provide paths: the plugin constructs only `inbox/turn-<sequence>.json`, `drafts/proposal-<sequence>.json`, and `outbox/request-<sequence>.json` below that root.

```yaml
- id: player2-companion
  name: '@dsh-player2/dsh-companion-plugin'
  config:
    characterName: Mira
    relationshipRole: the player's candid farm partner
    mode: decision
    bridgeDirectory: C:/path/to/player2-bridge
```

Do not mount this plugin into a general coding-agent process: its global tool guard intentionally denies every tool outside the selected mode. Use a dedicated DSH composition or preset. DSH dynamic Cordis packages are useful for disposable experiments but do not persist across restart and are not this plugin's installation mechanism.

Run the keyless composition and product replay acceptance path from the repository root:

```powershell
npm run accept:0.0.2
npm run accept:0.0.3
```

The optional live acceptance smoke additionally requires `DEEPSEEK_API_KEY` and `DSH_JSONRPC_AGENT_ENTRY`. A source TypeScript entry also needs `tsx/esm` resolvable from this repository or an absolute `DSH_TSX_IMPORT`; set `DSH_JSONRPC_AGENT_CWD` to that source checkout so its workspace imports resolve. The smoke fails unless the DSH SDK's returned session events contain a `skill` tool call:

```powershell
npm run smoke:dsh-companion
```
