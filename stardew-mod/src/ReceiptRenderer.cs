using System;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;
using Player2Proposal = DSHPlayer2.Core.Proposal;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The only place a validated companion action becomes visible in the world:
/// engine-owned companion actors or temporary world markers. A receipt the
/// world cannot execute still reports failed honestly.
/// </summary>
internal static class ReceiptRenderer
{
    public static NativeCompanion? ActiveCompanion { get; private set; }
    public static Func<string> ResolveName { get; set; } = () => "Player2";
    public static Action<string, string> MovementReport { get; set; } = (_, _) => { };

    public static bool Command(string command, CompanionAppearance? appearance, IMonitor monitor)
    {
        if (appearance is null) return false;
        try
        {
            if (ActiveCompanion is null)
            {
                if (command == "stay") return true;
                var actor = new NativeCompanion(ResolveName(), appearance, MovementReport);
                if (!actor.PlaceNearPlayer()) return false;
                ActiveCompanion = actor;
            }
            return ActiveCompanion.Command(command);
        }
        catch (Exception error)
        {
            monitor.Log($"Player2 native movement failed: {error}", LogLevel.Error);
            return false;
        }
    }

    /// <summary>
    /// Shows the companion presence receipt using Stardew Valley's complete
    /// farmer compositor and the appearance stored by the native editor.
    /// </summary>
    public static bool TryShowPresence(
        Player2Proposal proposal,
        CompanionAppearance? appearance,
        IMonitor monitor)
    {
        if (Game1.currentLocation.NameOrUniqueName != proposal.Location)
        {
            monitor.Log(
                $"Player2 did not show a presence receipt because the player moved from {proposal.Location} to {Game1.currentLocation.NameOrUniqueName}.",
                LogLevel.Warn);
            return false;
        }
        try
        {
            if (appearance is null)
            {
                monitor.Log("Player2 could not show companion presence because this save has no companion appearance.", LogLevel.Error);
                return false;
            }
            var actor = ActiveCompanion ?? new NativeCompanion(ResolveName(), appearance, MovementReport);
            if (!actor.PlaceAt(Game1.currentLocation, new Point(proposal.TargetTileX, proposal.TargetTileY))) return false;
            ActiveCompanion = actor;
            Game1.currentLocation.playSound("dwoop");
            return true;
        }
        catch (Exception ex)
        {
            monitor.Log($"Player2 could not show its presence receipt: {ex.Message}", LogLevel.Error);
            return false;
        }
    }

    public static void ClearPresence()
    {
        ActiveCompanion?.currentLocation?.characters.Remove(ActiveCompanion);
        ActiveCompanion = null;
    }

    // Runtime-only actors never enter vanilla save serialization.
    public static void DetachForSave() => ActiveCompanion?.currentLocation?.characters.Remove(ActiveCompanion);
    public static void RestoreAfterSave()
    {
        if (ActiveCompanion?.currentLocation is { } location && !location.characters.Contains(ActiveCompanion))
            location.characters.Add(ActiveCompanion);
    }

    /// <summary>Shows the original temporary world marker receipt.</summary>
    public static bool TryShowWorld(Player2Proposal proposal, IMonitor monitor)
    {
        if (Game1.currentLocation.NameOrUniqueName != proposal.Location)
        {
            monitor.Log(
                $"Player2 did not show a receipt because the player moved from {proposal.Location} to {Game1.currentLocation.NameOrUniqueName}.",
                LogLevel.Warn);
            return false;
        }
        try
        {
            var targetPosition = new Vector2(proposal.TargetTileX * Game1.tileSize, proposal.TargetTileY * Game1.tileSize);
            Game1.currentLocation.temporarySprites.Add(new TemporaryAnimatedSprite(
                10,
                targetPosition,
                Color.LightGreen,
                1200,
                false,
                1f));
            Game1.currentLocation.playSound("junimoMeep1");
            return true;
        }
        catch (Exception ex)
        {
            monitor.Log($"Player2 could not show its world receipt: {ex.Message}", LogLevel.Error);
            return false;
        }
    }

    /// <summary>Shows the receipt the granted capability names.</summary>
    public static bool Show(
        BridgeActionRequest request,
        Player2Proposal proposal,
        CompanionAppearance? appearance,
        IMonitor monitor)
    {
        return request.Proposal.CapabilityId == DecisionBridgeRules.CompanionPresence.Id
            ? TryShowPresence(proposal, appearance, monitor)
            : TryShowWorld(proposal, monitor);
    }
}
