# Stardew SMAPI probe

This is the first Player2 technical gate: at the beginning of a game day it writes the day and weather to the SMAPI log, then asks the player to agree to or decline one weather-based plan. It deliberately contains no LLM, DSH plugin, companion NPC, persistent memory, or game automation.

## Build and verify

1. Install SMAPI 4.5+ and the .NET 6 SDK.
2. Run `dotnet build` in this directory. The SMAPI build package discovers a standard game installation and deploys the mod to the game's `Mods/DSHPlayer2` folder.
3. If discovery cannot find a custom game installation, run `dotnet build -p:GamePath="FULL_GAME_PATH"` instead. Keep that machine-specific path out of this public project file.
4. Start the game through `StardewModdingAPI.exe`, load or start a save, and begin a day.
5. Confirm that the SMAPI console contains `Player2 probe: day …, weather …`, then choose either response in the proposal dialog.
6. Confirm that the HUD restates the selected choice and the SMAPI console records it.

Passing this gate proves the event-driven game entry point and an explicit permission turn. The next change may add one bounded visible action; DSH integration is intentionally later.
