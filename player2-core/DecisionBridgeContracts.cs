using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DSHPlayer2.Core;

/// <summary>Wire constants and host-side validation for one DSH permission-seeking turn.</summary>
public static class DecisionBridgeRules
{
    public const string WireVersion = "0.0.3";
    public const string AwaitingPlayerStatus = "awaiting-player";
    public const string CapabilityId = "visual-receipt";
    public const string AllowedScope = "visual marker + sound only";
    public const int MaxCitedObservations = 8;
    public const int MaxReasonLength = 800;

    /// <summary>Returns a stable game-clock timestamp so same-day restart reproduces the same inbox value.</summary>
    public static string TimestampForSequence(int sequence)
    {
        AssertSequence(sequence);
        return DateTimeOffset.UnixEpoch.AddDays(sequence).ToString("O", CultureInfo.InvariantCulture);
    }

    /// <summary>Creates the bounded Player-authored facts exposed to DSH for one game day.</summary>
    public static DecisionTurnEnvelope CreateTurn(
        WorldSnapshot snapshot,
        int sequence,
        string createdAt,
        int targetTileX,
        int targetTileY,
        SharedOutcome? yesterdayOutcome)
    {
        AssertSequence(sequence);
        AssertTimestamp(createdAt, nameof(createdAt));
        var target = FormatTarget(snapshot.Location, targetTileX, targetTileY);
        var observations = new List<BridgeObservation>
        {
            new(
                $"world-{sequence}",
                "world",
                createdAt,
                null,
                "stardew-smapi",
                "semantic",
                1,
                new Dictionary<string, JsonElement>
                {
                    ["weather"] = JsonSerializer.SerializeToElement(snapshot.Weather),
                    ["location"] = JsonSerializer.SerializeToElement(snapshot.Location),
                    ["pendingTask"] = JsonSerializer.SerializeToElement(snapshot.PendingTask),
                    ["target"] = JsonSerializer.SerializeToElement(target),
                }),
        };
        var priorOutcome = Player2Rules.GetYesterdayOutcome(yesterdayOutcome, snapshot.Day);
        if (priorOutcome is not null)
        {
            observations.Add(new BridgeObservation(
                $"outcome-{sequence - 1}",
                "action-result",
                createdAt,
                null,
                "stardew-smapi",
                "semantic",
                1,
                new Dictionary<string, JsonElement>
                {
                    ["status"] = JsonSerializer.SerializeToElement(priorOutcome.Status),
                    ["target"] = JsonSerializer.SerializeToElement($"stardew-tile:{priorOutcome.TargetTileX},{priorOutcome.TargetTileY}"),
                    ["scope"] = JsonSerializer.SerializeToElement(priorOutcome.Scope),
                }));
        }

        return new DecisionTurnEnvelope(
            WireVersion,
            sequence,
            createdAt,
            sequence,
            new BridgeAdapterDescriptor(
                "stardew-smapi",
                "stardew-valley",
                "semantic",
                new[]
                {
                    new BridgeCapabilityDescriptor(
                        CapabilityId,
                        "Show one temporary world marker",
                        "semantic",
                        true,
                        true,
                        "player2://visual-receipt/0.1"),
                }),
            observations.ToArray());
    }

    /// <summary>Revalidates one DSH request against the exact Player-authored turn.</summary>
    public static ValidatedDecision ValidateRequest(DecisionTurnEnvelope turn, BridgeActionRequest request)
    {
        if (turn.Version != WireVersion || request.Version != WireVersion)
        {
            throw new InvalidOperationException("Decision bridge version mismatch.");
        }
        AssertSequence(turn.Sequence);
        if (request.Sequence != turn.Sequence || request.Status != AwaitingPlayerStatus)
        {
            throw new InvalidOperationException("Action request does not belong to the current turn.");
        }
        var proposal = request.Proposal;
        var expectedProposalId = $"turn-{turn.Sequence}:proposal";
        if (proposal.Id != expectedProposalId || proposal.CreatedAt != turn.CreatedAt)
        {
            throw new InvalidOperationException("Action request has an invalid proposal identity.");
        }
        if (proposal.CapabilityId != CapabilityId ||
            !turn.Adapter.Capabilities.Any(capability => capability.Id == CapabilityId))
        {
            throw new InvalidOperationException("Action request selected an unavailable capability.");
        }
        if (proposal.BasedOnObservationIds.Length is < 1 or > MaxCitedObservations ||
            proposal.BasedOnObservationIds.Distinct(StringComparer.Ordinal).Count() != proposal.BasedOnObservationIds.Length)
        {
            throw new InvalidOperationException("Action request has invalid observation citations.");
        }
        var knownObservationIds = turn.Observations.Select(observation => observation.Id).ToHashSet(StringComparer.Ordinal);
        var world = turn.Observations.SingleOrDefault(observation => observation.Kind == "world")
            ?? throw new InvalidOperationException("Decision turn has no current world observation.");
        if (!proposal.BasedOnObservationIds.Contains(world.Id, StringComparer.Ordinal) ||
            proposal.BasedOnObservationIds.Any(id => !knownObservationIds.Contains(id)))
        {
            throw new InvalidOperationException("Action request is not grounded in the current turn.");
        }
        if (proposal.Scope != AllowedScope || string.IsNullOrWhiteSpace(proposal.Reason) || proposal.Reason.Length > MaxReasonLength)
        {
            throw new InvalidOperationException("Action request exceeds the advertised capability scope.");
        }

        var expectedTarget = GetStringFact(world, "target");
        var location = GetStringFact(world, "location");
        if (proposal.Intent.Target != expectedTarget ||
            !TryParseTarget(expectedTarget, out var targetLocation, out var targetTileX, out var targetTileY) ||
            targetLocation != location)
        {
            throw new InvalidOperationException("Action request selected a target outside the current turn.");
        }
        var gameProposal = new Proposal(
            GetIntFact(turn, "gameDay"),
            GetStringFact(world, "weather"),
            location,
            GetStringFact(world, "pendingTask"),
            "show one agreed world receipt",
            proposal.Reason,
            targetTileX,
            targetTileY,
            proposal.Scope);
        return new ValidatedDecision(request, gameProposal);
    }

    /// <summary>Creates the explicit player answer persisted before settlement.</summary>
    public static BridgePermissionGrant CreateGrant(BridgeActionRequest request, bool granted, string grantedAt, string expiresAt)
    {
        AssertTimestamp(grantedAt, nameof(grantedAt));
        AssertTimestamp(expiresAt, nameof(expiresAt));
        return new BridgePermissionGrant(request.Proposal.Id, granted, grantedAt, expiresAt);
    }

    /// <summary>Validates permission and returns either an executable proposal or a terminal receipt.</summary>
    public static DecisionAuthorization Authorize(
        DecisionTurnEnvelope turn,
        BridgeActionRequest request,
        BridgePermissionGrant grant,
        string occurredAt)
    {
        var validated = ValidateRequest(turn, request);
        AssertTimestamp(occurredAt, nameof(occurredAt));
        if (grant.ProposalId != request.Proposal.Id)
        {
            throw new InvalidOperationException("Permission grant does not belong to the proposal.");
        }
        AssertTimestamp(grant.GrantedAt, nameof(grant.GrantedAt));
        AssertTimestamp(grant.ExpiresAt, nameof(grant.ExpiresAt));
        if (!grant.Granted)
        {
            return new DecisionAuthorization(
                false,
                validated,
                CreateReceipt(request, "declined", occurredAt, null, "The player declined this proposal."));
        }
        if (DateTimeOffset.Parse(grant.ExpiresAt, CultureInfo.InvariantCulture) <=
            DateTimeOffset.Parse(occurredAt, CultureInfo.InvariantCulture))
        {
            return new DecisionAuthorization(
                false,
                validated,
                CreateReceipt(request, "expired", occurredAt, null, "The player permission expired before execution."));
        }
        return new DecisionAuthorization(true, validated, null);
    }

    /// <summary>Creates player-owned retained state and a receipt after one granted marker attempt.</summary>
    public static DecisionCompletion CompleteGranted(DecisionAuthorization authorization, bool receiptShown, string occurredAt)
    {
        if (!authorization.MayExecute || authorization.TerminalReceipt is not null)
        {
            throw new InvalidOperationException("Only a granted authorization can be completed.");
        }
        AssertTimestamp(occurredAt, nameof(occurredAt));
        var proposal = authorization.Validated.GameProposal;
        var state = Player2Rules.CreateAcceptedState(proposal, true, receiptShown)
            ?? throw new InvalidOperationException("Granted proposal did not produce retained state.");
        var receipt = CreateReceipt(
            authorization.Validated.Request,
            receiptShown ? "completed" : "failed",
            occurredAt,
            FormatTarget(proposal.Location, proposal.TargetTileX, proposal.TargetTileY),
            receiptShown ? "A temporary world marker was shown." : "The temporary world marker could not be shown.");
        return new DecisionCompletion(state, receipt);
    }

    /// <summary>Validates a persisted terminal receipt before using it as restart evidence.</summary>
    public static BridgeActionReceipt ValidateReceipt(DecisionTurnEnvelope turn, BridgeActionReceipt receipt)
    {
        if (turn.Version != WireVersion)
        {
            throw new InvalidOperationException("Decision bridge version mismatch.");
        }
        AssertSequence(turn.Sequence);
        if (receipt.ProposalId != $"turn-{turn.Sequence}:proposal" ||
            receipt.CapabilityId != CapabilityId ||
            receipt.Scope != AllowedScope ||
            string.IsNullOrWhiteSpace(receipt.Detail))
        {
            throw new InvalidOperationException("Persisted receipt does not belong to this decision sequence.");
        }
        if (receipt.Status is not ("completed" or "failed" or "declined" or "expired"))
        {
            throw new InvalidOperationException("Persisted receipt has an invalid terminal status.");
        }
        AssertTimestamp(receipt.OccurredAt, nameof(receipt.OccurredAt));
        if (receipt.Status is "completed" or "failed")
        {
            var world = turn.Observations.SingleOrDefault(observation => observation.Kind == "world")
                ?? throw new InvalidOperationException("Decision turn has no current world observation.");
            if (receipt.Target != GetStringFact(world, "target"))
            {
                throw new InvalidOperationException("Action receipt does not match the current turn target.");
            }
        }
        else if (receipt.Target is not null)
        {
            throw new InvalidOperationException("Non-executed receipt must not claim a target.");
        }
        return receipt;
    }

    private static BridgeActionReceipt CreateReceipt(
        BridgeActionRequest request,
        string status,
        string occurredAt,
        string? target,
        string detail)
    {
        return new BridgeActionReceipt(
            request.Proposal.Id,
            request.Proposal.CapabilityId,
            status,
            occurredAt,
            target,
            request.Proposal.Scope,
            detail);
    }

    private static string GetStringFact(BridgeObservation observation, string key)
    {
        if (!observation.Facts.TryGetValue(key, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidOperationException($"World observation is missing string fact '{key}'.");
        }
        return value.GetString() ?? throw new InvalidOperationException($"World fact '{key}' is null.");
    }

    private static int GetIntFact(DecisionTurnEnvelope turn, string key)
    {
        return key == "gameDay" && turn.GameDay > 0
            ? turn.GameDay
            : throw new InvalidOperationException($"Decision turn is missing integer fact '{key}'.");
    }

    private static string FormatTarget(string location, int x, int y) => $"stardew-location:{location}:tile:{x},{y}";

    private static bool TryParseTarget(string target, out string location, out int x, out int y)
    {
        location = string.Empty;
        x = 0;
        y = 0;
        const string prefix = "stardew-location:";
        if (!target.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }
        var separator = target.IndexOf(":tile:", prefix.Length, StringComparison.Ordinal);
        if (separator <= prefix.Length)
        {
            return false;
        }
        location = target[prefix.Length..separator];
        var coordinates = target[(separator + ":tile:".Length)..].Split(',');
        return coordinates.Length == 2 &&
            int.TryParse(coordinates[0], NumberStyles.None, CultureInfo.InvariantCulture, out x) &&
            int.TryParse(coordinates[1], NumberStyles.None, CultureInfo.InvariantCulture, out y) &&
            x >= 0 && y >= 0;
    }

    private static void AssertSequence(int sequence)
    {
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "Decision sequence must be positive.");
        }
    }

    private static void AssertTimestamp(string value, string name)
    {
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _))
        {
            throw new ArgumentException("Decision timestamps must be ISO-8601 values.", name);
        }
    }
}

public sealed record BridgeCapabilityDescriptor(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("accessMode")] string AccessMode,
    [property: JsonPropertyName("requiresExplicitConsent")] bool RequiresExplicitConsent,
    [property: JsonPropertyName("isReversible")] bool IsReversible,
    [property: JsonPropertyName("inputSchemaRef")] string InputSchemaRef);

public sealed record BridgeAdapterDescriptor(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("gameId")] string GameId,
    [property: JsonPropertyName("accessMode")] string AccessMode,
    [property: JsonPropertyName("capabilities")] BridgeCapabilityDescriptor[] Capabilities);

public sealed record BridgeObservation(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("observedAt")] string ObservedAt,
    [property: JsonPropertyName("expiresAt")] string? ExpiresAt,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("accessMode")] string AccessMode,
    [property: JsonPropertyName("confidence")] double Confidence,
    [property: JsonPropertyName("facts")] Dictionary<string, JsonElement> Facts);

public sealed record DecisionTurnEnvelope(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sequence")] int Sequence,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("gameDay")] int GameDay,
    [property: JsonPropertyName("adapter")] BridgeAdapterDescriptor Adapter,
    [property: JsonPropertyName("observations")] BridgeObservation[] Observations);

public sealed record BridgeProposalIntent([property: JsonPropertyName("target")] string Target);

public sealed record BridgeProposal(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("basedOnObservationIds")] string[] BasedOnObservationIds,
    [property: JsonPropertyName("capabilityId")] string CapabilityId,
    [property: JsonPropertyName("intent")] BridgeProposalIntent Intent,
    [property: JsonPropertyName("scope")] string Scope,
    [property: JsonPropertyName("reason")] string Reason);

public sealed record BridgeActionRequest(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sequence")] int Sequence,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("proposal")] BridgeProposal Proposal);

public sealed record BridgePermissionGrant(
    [property: JsonPropertyName("proposalId")] string ProposalId,
    [property: JsonPropertyName("granted")] bool Granted,
    [property: JsonPropertyName("grantedAt")] string GrantedAt,
    [property: JsonPropertyName("expiresAt")] string ExpiresAt);

public sealed record BridgeActionReceipt(
    [property: JsonPropertyName("proposalId")] string ProposalId,
    [property: JsonPropertyName("capabilityId")] string CapabilityId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("occurredAt")] string OccurredAt,
    [property: JsonPropertyName("target")] string? Target,
    [property: JsonPropertyName("scope")] string Scope,
    [property: JsonPropertyName("detail")] string Detail);

public sealed record ValidatedDecision(BridgeActionRequest Request, Proposal GameProposal);

public sealed record DecisionAuthorization(bool MayExecute, ValidatedDecision Validated, BridgeActionReceipt? TerminalReceipt);

public sealed record DecisionCompletion(AcceptedState State, BridgeActionReceipt Receipt);
