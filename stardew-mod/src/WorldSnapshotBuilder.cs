using System.Linq;
using DSHPlayer2.Core;
using StardewValley;

namespace DSHPlayer2.Stardew;

/// <summary>
/// Projects the direct game facts one turn needs. It intentionally contains
/// no inferred task or plan: only the day, weather, location, and the bounded
/// farmer projection the rules layer owns.
/// </summary>
internal static class WorldSnapshotBuilder
{
    public static WorldSnapshot Capture()
    {
        var weather = Game1.isRaining ? "rain" : Game1.isSnowing ? "snow" : "clear";
        // The teammate context: the companion only plans like a farmer if the
        // turn shows what the team is carrying and can afford. The rules layer
        // owns the inventory bounding; this stays a direct fact projection.
        var items = Game1.player.Items
            .Where(item => item is not null)
            .Select(item => new InventoryItemSnapshot(item.DisplayName, item.Stack));
        var self = Player2Rules.CreateFarmerSnapshot(
            Game1.player.Name,
            Game1.player.Money,
            Game1.player.Items.Count(item => item is not null),
            Game1.player.Items.Count,
            items);
        return Player2Rules.CreateSnapshot(Game1.Date.TotalDays, weather, Game1.currentLocation.NameOrUniqueName, self);
    }
}
