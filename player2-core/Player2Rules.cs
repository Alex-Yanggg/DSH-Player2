using System;
using System.Collections.Generic;
using System.Globalization;

namespace DSHPlayer2.Core;

/// <summary>Player-owned state and presentation rules; it never infers game tasks locally.</summary>
public static class Player2Rules
{
    public const int StateVersion = 1;
    public const string CommitmentStateKey = "AlexYanggg.DSHPlayer2/commitment";
    public const string LastSharedOutcomeStateKey = "AlexYanggg.DSHPlayer2/lastSharedOutcome";

    /// <summary>Captures only direct game facts. It intentionally contains no inferred task or plan.</summary>
    public static WorldSnapshot CreateSnapshot(int day, string weather, string location, FarmerSnapshot? self = null)
    {
        if (day < 0) throw new ArgumentOutOfRangeException(nameof(day));
        if (string.IsNullOrWhiteSpace(weather)) throw new ArgumentException("Weather must not be empty.", nameof(weather));
        if (string.IsNullOrWhiteSpace(location)) throw new ArgumentException("Location must not be empty.", nameof(location));
        return new WorldSnapshot(day, weather, location, self);
    }

    /// <summary>
    /// Formats one validated native DSH request without inventing a local goal
    /// or task. The companion name always comes from the player-chosen
    /// identity, and the weather word is the adapter's localized display for
    /// its own weather code — the core never interprets game weather.
    /// </summary>
    public static string FormatProposal(
        Proposal proposal,
        string companionName,
        string weatherDisplay,
        Player2TextSet? text = null)
    {
        text ??= Player2TextSet.English;
        var name = string.IsNullOrWhiteSpace(companionName) ? "Player2" : companionName.Trim();
        var weather = string.IsNullOrWhiteSpace(weatherDisplay) ? proposal.Weather : weatherDisplay.Trim();
        return string.Join(
            Environment.NewLine,
            Fill(text.ProposalDayLine,
                ("day", proposal.Day.ToString(CultureInfo.InvariantCulture)),
                ("weather", weather),
                ("location", proposal.Location)),
            Fill(text.ProposalReasonLine, ("name", name), ("reason", proposal.Reason)),
            Fill(text.ProposalScopeLine,
                ("tileX", proposal.TargetTileX.ToString(CultureInfo.InvariantCulture)),
                ("tileY", proposal.TargetTileY.ToString(CultureInfo.InvariantCulture))),
            text.ProposalBoundaryLine,
            text.ProposalAskLine);
    }

    public static Commitment CreateCommitment(Proposal proposal) => new(
        StateVersion, proposal.Day, proposal.TargetTileX, proposal.TargetTileY, proposal.Reason, proposal.Scope);

    public static SharedOutcome CreateOutcome(Proposal proposal, bool receiptShown) => new(
        StateVersion, proposal.Day, proposal.TargetTileX, proposal.TargetTileY, proposal.Scope,
        receiptShown ? "completed" : "failed");

    public static AcceptedState? CreateAcceptedState(Proposal proposal, bool playerAgreed, bool receiptShown) =>
        playerAgreed ? new AcceptedState(CreateCommitment(proposal), CreateOutcome(proposal, receiptShown)) : null;

    /// <summary>Returns a compatible outcome only when it belongs to the immediately prior day.</summary>
    public static SharedOutcome? GetYesterdayOutcome(SharedOutcome? outcome, int currentDay) =>
        outcome?.Version == StateVersion && outcome.Day == currentDay - 1 ? outcome : null;

    /// <summary>
    /// Builds the bounded farmer projection exposed to DSH: at most
    /// MaxInventoryItems named stacks, each name clipped, with an honest
    /// truncation flag instead of a silently cropped list.
    /// </summary>
    public static FarmerSnapshot CreateFarmerSnapshot(
        string name,
        int money,
        int inventorySlotsUsed,
        int inventorySlotCapacity,
        IEnumerable<InventoryItemSnapshot> items)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Farmer name must not be empty.", nameof(name));
        }
        if (money < 0) throw new ArgumentOutOfRangeException(nameof(money));
        if (inventorySlotsUsed < 0) throw new ArgumentOutOfRangeException(nameof(inventorySlotsUsed));
        if (inventorySlotCapacity < 0) throw new ArgumentOutOfRangeException(nameof(inventorySlotCapacity));
        var listed = new List<InventoryItemSnapshot>();
        var truncated = false;
        foreach (var item in items)
        {
            if (listed.Count >= DecisionBridgeRules.MaxInventoryItems)
            {
                truncated = true;
                break;
            }
            var itemName = item.Name?.Trim() ?? string.Empty;
            if (itemName.Length == 0)
            {
                continue;
            }
            if (itemName.Length > DecisionBridgeRules.MaxItemNameLength)
            {
                itemName = itemName[..DecisionBridgeRules.MaxItemNameLength];
            }
            listed.Add(new InventoryItemSnapshot(itemName, item.Count));
        }
        return new FarmerSnapshot(name.Trim(), money, inventorySlotsUsed, inventorySlotCapacity, listed, truncated);
    }

    private static string Fill(string template, params (string Key, string Value)[] tokens)
    {
        foreach (var (key, value) in tokens) template = template.Replace("{" + key + "}", value, StringComparison.Ordinal);
        return template;
    }
}

/// <summary>Direct game facts only; inferences belong to DSH and must be traceable there.</summary>
public sealed record WorldSnapshot(int Day, string Weather, string Location, FarmerSnapshot? Self = null);

/// <summary>
/// The bounded, direct facts about the farmer the companion plays beside:
/// identity, purse, and a truncated inventory projection. The companion plans
/// as a teammate only if it can see what the team is carrying.
/// </summary>
public sealed record FarmerSnapshot(
    string Name,
    int Money,
    int InventorySlotsUsed,
    int InventorySlotCapacity,
    IReadOnlyList<InventoryItemSnapshot> Items,
    bool InventoryTruncated);

/// <summary>One bounded inventory line: the player-visible name and stack count.</summary>
public sealed record InventoryItemSnapshot(string Name, int Count);

/// <summary>A Player-validated native DSH proposal waiting for explicit consent.</summary>
public sealed record Proposal(int Day, string Weather, string Location, string Reason, int TargetTileX, int TargetTileY, string Scope);

public sealed record Commitment(int Version, int Day, int TargetTileX, int TargetTileY, string Goal, string Scope);

public sealed record SharedOutcome(int Version, int Day, int TargetTileX, int TargetTileY, string Scope, string Status);

public sealed record AcceptedState(Commitment Commitment, SharedOutcome Outcome);
