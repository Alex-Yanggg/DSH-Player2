using System;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewModdingAPI;
using StardewValley;
using Player2Proposal = DSHPlayer2.Core.Proposal;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The only place a validated companion action becomes visible in the world:
/// temporary sprites plus a sound, never a gameplay mutation. A receipt the
/// world cannot show still reports failed honestly.
/// </summary>
internal static class ReceiptRenderer
{
    private static Farmer? activePresence;
    private static string? activePresenceLocation;
    private static Vector2 activePresenceWorldPosition;
    private static DateTimeOffset activePresenceExpiresAt;

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
            var targetPosition = new Vector2(
                proposal.TargetTileX * Game1.tileSize,
                (proposal.TargetTileY * Game1.tileSize) - Game1.tileSize);
            var farmer = Game1.player.CreateFakeEventFarmer();
            appearance.Apply(farmer);
            farmer.faceDirection(2);
            farmer.FarmerSprite.StopAnimation();
            activePresence = farmer;
            activePresenceLocation = proposal.Location;
            activePresenceWorldPosition = targetPosition;
            activePresenceExpiresAt = DateTimeOffset.UtcNow.AddSeconds(3);
            Game1.currentLocation.playSound("dwoop");
            return true;
        }
        catch (Exception ex)
        {
            monitor.Log($"Player2 could not show its presence receipt: {ex.Message}", LogLevel.Error);
            return false;
        }
    }

    /// <summary>Draws the active companion through Stardew's full farmer compositor.</summary>
    public static void DrawActivePresence(SpriteBatch batch)
    {
        if (activePresence is null ||
            DateTimeOffset.UtcNow >= activePresenceExpiresAt ||
            Game1.currentLocation.NameOrUniqueName != activePresenceLocation)
        {
            ClearPresence();
            return;
        }
        var screenPosition = Game1.GlobalToLocal(Game1.viewport, activePresenceWorldPosition);
        var layerDepth = Math.Min(0.99f, (activePresenceWorldPosition.Y + (Game1.tileSize * 2)) / 10000f);
        activePresence.FarmerRenderer.draw(
            batch,
            activePresence,
            activePresence.FarmerSprite.CurrentFrame,
            screenPosition,
            layerDepth,
            flip: false);
    }

    public static void ClearPresence()
    {
        activePresence = null;
        activePresenceLocation = null;
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
