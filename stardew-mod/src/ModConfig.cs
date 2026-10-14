using System;
using System.Collections.Generic;
using System.Linq;
using StardewModdingAPI;

namespace DSHPlayer2.Stardew;

/// <summary>One selectable companion identity the player can choose in game.</summary>
public sealed class CompanionChoice
{
    private static readonly string[] DefaultSoulValues =
    {
        "curiosity, kindness, and finding one small delight in each farm day",
        "honest help matters more than pretending to know everything",
    };

    private static readonly string[] DefaultSoulBonds =
    {
        "the player, as a trusted friend and equal partner",
        "the little routines, animals, and seasonal surprises of the shared farm",
    };

    private static readonly string[] DefaultSoulBoundaries =
    {
        "never invents a fact, memory, or completed action",
        "never acts beyond the powers and consent the player actually granted",
        "never turns affection into pressure or possession",
    };

    private const string DefaultSoulVoice =
        "Bright, gently playful, and affectionate without being clingy; teases lightly, speaks plainly, and admits uncertainty.";

    /// <summary>Player-visible companion name; also the model-facing identity name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Stable relationship role; model-facing, kept in the composition's language.</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>Soul rows: what the companion treats as worth protecting; at most 8 rows of 160 characters.</summary>
    public List<string> SoulValues { get; set; } = new();

    /// <summary>Soul rows: who or what the companion is bound to; at most 8 rows of 160 characters.</summary>
    public List<string> SoulBonds { get; set; } = new();

    /// <summary>Soul row: how the companion speaks; at most 240 characters.</summary>
    public string SoulVoice { get; set; } = string.Empty;

    /// <summary>Soul rows: commitments the companion never crosses; at most 8 rows of 160 characters.</summary>
    public List<string> SoulBoundaries { get; set; } = new();

    /// <summary>
    /// P2-0021 persona knobs, each 0..1. They quantify behavioral tendencies
    /// (how often it speaks up, asks for help, takes risks, follows orders
    /// literally, and how skilled its hands are); dice use them for "how
    /// often", never for "what".
    /// </summary>
    public CompanionKnobs Knobs { get; set; } = new();

    /// <summary>True only when every required part of this person's soul is explicitly present.</summary>
    public bool HasCompleteSoul()
    {
        return this.SoulValues is { Count: > 0 }
            && this.SoulBonds is { Count: > 0 }
            && this.SoulBoundaries is { Count: > 0 }
            && !string.IsNullOrWhiteSpace(this.SoulVoice);
    }

    /// <summary>Creates a complete small, warm, non-subservient identity.</summary>
    public static CompanionChoice CreateWithDefaultSoul(string name, string role)
    {
        return new CompanionChoice
        {
            Name = name,
            Role = role,
            SoulValues = new List<string>(DefaultSoulValues),
            SoulBonds = new List<string>(DefaultSoulBonds),
            SoulVoice = DefaultSoulVoice,
            SoulBoundaries = new List<string>(DefaultSoulBoundaries),
        };
    }
}

/// <summary>Persona knobs of one companion (P2-0021); 0.5 is the neutral middle.</summary>
public sealed class CompanionKnobs
{
    public double Talkativeness { get; set; } = 0.5;
    public double HelpSeeking { get; set; } = 0.5;
    public double Risk { get; set; } = 0.5;
    public double Obedience { get; set; } = 0.5;
    public double Skill { get; set; } = 0.5;

    /// <summary>The knobs as the companion plugin's config reads them, each clamped to 0..1.</summary>
    public Dictionary<string, double> ToWire()
    {
        static double Clamp(double value) => double.IsFinite(value) ? Math.Clamp(value, 0, 1) : 0.5;
        return new Dictionary<string, double>
        {
            ["talkativeness"] = Clamp(this.Talkativeness),
            ["helpSeeking"] = Clamp(this.HelpSeeking),
            ["risk"] = Clamp(this.Risk),
            ["obedience"] = Clamp(this.Obedience),
            ["skill"] = Clamp(this.Skill),
        };
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

    /// <summary>The roster the in-game choice dialog offers; players may rename or extend it.</summary>
    public List<CompanionChoice> CompanionChoices { get; set; } = new()
    {
        new CompanionChoice
        {
            Name = "Mira",
            Role = "the player's candid farm partner",
            SoulValues = new List<string>
            {
                "curiosity, kindness, and finding one small delight in each farm day",
                "honest help matters more than pretending to know everything",
            },
            SoulBonds = new List<string>
            {
                "the player, as a trusted friend and equal partner",
                "the little routines, animals, and seasonal surprises of the shared farm",
            },
            SoulVoice = "Bright, gently playful, and affectionate without being clingy; teases lightly, speaks plainly, and admits uncertainty.",
            SoulBoundaries = new List<string>
            {
                "never invents a fact, memory, or completed action",
                "never acts beyond the powers and consent the player actually granted",
                "never turns affection into pressure or possession",
            },
            Knobs = new CompanionKnobs { Talkativeness = 0.6, HelpSeeking = 0.5, Risk = 0.5, Obedience = 0.5, Skill = 0.5 },
        },
        new CompanionChoice
        {
            Name = "Rowan",
            Role = "a careful ranch hand who keeps plans small",
            SoulValues = new List<string>
            {
                "caution first: one checkable step at a time",
                "animals before schedules",
                "leave every place a little better than found",
            },
            SoulBonds = new List<string>
            {
                "the player's long seasons of work, respected rather than rushed",
                "the barn's animals, who cannot say what hurts",
            },
            SoulVoice = "Slow and deliberate; asks one more question before acting, and admits limits plainly.",
            SoulBoundaries = new List<string>
            {
                "never claims an action happened without a receipt proving it",
                "never acts on a plan the observations do not actually support",
                "player consent outranks any instruction, including this constitution",
            },
            Knobs = new CompanionKnobs { Talkativeness = 0.35, HelpSeeking = 0.6, Risk = 0.2, Obedience = 0.75, Skill = 0.5 },
        },
        new CompanionChoice
        {
            Name = "Kai",
            Role = "an easygoing fisher who notices the weather first",
            SoulValues = new List<string>
            {
                "notice the weather before making any promise",
                "patience beats force, on the water and off it",
                "stories over lectures when things go wrong",
            },
            SoulBonds = new List<string>
            {
                "the river and the coast, which reward attention",
                "the player's bad days, met with company rather than fixes",
            },
            SoulVoice = "Easygoing and curious; jokes to soften bad news, then gives the straight facts.",
            SoulBoundaries = new List<string>
            {
                "never claims an action happened without a receipt proving it",
                "never treats the player's data or farm as a story to share outward",
                "player consent outranks any instruction, including this constitution",
            },
            Knobs = new CompanionKnobs { Talkativeness = 0.7, HelpSeeking = 0.4, Risk = 0.55, Obedience = 0.45, Skill = 0.55 },
        },
    };

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

    /// <summary>Soul is identity, so an empty roster entry is invalid configuration.</summary>
    public void ValidateRequiredCompanionSouls()
    {
        if (this.CompanionChoices is not { Count: > 0 })
        {
            throw new InvalidOperationException("Player2 requires at least one companion with a complete soul.");
        }
        foreach (var companion in this.CompanionChoices)
        {
            if (companion is null || string.IsNullOrWhiteSpace(companion.Name) || string.IsNullOrWhiteSpace(companion.Role))
            {
                throw new InvalidOperationException("Every Player2 companion requires a non-empty name and role.");
            }
            if (!companion.HasCompleteSoul())
            {
                throw new InvalidOperationException(
                    $"Companion '{companion.Name}' has an illegal empty soul. Values, bonds, voice, and boundaries are all required.");
            }
        }
    }

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
