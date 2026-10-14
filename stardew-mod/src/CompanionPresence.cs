using System;
using StardewModdingAPI;
using StardewValley;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The companion's one runtime actor in the world: placed near the player,
/// moved by the player's explicit commands, and kept out of vanilla saves.
/// </summary>
internal static class CompanionPresence
{
    public static NativeCompanion? ActiveCompanion { get; private set; }
    public static Func<string> ResolveName { get; set; } = () => "Player2";
    public static Action<string, string> MovementReport { get; set; } = (_, _) => { };

    /// <summary>
    /// Ensures the save-owned companion has one runtime actor. This is a
    /// presence-only operation: it never starts movement or changes follow
    /// authority.
    /// </summary>
    public static bool EnsurePresent(CompanionAppearance appearance, IMonitor monitor, out bool created)
    {
        created = false;
        try
        {
            if (ActiveCompanion is not null)
            {
                ActiveCompanion.ApplyAppearance(appearance);
                return true;
            }
            var actor = new NativeCompanion(ResolveName(), appearance, MovementReport);
            if (!actor.PlaceNearPlayer()) return false;
            ActiveCompanion = actor;
            created = true;
            return true;
        }
        catch (Exception error)
        {
            monitor.Log($"Player2 native companion creation failed: {error}", LogLevel.Error);
            return false;
        }
    }

    public static bool Command(string command, CompanionAppearance? appearance, IMonitor monitor)
    {
        if (appearance is null) return false;
        try
        {
            if (ActiveCompanion is null)
            {
                if (command == "stay") return true;
                if (!EnsurePresent(appearance, monitor, out _)) return false;
            }
            return ActiveCompanion!.Command(command);
        }
        catch (Exception error)
        {
            monitor.Log($"Player2 native movement failed: {error}", LogLevel.Error);
            return false;
        }
    }

    public static void ClearPresence()
    {
        if (ActiveCompanion is not null) CompanionInventoryStore.Save(ActiveCompanion.Avatar);
        ActiveCompanion?.currentLocation?.characters.Remove(ActiveCompanion);
        ActiveCompanion = null;
    }

    // Runtime-only actors never enter vanilla save serialization.
    public static void DetachForSave()
    {
        if (ActiveCompanion is null) return;
        CompanionInventoryStore.Save(ActiveCompanion.Avatar);
        ActiveCompanion.currentLocation?.characters.Remove(ActiveCompanion);
    }
    public static void RestoreAfterSave()
    {
        if (ActiveCompanion?.currentLocation is { } location && !location.characters.Contains(ActiveCompanion))
            location.characters.Add(ActiveCompanion);
    }
}
