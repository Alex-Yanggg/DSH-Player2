# Stardew SMAPI probe

This is the first two Player2 technical gates. At the beginning of each game day, the mod captures a small world snapshot (day, weather, location, and one pending task), then asks the player to agree to or decline one weather-based plan. Agreeing creates a visible world receipt at a named target tile and persists two local `modData` values: the commitment and its most recent shared outcome. Declining creates no world or state change. On the next day, the mod recalls only that single prior outcome before asking a new plan.

The world receipt is deliberately limited to one temporary visual marker and a sound. It does not change crops, inventory, maps, game automation, NPCs, or multiplayer state. This mod contains no LLM or DSH plugin; those remain later milestones.

Press **F2** while the player is free to open the 0.0.2 text input. **Enter** submits one message and returns control to the game; **Esc** cancels. The mod deliberately logs only the message length. Its deterministic fallback immediately produces a reply, question, disagreement, or suggestion from the current whitelisted snapshot and at most one compatible yesterday outcome; free text never triggers a game action. The next integration step is an asynchronous DSH response that may replace that fallback: the game thread must never wait for Node or a model.

## Build and verify

1. Install SMAPI 4.5+ and the .NET 6 SDK.
2. Run `dotnet build` in this directory. The SMAPI build package discovers a standard game installation and deploys the mod to the game's `Mods/DSHPlayer2` folder.
3. If discovery cannot find a custom game installation, run `dotnet build -p:GamePath="FULL_GAME_PATH"` instead. Keep that machine-specific path out of this public project file.
4. Start the game through `StardewModdingAPI.exe`, load or start a save, and begin a day.
5. Confirm that the SMAPI console contains `Player2 snapshot: day …`, then inspect the proposal's observed facts, stated reason, target tile, and explicit no-mutation scope.
6. Choose **Agree to this small plan**. Confirm the HUD receipt names the target tile, a temporary green marker and sound appear at that tile, and the SMAPI console records `status completed`.
7. Begin the next day. Confirm the HUD recalls only the previous day's one outcome before the new proposal appears.
8. On a separate day choose **Not today**. Confirm that the HUD acknowledges the refusal and that no marker, sound, or new Player2 state is produced.

Passing these gates proves the event-driven game entry point, a refutable permission turn, a bounded world receipt, and two local state values with next-day recall. A companion body and gameplay action are separate questions; DSH integration is intentionally later.
