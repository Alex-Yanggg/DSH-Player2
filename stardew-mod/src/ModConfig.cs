using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using StardewModdingAPI;

namespace DSHPlayer2.Stardew;

/// <summary>
/// One selectable companion: a persona pack (P2-0017) under the mod's
/// `personas/` folder. The mod reads only the id (its folder key) and name; the companion plugin
/// validates the whole pack and binds it, so the format lives in one place.
/// </summary>
public sealed record CompanionChoice(string Id, string Name, string PackPath)
{
    /// <summary>Every pack folder under <paramref name="modDirectory"/>/personas; a pack without a name stops the mod.</summary>
    public static List<CompanionChoice> LoadAll(string modDirectory)
    {
        var choices = Directory.GetFiles(Path.Combine(modDirectory, "personas"), "persona.json", SearchOption.AllDirectories)
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path =>
            {
                using var pack = JsonDocument.Parse(File.ReadAllText(path));
                return new CompanionChoice(pack.RootElement.GetProperty("id").GetString()!, pack.RootElement.GetProperty("name").GetString()!, path);
            })
            .ToList();
        if (choices.Count == 0) throw new InvalidOperationException($"Player2 found no persona pack under {modDirectory}/personas.");
        return choices;
    }
}

/// <summary>Player-owned local configuration.</summary>
internal sealed class ModConfig
{
    /// <summary>
    /// Player2's data root under the DSH home: one folder per companion
    /// person and save (the save's DSH session works there) and the
    /// companion's memory ledger. The name is kept so existing configs and
    /// memories carry over.
    /// </summary>
    public string DecisionBridgeDirectory { get; set; } = DefaultBridgeDirectory();

    /// <summary>Places one name first in the new-save creator; it never skips the player's choice.</summary>
    public string CompanionName { get; set; } = string.Empty;

    /// <summary>Key that opens the companion chat window.</summary>
    public SButton ChatKey { get; set; } = SButton.F2;

    /// <summary>The DSH command; empty finds the per-user pnpm shim first, then PATH.</summary>
    public string DshCommand { get; set; } = string.Empty;

    /// <summary>
    /// How the mod supplies DEEPSEEK_API_KEY to the DSH process it spawns.
    /// InheritOnly (default) passes the variable through only when the SMAPI
    /// process environment already carries it. IncludeUserRegistry restores
    /// the legacy behavior of reading the user-scope registry hive; it keeps
    /// the secret out of the config file either way.
    /// </summary>
    public ApiKeyMode ApiKeyMode { get; set; } = ApiKeyMode.InheritOnly;

    /// <summary>Key that reopens Stardew Valley's native appearance editor for the companion.</summary>
    public SButton CustomizeCompanionKey { get; set; } = SButton.F7;

    /// <summary>
    /// The settings cheat switch (P2-0021, default off). There are no red lines,
    /// only this on/off: while it is on (or the player spoke the switch in chat
    /// for this save), body inputs declared as cheats are accepted.
    /// </summary>
    public bool AllowCheatCapabilities { get; set; }

    /// <summary>The default data root under the DSH home.</summary>
    public static string DefaultBridgeDirectory()
    {
        return System.IO.Path.Combine(
            System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
            ".dsh",
            "player2",
            "bridge");
    }
}

/// <summary>Controls how the DSH child process receives the DeepSeek API key.</summary>
public enum ApiKeyMode
{
    /// <summary>Pass the variable through only when the environment already carries it.</summary>
    InheritOnly,

    /// <summary>Legacy behavior: fall back to reading the user-scope registry hive.</summary>
    IncludeUserRegistry,
}
