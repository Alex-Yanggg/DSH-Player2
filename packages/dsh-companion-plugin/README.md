# `@dsh-player2/dsh-companion-plugin`

The Player2 companion as one Cordis plugin inside DeepSeek Harness's `acp` profile. The Stardew mod starts `dsh --profile acp` with a patch that mounts this plugin; DSH does everything else (model, goals, queueing, cancellation, logs).

It contributes:

- the persona: the soul as a constitution, the companion policy, the five knobs as tendencies, the response language;
- turn markers (`[chat day=N]`, `[day-start day=N]`, `[day-end day=N]`, `[resume]`) read in `agent/pre-step`: memory notes, the dream, goal resume without a model call, and dice nudges on goal rounds;
- body tools when `gameUrl` and `gameToken` are configured: `world_observe`, `world_find`, `world_map`, `world_locations`, `body_walk_to`, `body_use`, `body_input`, `reflex_melee`, `cheat_grant`;
- memory: `remember` (one episode per call) and `dream_commit` (only during a dream), over the Persona Ledger next to the save's session directory.

Install it once into DSH's acp profile from the repository root:

```powershell
npm run build
dsh plugin --profile acp add ./packages/dsh-companion-plugin
```

The patch the mod writes looks like this (JSON is valid YAML):

```yaml
- insert:
    - id: player2-companion
      name: '@dsh-player2/dsh-companion-plugin'
      config:
        characterName: Mira
        relationshipRole: the player's candid farm partner
        soul: { values: [...], bonds: [...], voice: ..., boundaries: [...] }
        knobs: { talkativeness: 0.5, helpSeeking: 0.5, risk: 0.5, obedience: 0.5, skill: 0.5 }
        gameUrl: http://localhost:<port>/mcp
        gameToken: <per-run token>
- id: tool-bash
  disabled: true
```

The session's working directory must be `<root>/projects/<person>/sessions/<save>`; the ledger lives in `<root>/projects/<person>/ledger/`.
