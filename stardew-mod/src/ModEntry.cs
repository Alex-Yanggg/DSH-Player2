using System;
using System.Text.Json;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;
using Player2Proposal = DSHPlayer2.Core.Proposal;

namespace DSHPlayer2.Stardew;

/// <summary>Offers a bounded, player-approved Player2 plan using only game-native UI.</summary>
internal sealed class ModEntry : Mod
{
    private const string AcceptProposalId = "dsh-player2-accept";
    private const string DeclineProposalId = "dsh-player2-decline";

    private Player2Proposal? activeProposal;

    /// <summary>Registers the first semantic game event used by Player2.</summary>
    /// <param name="helper">The SMAPI helper for the loaded mod.</param>
    public override void Entry(IModHelper helper)
    {
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.Input.ButtonPressed += this.OnButtonPressed;
    }

    /// <summary>Opens the text-only companion input without blocking the game loop on a model response.</summary>
    private void OnButtonPressed(object? sender, ButtonPressedEventArgs e)
    {
        if (e.Button != SButton.F2 || !Context.IsWorldReady || !Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }

        Game1.activeClickableMenu = new CompanionChatMenu(this.OnSocialMessageSubmitted);
    }

    /// <summary>Accepts one player message while deliberately leaving response generation to an asynchronous bridge.</summary>
    private void OnSocialMessageSubmitted(string message)
    {
        this.Monitor.Log($"Player2 received a social message with {message.Length} characters.", LogLevel.Info);
        var snapshot = this.CaptureWorldSnapshot();
        var yesterdayOutcome = Player2Rules.GetYesterdayOutcome(
            this.ReadState<SharedOutcome>(Game1.player, Player2Rules.LastSharedOutcomeStateKey),
            snapshot.Day);
        var reply = Player2Rules.CreateSocialReply(snapshot, message, yesterdayOutcome);
        Game1.addHUDMessage(new HUDMessage($"Player2 ({reply.Kind}): {reply.Text}"));
        this.Monitor.Log(
            $"Player2 generated a {reply.Kind} social response from day {snapshot.Day}; recalled yesterday outcome: {reply.RecallsYesterdayOutcome}.",
            LogLevel.Info);
    }

    /// <summary>Shows one refutable, read-only proposal when a loaded save starts a new day.</summary>
    /// <param name="sender">The event source.</param>
    /// <param name="e">The event data.</param>
    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        if (!Context.IsMainPlayer)
        {
            return;
        }

        var snapshot = this.CaptureWorldSnapshot();
        this.ShowYesterdayRecall(Game1.player, snapshot.Day);
        this.activeProposal = this.CreateProposal(snapshot);

        this.Monitor.Log(
            $"Player2 snapshot: day {snapshot.Day}, weather {snapshot.Weather}, location {snapshot.Location}, pending task {snapshot.PendingTask}.",
            LogLevel.Info);

        var responses = new[]
        {
            new Response(AcceptProposalId, "Agree to this small plan"),
            new Response(DeclineProposalId, "Not today"),
        };

        Game1.currentLocation.createQuestionDialogue(this.FormatProposal(this.activeProposal), responses, this.OnProposalAnswered);
    }

    /// <summary>Records the player's explicit response without changing gameplay state.</summary>
    /// <param name="farmer">The player who answered.</param>
    /// <param name="answer">The selected response identifier.</param>
    private void OnProposalAnswered(Farmer farmer, string answer)
    {
        var proposal = this.activeProposal;
        this.activeProposal = null;

        if (proposal is null)
        {
            this.Monitor.Log("Player2 received a proposal response without an active proposal.", LogLevel.Warn);
            return;
        }

        if (answer == AcceptProposalId)
        {
            var receiptShown = this.TryShowWorldReceipt(proposal);
            var acceptedState = Player2Rules.CreateAcceptedState(proposal, playerAgreed: true, receiptShown);
            if (acceptedState is null)
            {
                this.Monitor.Log("Player2 could not create state for an accepted proposal.", LogLevel.Error);
                return;
            }

            this.SaveLocalState(farmer, acceptedState);
            Game1.addHUDMessage(new HUDMessage(
                $"Player2: {acceptedState.Outcome.Status} at tile {proposal.TargetTileX}, {proposal.TargetTileY}; scope: {proposal.Scope}."));
            this.Monitor.Log(
                $"Player2 proposal accepted by {farmer.Name}: target tile {proposal.TargetTileX}, {proposal.TargetTileY}; scope {proposal.Scope}; status {acceptedState.Outcome.Status}.",
                LogLevel.Info);
            return;
        }

        Game1.addHUDMessage(new HUDMessage("Player2: Understood. I will not act on it today."));
        this.Monitor.Log($"Player2 proposal was declined by {farmer.Name}; no world or state change was made.", LogLevel.Info);
    }

    private WorldSnapshot CaptureWorldSnapshot()
    {
        var weather = Game1.isRaining ? "rain" : Game1.isSnowing ? "snow" : "clear";
        return Player2Rules.CreateSnapshot(Game1.Date.TotalDays, weather, Game1.currentLocation.NameOrUniqueName);
    }

    private Player2Proposal CreateProposal(WorldSnapshot snapshot)
    {
        var playerPosition = Game1.player.Position;
        return Player2Rules.CreateProposal(
            snapshot,
            (int)(playerPosition.X / Game1.tileSize),
            (int)(playerPosition.Y / Game1.tileSize));
    }

    private string FormatProposal(Player2Proposal proposal)
    {
        return Player2Rules.FormatProposal(proposal);
    }

    private bool TryShowWorldReceipt(Player2Proposal proposal)
    {
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
            this.Monitor.Log($"Player2 could not show its world receipt: {ex.Message}", LogLevel.Error);
            return false;
        }
    }

    private void SaveLocalState(Farmer farmer, AcceptedState acceptedState)
    {
        farmer.modData[Player2Rules.CommitmentStateKey] = JsonSerializer.Serialize(acceptedState.Commitment);
        farmer.modData[Player2Rules.LastSharedOutcomeStateKey] = JsonSerializer.Serialize(acceptedState.Outcome);
    }

    private void ShowYesterdayRecall(Farmer farmer, int currentDay)
    {
        var commitment = this.ReadState<Commitment>(farmer, Player2Rules.CommitmentStateKey);
        var outcome = this.ReadState<SharedOutcome>(farmer, Player2Rules.LastSharedOutcomeStateKey);

        if (commitment?.Version == Player2Rules.StateVersion && outcome?.Version == Player2Rules.StateVersion)
        {
            this.Monitor.Log(
                $"Player2 local state: commitment day {commitment.Day}, latest outcome day {outcome.Day}.",
                LogLevel.Trace);
        }

        outcome = Player2Rules.GetYesterdayOutcome(outcome, currentDay);
        if (outcome is null)
        {
            return;
        }

        Game1.addHUDMessage(new HUDMessage(
            $"Player2 recall: yesterday's {outcome.Status} receipt was tile {outcome.TargetTileX}, {outcome.TargetTileY}."));
        this.Monitor.Log(
            $"Player2 recalled one prior outcome: day {outcome.Day}; target tile {outcome.TargetTileX}, {outcome.TargetTileY}; status {outcome.Status}.",
            LogLevel.Info);
    }

    private TState? ReadState<TState>(Farmer farmer, string key)
        where TState : class
    {
        if (!farmer.modData.TryGetValue(key, out var serialized))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<TState>(serialized);
        }
        catch (JsonException ex)
        {
            this.Monitor.Log($"Player2 ignored unreadable local state '{key}': {ex.Message}", LogLevel.Warn);
            return null;
        }
    }
}
