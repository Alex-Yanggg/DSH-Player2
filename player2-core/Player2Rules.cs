using System;

namespace DSHPlayer2.Core;

/// <summary>Contains deterministic Player2 rules which do not require game assemblies.</summary>
public static class Player2Rules
{
    public const int StateVersion = 1;
    public const string CommitmentStateKey = "AlexYanggg.DSHPlayer2/commitment";
    public const string LastSharedOutcomeStateKey = "AlexYanggg.DSHPlayer2/lastSharedOutcome";

    /// <summary>Creates the whitelisted world facts used by one Player2 turn.</summary>
    public static WorldSnapshot CreateSnapshot(int day, string weather, string location)
    {
        var pendingTask = weather == "rain"
            ? "crops do not need watering today"
            : "nearby crops may still need attention";

        return new WorldSnapshot(day, weather, location, pendingTask);
    }

    /// <summary>Creates the one bounded proposal available for a world snapshot.</summary>
    public static Proposal CreateProposal(WorldSnapshot snapshot, int targetTileX, int targetTileY)
    {
        var isRainPlan = snapshot.Weather == "rain";
        var goal = isRainPlan
            ? "prepare tomorrow's mine supplies"
            : "keep three nearby crops in view before anything else";
        var reason = isRainPlan
            ? "rain removes today's watering pressure"
            : "clear weather leaves crop care visible";

        return new Proposal(
            snapshot.Day,
            snapshot.Weather,
            snapshot.Location,
            snapshot.PendingTask,
            goal,
            reason,
            targetTileX,
            targetTileY,
            "visual marker + sound only");
    }

    /// <summary>Formats the permission request without implying any unapproved game action.</summary>
    public static string FormatProposal(Proposal proposal)
    {
        return string.Join(
            Environment.NewLine,
            $"Day {proposal.Day}: {proposal.Weather} at {proposal.Location}.",
            $"Observed: {proposal.PendingTask}.",
            $"Goal: {proposal.Goal} because {proposal.Reason}.",
            $"Scope: mark tile {proposal.TargetTileX}, {proposal.TargetTileY} with a temporary visual receipt only.",
            "No crops, inventory, map, or multiplayer state will change.",
            "May I do that?");
    }

    /// <summary>Builds the player-owned commitment written after an explicit agreement.</summary>
    public static Commitment CreateCommitment(Proposal proposal)
    {
        return new Commitment(
            StateVersion,
            proposal.Day,
            proposal.TargetTileX,
            proposal.TargetTileY,
            proposal.Goal,
            proposal.Scope);
    }

    /// <summary>Builds the one outcome the next day is allowed to recall.</summary>
    public static SharedOutcome CreateOutcome(Proposal proposal, bool receiptShown)
    {
        return new SharedOutcome(
            StateVersion,
            proposal.Day,
            proposal.TargetTileX,
            proposal.TargetTileY,
            proposal.Scope,
            receiptShown ? "completed" : "failed");
    }

    /// <summary>Creates retained state only after the player explicitly agrees to the proposal.</summary>
    public static AcceptedState? CreateAcceptedState(Proposal proposal, bool playerAgreed, bool receiptShown)
    {
        return playerAgreed
            ? new AcceptedState(CreateCommitment(proposal), CreateOutcome(proposal, receiptShown))
            : null;
    }

    /// <summary>Returns a compatible outcome only when it belongs to the immediately prior day.</summary>
    public static SharedOutcome? GetYesterdayOutcome(SharedOutcome? outcome, int currentDay)
    {
        return outcome?.Version == StateVersion && outcome.Day == currentDay - 1
            ? outcome
            : null;
    }

    /// <summary>Creates a local, actionless text response when no asynchronous decision provider is available.</summary>
    public static SocialReply CreateSocialReply(WorldSnapshot snapshot, string playerMessage, SharedOutcome? yesterdayOutcome)
    {
        if (string.IsNullOrWhiteSpace(playerMessage))
        {
            throw new ArgumentException("A social reply requires player text.", nameof(playerMessage));
        }

        var message = playerMessage.Trim().ToLowerInvariant();
        var hasYesterdayOutcome = GetYesterdayOutcome(yesterdayOutcome, snapshot.Day) is not null;

        if (ContainsAny(message, "go ", "do it", "water", "mine", "buy", "fight", "去", "执行", "浇水", "挖矿", "购买", "战斗"))
        {
            return new SocialReply(
                "disagreement",
                "I can talk through a plan, but a chat message cannot make me act in the world.",
                hasYesterdayOutcome);
        }

        if (ContainsAny(message, "why", "what do you know", "为什么", "知道什么"))
        {
            return new SocialReply(
                "reply",
                $"I only know that it is {snapshot.Weather} at {snapshot.Location}, and that {snapshot.PendingTask}.",
                hasYesterdayOutcome);
        }

        if (ContainsAny(message, "what should", "suggest", "plan", "做什么", "建议", "计划"))
        {
            return new SocialReply(
                "suggestion",
                $"Since it is {snapshot.Weather}, I suggest we keep the next plan small and check {snapshot.PendingTask} together.",
                hasYesterdayOutcome);
        }

        if (hasYesterdayOutcome)
        {
            return new SocialReply(
                "reply",
                "I remember the one result we shared yesterday. What would you like to understand about today?",
                true);
        }

        return new SocialReply(
            "question",
            "What outcome matters most to you today? I want to understand before suggesting a plan.",
            false);
    }

    private static bool ContainsAny(string text, params string[] values)
    {
        foreach (var value in values)
        {
            if (text.Contains(value, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>A whitelisted set of facts observed at the start of a game day.</summary>
public sealed record WorldSnapshot(int Day, string Weather, string Location, string PendingTask);

/// <summary>A player-refutable plan with a single visible, non-economic scope.</summary>
public sealed record Proposal(
    int Day,
    string Weather,
    string Location,
    string PendingTask,
    string Goal,
    string Reason,
    int TargetTileX,
    int TargetTileY,
    string Scope);

/// <summary>The approved plan retained in player-owned mod data.</summary>
public sealed record Commitment(
    int Version,
    int Day,
    int TargetTileX,
    int TargetTileY,
    string Goal,
    string Scope);

/// <summary>The latest shared result retained in player-owned mod data.</summary>
public sealed record SharedOutcome(
    int Version,
    int Day,
    int TargetTileX,
    int TargetTileY,
    string Scope,
    string Status);

/// <summary>The two state records written for one explicitly accepted proposal.</summary>
public sealed record AcceptedState(Commitment Commitment, SharedOutcome Outcome);

/// <summary>A player-visible, actionless response from the text social turn.</summary>
public sealed record SocialReply(string Kind, string Text, bool RecallsYesterdayOutcome);
