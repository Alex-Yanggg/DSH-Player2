# Stardew SMAPI probe

This is the first Player2 technical gate: it observes the beginning of a game day and writes the day and weather to the SMAPI log. It deliberately contains no LLM, DSH plugin, companion NPC, or game automation.

## Build and verify

1. Install SMAPI 4.5+ and the .NET 6 SDK.
2. Run `dotnet build` in this directory. The SMAPI build package discovers a standard game installation and deploys the mod to the game's `Mods/DSHPlayer2` folder.
3. If discovery cannot find a custom game installation, run `dotnet build -p:GamePath="FULL_GAME_PATH"` instead. Keep that machine-specific path out of this public project file.
4. Start the game through `StardewModdingAPI.exe`, load or start a save, and begin a day.
5. Confirm that the SMAPI console contains `Player2 probe: day …, weather …`.

Passing this gate proves only the event-driven game entry point. The next change may add a static in-game proposal; DSH integration is intentionally later.
