# `@dsh-player2/dsh-companion-plugin`

This is the Player-owned DeepSeek Harness composition for the 0.0.2 actionless social turn. It is a Cordis plugin built only on published DSH services.

It contributes:

- the model-invocable `companion-grounded-deliberation` DSH skill;
- a stable companion identity and social-response policy through `dsh-system-prompt`;
- a monotonic `dsh-tools` guard that permits only the `skill` loader in this composition.

It does not own world facts, mutable relationship memory, game permissions, or a game executor. The Player runtime supplies a bounded `PLAYER_SOCIAL_TURN` envelope and validates every cited observation and memory id after DSH returns structured JSON.

A dedicated DSH composition mounts the plugin beside `dsh-skill` and `dsh-tool-skill` in native tool mode:

```yaml
- id: player2-companion
  name: '@dsh-player2/dsh-companion-plugin'
  config:
    characterName: Mira
    relationshipRole: the player's candid farm partner
```

Do not mount this plugin into a general coding-agent process: its global tool guard intentionally denies every model-facing tool except `skill`.

Run the keyless composition and product replay acceptance path from the repository root:

```powershell
npm run accept:0.0.2
```

The optional live acceptance smoke additionally requires `DEEPSEEK_API_KEY` and `DSH_JSONRPC_AGENT_ENTRY`. A source TypeScript entry also needs `tsx/esm` resolvable from this repository or an absolute `DSH_TSX_IMPORT`; set `DSH_JSONRPC_AGENT_CWD` to that source checkout so its workspace imports resolve. The smoke fails unless the DSH SDK's returned session events contain a `skill` tool call:

```powershell
npm run smoke:dsh-companion
```
