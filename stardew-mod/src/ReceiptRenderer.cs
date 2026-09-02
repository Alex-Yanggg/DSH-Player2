using System;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
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
    /// <summary>
    /// Shows the companion presence receipt using Stardew Valley's own player
    /// character template - the vanilla farmer base spritesheet, no custom art.
    /// </summary>
    public static bool TryShowPresence(Player2Proposal proposal, IMonitor monitor)
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
            // The vanilla player base spritesheet, frame 0 (16x32 source pixels),
            // anchored so the presence stands on the agreed tile. Same bounded
            // lifetime envelope as the marker receipt.
            var targetPosition = new Vector2(
                proposal.TargetTileX * Game1.tileSize,
                (proposal.TargetTileY * Game1.tileSize) - Game1.tileSize);
            Game1.currentLocation.temporarySprites.Add(new TemporaryAnimatedSprite(
                "Characters\\Farmer\\farmer_base",
                new Rectangle(0, 0, 16, 32),
                1200f,
                1,
                1,
                targetPosition,
                flicker: false,
                flipped: false,
                layerDepth: 0.72f,
                alphaFade: 0f,
                Color.White,
                scale: Game1.pixelZoom,
                scaleChange: 0f,
                rotation: 0f,
                rotationChange: 0f,
                local: false));
            Game1.currentLocation.playSound("dwoop");
            return true;
        }
        catch (Exception ex)
        {
            monitor.Log($"Player2 could not show its presence receipt: {ex.Message}", LogLevel.Error);
            return false;
        }
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
    public static bool Show(BridgeActionRequest request, Player2Proposal proposal, IMonitor monitor)
    {
        return request.Proposal.CapabilityId == DecisionBridgeRules.CompanionPresence.Id
            ? TryShowPresence(proposal, monitor)
            : TryShowWorld(proposal, monitor);
    }
}
