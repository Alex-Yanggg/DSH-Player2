using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DSHPlayer2.Core;

/// <summary>Wire constants and host-side validation for one DSH decision turn.</summary>
public static class DecisionBridgeRules
{
    public const string WireVersion = "0.1.1";
    public const string AwaitingPlayerStatus = "awaiting-player";
    public const string AutonomousStatus = "autonomous";
    public const string ConsultAutonomy = "consult";
    public const string FullAutonomy = "full";
    public const string CapabilityId = "visual-receipt";
    public const string AllowedScope = "visual marker + sound only";
    public const int MaxCitedObservations = 8;
    public const int MaxReasonLength = 800;
    public const int MaxUtteranceLength = 800;
    public const int MaxInventoryItems = 12;
    public const int MaxItemNameLength = 50;
    public const int MaxSoulItems = 8;
    public const int MaxSoulItemLength = 160;
    public const int MaxSoulVoiceLength = 240;

    /// <summary>One Player-advertised capability with its own bounded scope and receipt language.</summary>
    public sealed record CapabilityDefinition(
        string Id,
        string Title,
        string Scope,
        string InputSchemaRef,
        string GrantedDetail,
        string FailedDetail);

    /// <summary>The temporary world marker: the original reversible visual receipt.</summary>
    public static readonly CapabilityDefinition VisualReceipt = new(
        CapabilityId,
        "Show one temporary world marker",
        AllowedScope,
        "player2://visual-receipt/0.1",
        "A temporary world marker was shown.",
        "The temporary world marker could not be shown.");

    /// <summary>
    /// Persistent native body with farmer appearance. Movement is a separate,
    /// explicitly player-commanded grant; no work/inventory authority is added.
    /// </summary>
    public static readonly CapabilityDefinition CompanionPresence = new(
        "companion-presence",
        "Join the location as a persistent native companion; movement requires an explicit player chat command",
        "persistent native companion presence; movement only on explicit player command",
        "player2://native-companion/0.2",
        "The native companion entered the agreed location and remains present.",
        "The companion presence could not be shown.");

    /// <summary>The complete Player-owned capability catalog advertised on every turn.</summary>
    public static readonly IReadOnlyList<CapabilityDefinition> Capabilities = new[]
    {
        VisualReceipt,
        CompanionPresence,
    };

    public static CapabilityDefinition Capability(string capabilityId)
    {
        return Capabilities.FirstOrDefault(capability => capability.Id == capabilityId)
            ?? throw new InvalidOperationException($"Unknown capability {capabilityId}.");
    }

    /// <summary>Returns a stable game-clock timestamp so same-day restart reproduces the same inbox value.</summary>
    public static string TimestampForSequence(int sequence)
    {
        AssertSequence(sequence);
        return UtcTimestamp(DateTimeOffset.UnixEpoch.AddDays(sequence));
    }

    /// <summary>Returns the current UTC time in the wire timestamp format.</summary>
    public static string TimestampNow()
    {
        return UtcTimestamp(DateTimeOffset.UtcNow);
    }

    /// <summary>
    /// Renders one timestamp in the exact wire format the TypeScript contracts accept:
    /// UTC with the "Z" suffix. DateTimeOffset's round-trip "O" format would emit
    /// "+00:00", which the cross-language schema rejects.
    /// </summary>
    public static string UtcTimestamp(DateTimeOffset value)
    {
        return value.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);
    }

    /// <summary>Creates the bounded Player-authored facts exposed to DSH for one game day.</summary>
    public static DecisionTurnEnvelope CreateTurn(
        AdapterProfile adapter,
        WorldSnapshot snapshot,
        int sequence,
        string createdAt,
        int targetTileX,
        int targetTileY,
        SharedOutcome? yesterdayOutcome,
        BridgeCompanionIdentity? companion = null,
        BridgeGrowthAsset? growth = null)
    {
        AssertSequence(sequence);
        AssertTimestamp(createdAt, nameof(createdAt));
        if (companion?.Soul is not null)
        {
            ValidateCompanionSoul(companion.Soul);
        }
        if (growth is not null)
        {
            CompanionGrowthStore.ValidateAsset(growth);
        }
        var target = adapter.FormatLocationTarget(snapshot.Location, targetTileX, targetTileY);
        var observations = new List<BridgeObservation>
        {
            new(
                $"world-{sequence}",
                "world",
                createdAt,
                null,
                adapter.AdapterId,
                "semantic",
                1,
                new Dictionary<string, JsonElement>
                {
                    ["weather"] = JsonSerializer.SerializeToElement(snapshot.Weather),
                    ["location"] = JsonSerializer.SerializeToElement(snapshot.Location),
                    ["locationDisplayName"] = JsonSerializer.SerializeToElement(
                        string.IsNullOrWhiteSpace(snapshot.LocationDisplayName)
                            ? snapshot.Location
                            : snapshot.LocationDisplayName),
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
                adapter.AdapterId,
                "semantic",
                1,
                new Dictionary<string, JsonElement>
                {
                    ["status"] = JsonSerializer.SerializeToElement(priorOutcome.Status),
                    ["target"] = JsonSerializer.SerializeToElement(adapter.FormatTileTarget(priorOutcome.TargetTileX, priorOutcome.TargetTileY)),
                    ["scope"] = JsonSerializer.SerializeToElement(priorOutcome.Scope),
                }));
        }
        if (snapshot.Self is not null)
        {
            // The farmer's own state: the companion plans as a teammate only if
            // it can see the backpack and purse it plans with. Direct facts
            // only, bounded to MaxInventoryItems entries.
            var self = snapshot.Self;
            observations.Add(new BridgeObservation(
                $"self-{sequence}",
                "self",
                createdAt,
                null,
                adapter.AdapterId,
                "semantic",
                1,
                new Dictionary<string, JsonElement>
                {
                    ["farmerName"] = JsonSerializer.SerializeToElement(self.Name),
                    ["money"] = JsonSerializer.SerializeToElement(self.Money),
                    ["inventorySlotsUsed"] = JsonSerializer.SerializeToElement(self.InventorySlotsUsed),
                    ["inventorySlotCapacity"] = JsonSerializer.SerializeToElement(self.InventorySlotCapacity),
                    ["inventory"] = JsonSerializer.SerializeToElement(
                        self.Items.Select(item => new Dictionary<string, JsonElement>
                        {
                            ["name"] = JsonSerializer.SerializeToElement(item.Name),
                            ["count"] = JsonSerializer.SerializeToElement(item.Count),
                        }).ToArray()),
                    ["inventoryTruncated"] = JsonSerializer.SerializeToElement(self.InventoryTruncated),
                }));
        }

        return new DecisionTurnEnvelope(
            WireVersion,
            sequence,
            createdAt,
            checked(snapshot.Day + 1),
            new BridgeAdapterDescriptor(
                adapter.AdapterId,
                adapter.GameId,
                "semantic",
                Capabilities
                    .Select(capability => new BridgeCapabilityDescriptor(
                        capability.Id,
                        capability.Title,
                        capability.Scope,
                        "semantic",
                        true,
                        true,
                        capability.InputSchemaRef))
                    .ToArray()),
            observations.ToArray(),
            companion,
            growth);
    }

    /// <summary>
    /// Validates the bounded soul rows at the Player writer boundary: counts,
    /// item lengths, and non-empty text, mirroring the TypeScript soul schema
    /// so both bridge sides reject the same malformed personas.
    /// </summary>
    public static void ValidateCompanionSoul(BridgeCompanionSoul soul)
    {
        AssertSoulItems(soul.Values, "values");
        AssertSoulItems(soul.Bonds, "bonds");
        AssertSoulItems(soul.Boundaries, "boundaries");
        if (string.IsNullOrWhiteSpace(soul.Voice) || soul.Voice.Length > MaxSoulVoiceLength)
        {
            throw new InvalidOperationException($"The companion soul voice is required and may contain at most {MaxSoulVoiceLength} characters.");
        }
        if (soul.Values.Length == 0 || soul.Bonds.Length == 0 || soul.Boundaries.Length == 0)
        {
            throw new InvalidOperationException("A companion soul requires values, bonds, voice, and boundaries.");
        }
    }

    private static void AssertSoulItems(string[] items, string field)
    {
        if (items.Length > MaxSoulItems)
        {
            throw new InvalidOperationException($"The companion soul {field} may contain at most {MaxSoulItems} rows.");
        }
        if (items.Any(item => string.IsNullOrWhiteSpace(item) || item.Length > MaxSoulItemLength))
        {
            throw new InvalidOperationException(
                $"Every companion soul {field} row must be non-empty and at most {MaxSoulItemLength} characters.");
        }
    }

    /// <summary>Revalidates one DSH request against the exact Player-authored turn.</summary>
    public static ValidatedDecision ValidateRequest(DecisionTurnEnvelope turn, BridgeActionRequest request)
    {
        if (turn.Version != WireVersion || request.Version != WireVersion)
        {
            throw new InvalidOperationException("Decision bridge version mismatch.");
        }
        AssertSequence(turn.Sequence);
        if (request.Sequence != turn.Sequence ||
            (request.Status != AwaitingPlayerStatus && request.Status != AutonomousStatus))
        {
            throw new InvalidOperationException("Action request does not belong to the current turn.");
        }
        var proposal = request.Proposal;
        var expectedProposalId = $"turn-{turn.Sequence}:proposal";
        if (proposal.Id != expectedProposalId || proposal.CreatedAt != turn.CreatedAt)
        {
            throw new InvalidOperationException("Action request has an invalid proposal identity.");
        }
        CapabilityDefinition capability;
        try
        {
            capability = Capability(proposal.CapabilityId);
        }
        catch (InvalidOperationException)
        {
            throw new InvalidOperationException("Action request selected an unavailable capability.");
        }
        if (!turn.Adapter.Capabilities.Any(advertised => advertised.Id == proposal.CapabilityId))
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
        if (proposal.Scope != capability.Scope || string.IsNullOrWhiteSpace(proposal.Reason) || proposal.Reason.Length > MaxReasonLength)
        {
            throw new InvalidOperationException("Action request exceeds the advertised capability scope.");
        }

        var expectedTarget = GetStringFact(world, "target");
        var location = GetStringFact(world, "location");
        var locationDisplayName = GetStringFact(world, "locationDisplayName");
        if (string.IsNullOrWhiteSpace(proposal.Utterance) ||
            proposal.Utterance.Length > MaxUtteranceLength ||
            !proposal.Utterance.Contains(locationDisplayName, StringComparison.Ordinal) ||
            proposal.Utterance.Contains(expectedTarget, StringComparison.Ordinal) ||
            ContainsTargetCoordinates(proposal.Utterance, expectedTarget))
        {
            throw new InvalidOperationException("Action request has invalid player-facing companion speech.");
        }
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
            proposal.Reason,
            targetTileX,
            targetTileY,
            proposal.Scope,
            proposal.Utterance.Trim(),
            locationDisplayName);
        return new ValidatedDecision(request, gameProposal);
    }

    /// <summary>Creates the explicit player answer persisted before settlement.</summary>
    public static BridgePermissionGrant CreateGrant(BridgeActionRequest request, bool granted, string grantedAt, string expiresAt)
    {
        AssertTimestamp(grantedAt, nameof(grantedAt));
        AssertTimestamp(expiresAt, nameof(expiresAt));
        return new BridgePermissionGrant(request.Proposal.Id, granted, grantedAt, expiresAt);
    }

    /// <summary>
    /// Authorizes one already-validated autonomous request without a player
    /// answer. Only a request that arrived with the autonomous status may take
    /// this lane, and the returned authorization carries the full-autonomy
    /// marker that must survive onto the receipt.
    /// </summary>
    public static DecisionAuthorization AuthorizeAutonomous(
        DecisionTurnEnvelope turn,
        BridgeActionRequest request,
        string occurredAt)
    {
        if (request.Status != AutonomousStatus)
        {
            throw new InvalidOperationException(
                "Autonomous authorization requires an autonomous request; a consult request must be answered by the player.");
        }
        var validated = ValidateRequest(turn, request);
        AssertTimestamp(occurredAt, nameof(occurredAt));
        return new DecisionAuthorization(true, validated, null);
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
    public static DecisionCompletion CompleteGranted(
        DecisionAuthorization authorization,
        bool receiptShown,
        string occurredAt,
        string autonomy = ConsultAutonomy)
    {
        if (!authorization.MayExecute || authorization.TerminalReceipt is not null)
        {
            throw new InvalidOperationException("Only a granted authorization can be completed.");
        }
        if (autonomy != ConsultAutonomy && autonomy != FullAutonomy)
        {
            throw new ArgumentException("Autonomy must be \"consult\" or \"full\".", nameof(autonomy));
        }
        AssertTimestamp(occurredAt, nameof(occurredAt));
        var proposal = authorization.Validated.GameProposal;
        var state = Player2Rules.CreateAcceptedState(proposal, true, receiptShown)
            ?? throw new InvalidOperationException("Granted proposal did not produce retained state.");
        var capability = Capability(authorization.Validated.Request.Proposal.CapabilityId);
        var receipt = CreateReceipt(
            authorization.Validated.Request,
            receiptShown ? "completed" : "failed",
            occurredAt,
            // The exact validated target from the request, never a local
            // reformatting that could drift from what the turn advertised.
            authorization.Validated.Request.Proposal.Intent.Target,
            receiptShown ? capability.GrantedDetail : capability.FailedDetail,
            autonomy);
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
        CapabilityDefinition capability;
        try
        {
            capability = Capability(receipt.CapabilityId);
        }
        catch (InvalidOperationException)
        {
            throw new InvalidOperationException("Persisted receipt names an unavailable capability.");
        }
        if (receipt.ProposalId != $"turn-{turn.Sequence}:proposal" ||
            receipt.Scope != capability.Scope ||
            string.IsNullOrWhiteSpace(receipt.Detail))
        {
            throw new InvalidOperationException("Persisted receipt does not belong to this decision sequence.");
        }
        if (receipt.Autonomy is not null && receipt.Autonomy != FullAutonomy)
        {
            throw new InvalidOperationException("Persisted receipt carries an invalid autonomy marker.");
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
        string detail,
        string autonomy = ConsultAutonomy)
    {
        return new BridgeActionReceipt(
            request.Proposal.Id,
            request.Proposal.CapabilityId,
            status,
            occurredAt,
            target,
            request.Proposal.Scope,
            detail,
            autonomy == FullAutonomy ? FullAutonomy : null);
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

    private static bool TryParseTarget(string target, out string location, out int x, out int y)
    {
        location = string.Empty;
        x = 0;
        y = 0;
        // The target scheme is adapter vocabulary (see AdapterProfile); the
        // parse is scheme-agnostic because the Player side authored the
        // target fact itself and the request must match it verbatim.
        var schemeEnd = target.IndexOf(':', StringComparison.Ordinal);
        if (schemeEnd <= 0)
        {
            return false;
        }
        var remainder = target[(schemeEnd + 1)..];
        var separator = remainder.IndexOf(":tile:", StringComparison.Ordinal);
        if (separator <= 0)
        {
            return false;
        }
        location = remainder[..separator];
        var coordinates = remainder[(separator + ":tile:".Length)..].Split(',');
        return coordinates.Length == 2 &&
            int.TryParse(coordinates[0], NumberStyles.None, CultureInfo.InvariantCulture, out x) &&
            int.TryParse(coordinates[1], NumberStyles.None, CultureInfo.InvariantCulture, out y) &&
            x >= 0 && y >= 0;
    }

    private static bool ContainsTargetCoordinates(string utterance, string target)
    {
        if (!TryParseTarget(target, out _, out var x, out var y))
        {
            return false;
        }
        var coordinate = $"{x},{y}";
        var spacedCoordinate = $"{x}, {y}";
        var chineseCoordinate = $"{x}，{y}";
        return utterance.Contains(coordinate, StringComparison.Ordinal) ||
            utterance.Contains(spacedCoordinate, StringComparison.Ordinal) ||
            utterance.Contains(chineseCoordinate, StringComparison.Ordinal);
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
        // The TypeScript contracts accept only UTC "Z" timestamps; accepting
        // offsets here would let both ends disagree until the schema rejects it.
        if (!value.EndsWith("Z", StringComparison.Ordinal)
            || !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            || parsed.Offset != TimeSpan.Zero)
        {
            throw new ArgumentException("Decision timestamps must be UTC ISO-8601 values ending in 'Z'.", name);
        }
    }
}

public sealed record BridgeCapabilityDescriptor(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("scope")] string Scope,
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

/// <summary>The player-chosen companion identity carried on one decision turn.</summary>
public sealed record BridgeCompanionIdentity(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("soul")] BridgeCompanionSoul Soul);

/// <summary>
/// Player-authored stable persona commitments: the soul layer of the
/// companion's five-layer personality. Bound once per composition on the DSH
/// side; turn data may refine the surface identity but never these rows.
/// </summary>
public sealed record BridgeCompanionSoul(
    [property: JsonPropertyName("values")] string[] Values,
    [property: JsonPropertyName("bonds")] string[] Bonds,
    [property: JsonPropertyName("voice")] string Voice,
    [property: JsonPropertyName("boundaries")] string[] Boundaries);

public sealed record DecisionTurnEnvelope(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sequence")] int Sequence,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("gameDay")] int GameDay,
    [property: JsonPropertyName("adapter")] BridgeAdapterDescriptor Adapter,
    [property: JsonPropertyName("observations")] BridgeObservation[] Observations,
    [property: JsonPropertyName("companion")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    BridgeCompanionIdentity? Companion = null,
    [property: JsonPropertyName("growth")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    BridgeGrowthAsset? Growth = null);

/// <summary>One receipt-grounded insight the companion drew about itself.</summary>
public sealed record BridgeGrowthInsight(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("basedOnReceiptSequences")] int[] BasedOnReceiptSequences,
    [property: JsonPropertyName("createdAt")] string CreatedAt);

/// <summary>
/// The Player-owned growth asset: the companion's self-authored interpretation
/// of its receipt-backed shared history, applied only from validated reflect
/// proposals. There is deliberately no soul field — the deposit-model ruling
/// keeps the soul read-only, and this type makes that structurally true.
/// </summary>
public sealed record BridgeGrowthAsset(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("revision")] int Revision,
    [property: JsonPropertyName("insights")] BridgeGrowthInsight[] Insights,
    [property: JsonPropertyName("focus")] string? Focus);

/// <summary>One bounded model-authored insight awaiting Player validation.</summary>
public sealed record BridgeGrowthProposalInsight(
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("basedOnReceiptSequences")] int[] BasedOnReceiptSequences);

/// <summary>
/// A DSH-authored, write-once growth proposal for one decision turn. Like an
/// action request it is data for Player validation — it never changes the
/// companion's soul, tools, or authority from the DSH side.
/// </summary>
public sealed record BridgeGrowthProposal(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sequence")] int Sequence,
    [property: JsonPropertyName("insights")] BridgeGrowthProposalInsight[] Insights,
    [property: JsonPropertyName("focus")] string? Focus);

public sealed record BridgeProposalIntent([property: JsonPropertyName("target")] string Target);

public sealed record BridgeProposal(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("basedOnObservationIds")] string[] BasedOnObservationIds,
    [property: JsonPropertyName("capabilityId")] string CapabilityId,
    [property: JsonPropertyName("intent")] BridgeProposalIntent Intent,
    [property: JsonPropertyName("scope")] string Scope,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("utterance")] string Utterance = "");

public sealed record BridgeActionRequest(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sequence")] int Sequence,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("proposal")] BridgeProposal Proposal);

/// <summary>Terminal DSH-host failure for a decision sequence, surfaced directly to the developer.</summary>
public sealed record BridgeRuntimeError(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("sequence")] int Sequence,
    [property: JsonPropertyName("traceId")] string TraceId,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message);

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
    [property: JsonPropertyName("detail")] string Detail,
    [property: JsonPropertyName("autonomy")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Autonomy = null);

public sealed record ValidatedDecision(BridgeActionRequest Request, Proposal GameProposal);

public sealed record DecisionAuthorization(bool MayExecute, ValidatedDecision Validated, BridgeActionReceipt? TerminalReceipt);

public sealed record DecisionCompletion(AcceptedState State, BridgeActionReceipt Receipt);
