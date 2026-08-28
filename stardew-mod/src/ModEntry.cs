using System;
using System.Globalization;
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
    private const string SettledSequenceStateKey = "AlexYanggg.DSHPlayer2/settled-sequence";

    private ModConfig config = new();
    private DecisionBridgeHost? bridgeHost;
    private DecisionTurnEnvelope? activeBridgeTurn;
    private BridgeActionRequest? activeBridgeRequest;
    private BridgeActionRequest? pendingBridgeRequest;
    private Player2Proposal? pendingBridgeProposal;
    private Player2Proposal? fallbackProposal;
    private bool fallbackPending;
    private Player2Proposal? activeProposal;

    /// <summary>Registers the first semantic game event used by Player2.</summary>
    /// <param name="helper">The SMAPI helper for the loaded mod.</param>
    public override void Entry(IModHelper helper)
    {
        this.config = helper.ReadConfig<ModConfig>();
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.GameLoop.UpdateTicked += this.OnUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
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
        var proposal = this.CreateProposal(snapshot);

        this.Monitor.Log(
            $"Player2 snapshot: day {snapshot.Day}, weather {snapshot.Weather}, location {snapshot.Location}, pending task {snapshot.PendingTask}.",
            LogLevel.Info);

        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            this.ShowProposal(proposal);
            return;
        }

        var sequence = checked(snapshot.Day + 1);
        if (this.IsSettled(Game1.player, sequence))
        {
            this.Monitor.Log($"Player2 decision sequence {sequence} is already settled; no request will be replayed.", LogLevel.Info);
            return;
        }
        var yesterdayOutcome = Player2Rules.GetYesterdayOutcome(
            this.ReadState<SharedOutcome>(Game1.player, Player2Rules.LastSharedOutcomeStateKey),
            snapshot.Day);
        this.activeBridgeTurn = DecisionBridgeRules.CreateTurn(
            snapshot,
            sequence,
            DecisionBridgeRules.TimestampForSequence(sequence),
            proposal.TargetTileX,
            proposal.TargetTileY,
            yesterdayOutcome);
        this.fallbackProposal = proposal;
        this.fallbackPending = false;
        this.pendingBridgeRequest = null;
        this.pendingBridgeProposal = null;
        this.activeBridgeRequest = null;
        this.bridgeHost?.Dispose();
        try
        {
            this.bridgeHost = new DecisionBridgeHost(
                this.config.DecisionBridgeDirectory,
                this.config.PollIntervalTicks,
                this.config.RequestTimeoutTicks);
            this.bridgeHost.Start(this.activeBridgeTurn);
        }
        catch (Exception ex)
        {
            this.bridgeHost = null;
            this.Monitor.Log($"Player2 could not start its decision bridge: {ex.Message}", LogLevel.Warn);
            this.ShowProposal(proposal);
            return;
        }
        this.Monitor.Log(
            $"Player2 published decision sequence {sequence} asynchronously and is waiting for DSH without blocking the game.",
            LogLevel.Info);
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        if (!Context.IsWorldReady || !Context.IsMainPlayer || this.bridgeHost is null)
        {
            return;
        }
        var update = this.bridgeHost.Update();
        if (update.Error is not null)
        {
            this.Monitor.Log($"Player2 decision bridge stopped for this day: {update.Error.Message}", LogLevel.Warn);
            this.fallbackPending = this.fallbackProposal is not null;
        }
        if (update.RecoveredReceipt is not null && this.activeBridgeTurn is not null)
        {
            this.MarkSettled(Game1.player, this.activeBridgeTurn.Sequence);
            this.Monitor.Log(
                $"Player2 recovered settled sequence {this.activeBridgeTurn.Sequence} from its {update.RecoveredReceipt.Status} receipt; it will not execute again.",
                LogLevel.Info);
            this.ClearBridgeDay();
            return;
        }
        if (update.Request is not null && this.activeBridgeTurn is not null)
        {
            var validated = DecisionBridgeRules.ValidateRequest(this.activeBridgeTurn, update.Request);
            this.pendingBridgeRequest = update.Request;
            this.pendingBridgeProposal = validated.GameProposal;
            this.Monitor.Log(
                $"Player2 received grounded DSH proposal {update.Request.Proposal.Id}; it is awaiting native player consent.",
                LogLevel.Info);
        }
        this.TryPresentPendingBridgeChoice();
    }

    private void TryPresentPendingBridgeChoice()
    {
        if (!Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }
        if (this.pendingBridgeRequest is not null && this.pendingBridgeProposal is not null)
        {
            this.activeBridgeRequest = this.pendingBridgeRequest;
            this.activeProposal = this.pendingBridgeProposal;
            this.pendingBridgeRequest = null;
            this.pendingBridgeProposal = null;
            this.OpenProposalDialogue(this.activeProposal);
            return;
        }
        if (this.fallbackPending && this.fallbackProposal is not null)
        {
            this.fallbackPending = false;
            this.Monitor.Log("Player2 is using the deterministic local proposal for this day.", LogLevel.Info);
            this.ShowProposal(this.fallbackProposal);
        }
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.ClearBridgeDay();
        this.activeProposal = null;
    }

    private void ShowProposal(Player2Proposal proposal)
    {
        this.activeBridgeRequest = null;
        this.activeProposal = proposal;
        this.OpenProposalDialogue(proposal);
    }

    private void OpenProposalDialogue(Player2Proposal proposal)
    {

        var responses = new[]
        {
            new Response(AcceptProposalId, "Agree to this small plan"),
            new Response(DeclineProposalId, "Not today"),
        };

        Game1.currentLocation.createQuestionDialogue(this.FormatProposal(proposal), responses, this.OnProposalAnswered);
    }

    /// <summary>Records the player's explicit response without changing gameplay state.</summary>
    /// <param name="farmer">The player who answered.</param>
    /// <param name="answer">The selected response identifier.</param>
    private void OnProposalAnswered(Farmer farmer, string answer)
    {
        var proposal = this.activeProposal;
        var bridgeRequest = this.activeBridgeRequest;
        this.activeProposal = null;
        this.activeBridgeRequest = null;

        if (proposal is null)
        {
            this.Monitor.Log("Player2 received a proposal response without an active proposal.", LogLevel.Warn);
            return;
        }

        if (bridgeRequest is not null && this.activeBridgeTurn is not null && this.bridgeHost is not null)
        {
            this.OnBridgeProposalAnswered(farmer, proposal, bridgeRequest, answer == AcceptProposalId);
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
            this.FinishLocalFallback(farmer);
            return;
        }

        Game1.addHUDMessage(new HUDMessage("Player2: Understood. I will not act on it today."));
        this.Monitor.Log($"Player2 proposal was declined by {farmer.Name}; no world or state change was made.", LogLevel.Info);
        this.FinishLocalFallback(farmer);
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
        if (Game1.currentLocation.NameOrUniqueName != proposal.Location)
        {
            this.Monitor.Log(
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
            this.Monitor.Log($"Player2 could not show its world receipt: {ex.Message}", LogLevel.Error);
            return false;
        }
    }

    private void OnBridgeProposalAnswered(
        Farmer farmer,
        Player2Proposal proposal,
        BridgeActionRequest request,
        bool accepted)
    {
        var now = DateTimeOffset.UtcNow;
        var grant = DecisionBridgeRules.CreateGrant(
            request,
            accepted,
            now.ToString("O", CultureInfo.InvariantCulture),
            now.AddMinutes(5).ToString("O", CultureInfo.InvariantCulture));
        var authorization = DecisionBridgeRules.Authorize(
            this.activeBridgeTurn ?? throw new InvalidOperationException("Bridge turn disappeared before settlement."),
            request,
            grant,
            now.ToString("O", CultureInfo.InvariantCulture));
        BridgeActionReceipt receipt;
        if (!authorization.MayExecute)
        {
            receipt = authorization.TerminalReceipt
                ?? throw new InvalidOperationException("Terminal authorization has no receipt.");
            Game1.addHUDMessage(new HUDMessage("Player2: Understood. I will not act on it today."));
        }
        else
        {
            var receiptShown = this.TryShowWorldReceipt(proposal);
            var completion = DecisionBridgeRules.CompleteGranted(
                authorization,
                receiptShown,
                DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));
            receipt = completion.Receipt;
            this.SaveLocalState(farmer, completion.State);
            Game1.addHUDMessage(new HUDMessage(
                $"Player2: {receipt.Status} at {receipt.Target ?? "the agreed target"}; scope: {receipt.Scope}."));
        }

        var sequence = this.activeBridgeTurn.Sequence;
        this.MarkSettled(farmer, sequence);
        this.bridgeHost?.RecordSettlement(grant, receipt);
        this.Monitor.Log(
            $"Player2 settled DSH decision sequence {sequence} as {receipt.Status}; granted: {grant.Granted}.",
            LogLevel.Info);
        this.ClearBridgeDay(keepHost: true);
    }

    private bool IsSettled(Farmer farmer, int sequence)
    {
        return farmer.modData.TryGetValue(SettledSequenceStateKey, out var value) &&
            int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var settled) &&
            settled >= sequence;
    }

    private void MarkSettled(Farmer farmer, int sequence)
    {
        farmer.modData[SettledSequenceStateKey] = sequence.ToString(CultureInfo.InvariantCulture);
    }

    private void FinishLocalFallback(Farmer farmer)
    {
        if (this.activeBridgeTurn is null)
        {
            return;
        }
        this.MarkSettled(farmer, this.activeBridgeTurn.Sequence);
        this.Monitor.Log(
            $"Player2 settled bridge sequence {this.activeBridgeTurn.Sequence} through its deterministic local fallback.",
            LogLevel.Info);
        this.ClearBridgeDay();
    }

    private void ClearBridgeDay(bool keepHost = false)
    {
        if (!keepHost)
        {
            this.bridgeHost?.Dispose();
            this.bridgeHost = null;
        }
        this.activeBridgeTurn = null;
        this.activeBridgeRequest = null;
        this.pendingBridgeRequest = null;
        this.pendingBridgeProposal = null;
        this.fallbackProposal = null;
        this.fallbackPending = false;
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
