using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;

namespace DSHPlayer2.Stardew;

/// <summary>Shows the first player-controlled Player2 proposal using only game-native UI.</summary>
internal sealed class ModEntry : Mod
{
    private const string AcceptProposalId = "dsh-player2-accept";
    private const string DeclineProposalId = "dsh-player2-decline";

    /// <summary>Registers the first semantic game event used by Player2.</summary>
    /// <param name="helper">The SMAPI helper for the loaded mod.</param>
    public override void Entry(IModHelper helper)
    {
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
    }

    /// <summary>Offers one bounded proposal when a loaded save starts a new day.</summary>
    /// <param name="sender">The event source.</param>
    /// <param name="e">The event data.</param>
    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        var weather = Game1.isRaining ? "rain" : Game1.isSnowing ? "snow" : "clear";
        this.Monitor.Log($"Player2 probe: day {Game1.Date.TotalDays}, weather {weather}.", LogLevel.Info);
        var proposal = weather == "rain"
            ? "It is raining, so I suggest we prepare tomorrow's mine supplies instead of watering crops."
            : "It is clear, so I suggest we care for the three marked crops before anything else.";
        var responses = new[]
        {
            new Response(AcceptProposalId, "Agree to this small plan"),
            new Response(DeclineProposalId, "Not today"),
        };

        Game1.currentLocation.createQuestionDialogue(proposal, responses, this.OnProposalAnswered);
    }

    /// <summary>Records the player's explicit response without taking an in-game action yet.</summary>
    /// <param name="farmer">The player who answered.</param>
    /// <param name="answer">The selected response identifier.</param>
    private void OnProposalAnswered(Farmer farmer, string answer)
    {
        var message = answer == AcceptProposalId
            ? "Player2: I will keep this small plan in view."
            : "Player2: Understood. I will not act on it today.";

        Game1.addHUDMessage(new HUDMessage(message));
        this.Monitor.Log($"Player2 proposal was {answer} by {farmer.Name}.", LogLevel.Info);
    }
}
