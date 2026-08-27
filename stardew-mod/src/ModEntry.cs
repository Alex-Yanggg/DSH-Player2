using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;

namespace DSHPlayer2.Stardew;

/// <summary>Validates that Player2 can observe a loaded Stardew Valley world through SMAPI events.</summary>
internal sealed class ModEntry : Mod
{
    /// <summary>Registers the first semantic game event used by Player2.</summary>
    /// <param name="helper">The SMAPI helper for the loaded mod.</param>
    public override void Entry(IModHelper helper)
    {
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
    }

    /// <summary>Logs a small, player-verifiable world observation after a new day begins.</summary>
    /// <param name="sender">The event source.</param>
    /// <param name="e">The event data.</param>
    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        var weather = Game1.isRaining ? "rain" : Game1.isSnowing ? "snow" : "clear";
        this.Monitor.Log($"Player2 probe: day {Game1.Date.TotalDays}, weather {weather}.", LogLevel.Info);
    }
}
