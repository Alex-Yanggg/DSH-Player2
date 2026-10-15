# Stardew SMAPI adapter

The mod is the companion's body and voice in Stardew Valley; its mind is a DeepSeek Harness session. On each save the mod starts `dsh --profile acp` as its own child process, opens one DSH session for that save, and talks to it over ACP (stdio JSON-RPC). The companion's hands are a small MCP endpoint the mod serves on localhost: raw state export and raw button input, no task semantics. Models, tools, goals, memory hooks and logs are DSH's own; the mod keeps no request logs.

## Install

1. Install DeepSeek Harness `0.2.0-rc.2` (`@deepseek-ai/dsh`) and set `DEEPSEEK_API_KEY`.
2. From the repository root, build the plugin and add it to DSH's acp profile once:

   ```powershell
   npm ci
   npm run build
   dsh plugin --profile acp add ./packages/dsh-companion-plugin
   ```

3. Build and deploy the mod (the SMAPI build package finds a standard game installation; pass `-p:GamePath="FULL_GAME_PATH"` otherwise):

   ```powershell
   dotnet build DSHPlayer2.Stardew.csproj --configuration Release -p:OS=Windows_NT
   ```

4. Start the game through `StardewModdingAPI.exe`.

`DshCommand` in `config.json` overrides how `dsh` is found (default: the pnpm shim, then `PATH`). `ApiKeyMode`: `InheritOnly` (default) passes `DEEPSEEK_API_KEY` from the SMAPI environment; `IncludeUserRegistry` also reads the Windows user variable. The key only travels in the child's environment and is never written or logged.

## What the game sends

The mod sends plain prompts into the save's session; the plugin reads the marker and DSH does the rest:

| When | Prompt |
| --- | --- |
| A day starts | `[day-start day=N]` |
| The player sends a chat line | `[chat day=N] <text>` (lines sent while the companion is busy wait their turn in order) |
| The day ends | `[day-end day=N]` (the companion's dream: it rewrites its story and memory ledger) |
| The world runs again after a pause | `[resume]` (re-arms a paused goal without a model call) |

A paused game (a menu, an event, an unfocused window) never blocks the companion: its hands report "paused" at once, and after about three seconds the turn in flight is stopped; DSH pauses the goal instead of failing it, and `[resume]` re-arms it once the world runs again. The chat window does not stop a pending reply.

What the companion says appears in the game's chat box, as a co-op friend's words do, and in the chat history. A DSH failure is an in-game error naming the code; the details are in the SMAPI log and the DSH session log.

## Chat and goals

Press **F2** (`ChatKey`) to open or close the chat window. Recent lines stay visible, the mouse wheel and PageUp/PageDown scroll, **Up** recalls your last line, and **Enter** sends. The history (50 lines) persists per save.

Give the companion a goal in chat ("给我弄 3 根胡萝卜"): it creates a DSH goal, plays with its own body over the following days, and says how it went. It plays as its own co-op farmer with its own inventory, which needs a cabin on the farm. Design: [docs/p2-0022-independent-body.md](../docs/p2-0022-independent-body.md).

## Choosing a companion

On the first day of a save the mod asks who your companion is and remembers the choice on that farmer, then opens Stardew Valley's own character-customization screen for the companion's look. **F7** (`CustomizeCompanionKey`) reopens it. Edit the roster in `config.json`:

```json
{
  "CompanionChoices": [{
    "Name": "Mira",
    "Role": "the player's candid farm partner",
    "SoulValues": ["curiosity, kindness, and finding one small delight in each farm day"],
    "SoulBonds": ["the player, as a trusted friend and equal partner"],
    "SoulVoice": "Bright, gently playful, and honest about uncertainty.",
    "SoulBoundaries": ["never invents a fact, memory, or completed action"],
    "Knobs": { "Talkativeness": 0.5, "HelpSeeking": 0.5, "Risk": 0.5, "Obedience": 0.5, "Skill": 0.5 }
  }]
}
```

The soul becomes the persona constitution in DSH's system prompt; a soul without any commitment fails the plugin mount loudly.

## Where things live

Under `%USERPROFILE%\.dsh\player2\bridge` (`DecisionBridgeDirectory`): `player2.patch.yml` (the overlay the mod hands to `dsh --profile acp`), and `projects/<person>/sessions/<saveId>/` as the save's DSH session directory. The persona ledger lives in `projects/<person>/ledger/` (`remember.md` is a readable export rewritten after each dream). DSH's own session logs are in DSH's home.

## Mod settings

With Generic Mod Config Menu installed, the chat and re-customize keys and **Allow cheat capabilities** appear in Mod Options. The cheat switch defaults off; with it off, cheat-class inputs (this build: the `NoClip` walking modifier) are refused unless the player allows cheating in chat for this save.

## Manual check

1. Load a save. The SMAPI console shows `Player2 started DSH (acp profile) for companion <name>.`, the companion joins as a co-op farmer (`Player2 seated <name> as a hidden co-op farmer`) and greets you in the chat box without any input.
2. Press F2, say hello, and confirm the reply appears in the chat window in the game's language. Send two more lines quickly; both are answered in order.
3. Type "过来找我" and confirm the companion answers in one line, then walks to you; it keeps walking with the game window in the background.
4. Ask for 3 carrots. Confirm the companion acts on its own, keeps going across days, and ends with a line about how it went. Open the inventory mid-goal for a few seconds, close it, and confirm the goal continues.
5. Type "停下" during a goal and confirm the companion stops.
6. Sleep, then open `projects/<person>/ledger/remember.md` and confirm the day is in its story.
7. Close the game and confirm no `dsh` process is left running.
8. Rename `DshCommand` to something missing, load a save, and confirm an in-game error names `DSH_START_FAILED` or `DSH_EXITED`.
