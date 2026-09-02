using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class DecisionBridgeRulesTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    [Fact]
    public void GoldenTypeScriptRequestAuthorizesAndCompletesOneReceipt()
    {
        var (turn, request) = LoadGolden();
        var validated = DecisionBridgeRules.ValidateRequest(turn, request);
        var grant = DecisionBridgeRules.CreateGrant(
            request,
            true,
            "2026-08-29T00:00:01.000Z",
            "2026-08-29T00:05:00.000Z");

        var authorization = DecisionBridgeRules.Authorize(turn, request, grant, "2026-08-29T00:00:02.000Z");
        var completion = DecisionBridgeRules.CompleteGranted(authorization, true, "2026-08-29T00:00:03.000Z");

        Assert.True(authorization.MayExecute);
        Assert.Equal(12, validated.GameProposal.TargetTileX);
        Assert.Equal(8, validated.GameProposal.TargetTileY);
        Assert.Equal("completed", completion.Receipt.Status);
        Assert.Equal("stardew-location:Farm:tile:12,8", completion.Receipt.Target);
        Assert.Equal("completed", completion.State.Outcome.Status);
    }

    [Fact]
    public void DeclineProducesTerminalReceiptWithoutExecutableAuthorization()
    {
        var (turn, request) = LoadGolden();
        var grant = DecisionBridgeRules.CreateGrant(
            request,
            false,
            "2026-08-29T00:00:01.000Z",
            "2026-08-29T00:05:00.000Z");

        var authorization = DecisionBridgeRules.Authorize(turn, request, grant, "2026-08-29T00:00:02.000Z");

        Assert.False(authorization.MayExecute);
        Assert.Equal("declined", authorization.TerminalReceipt?.Status);
        Assert.Throws<InvalidOperationException>(() =>
            DecisionBridgeRules.CompleteGranted(authorization, false, "2026-08-29T00:00:03.000Z"));
    }

    [Theory]
    [InlineData("sequence")]
    [InlineData("proposal")]
    [InlineData("capability")]
    [InlineData("target")]
    [InlineData("grounding")]
    public void InvalidRequestsNeverReachAuthorization(string mutation)
    {
        var (turn, request) = LoadGolden();
        request = mutation switch
        {
            "sequence" => request with { Sequence = 13 },
            "proposal" => request with { Proposal = request.Proposal with { Id = "turn-12:other" } },
            "capability" => request with { Proposal = request.Proposal with { CapabilityId = "water-everything" } },
            "target" => request with { Proposal = request.Proposal with { Intent = new BridgeProposalIntent("stardew-location:Farm:tile:99,99") } },
            "grounding" => request with { Proposal = request.Proposal with { BasedOnObservationIds = new[] { "invented" } } },
            _ => throw new ArgumentOutOfRangeException(nameof(mutation)),
        };

        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateRequest(turn, request));
    }

    [Fact]
    public void CreatedTurnCarriesOnlyOneEligibleYesterdayOutcome()
    {
        var outcome = new SharedOutcome(1, 11, 12, 8, DecisionBridgeRules.AllowedScope, "completed");
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley, 
            new WorldSnapshot(12, "rain", "Farm"),
            13,
            "2026-08-29T00:00:00.000Z",
            12,
            8,
            outcome);

        Assert.Equal(2, turn.Observations.Length);
        Assert.Equal("action-result", turn.Observations[1].Kind);
        Assert.Equal(DecisionBridgeRules.CapabilityId, turn.Adapter.Capabilities[0].Id);
    }

    [Fact]
    public void CreatedTurnCarriesThePlayerChosenCompanionIdentity()
    {
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley, 
            new WorldSnapshot(12, "rain", "Farm"),
            12,
            "2026-08-29T00:00:00.000Z",
            12,
            8,
            yesterdayOutcome: null,
            companion: new BridgeCompanionIdentity("Mira", "the player's candid farm partner", CuteSoul()));

        Assert.Equal("Mira", turn.Companion?.Name);
        var serialized = JsonSerializer.Serialize(turn, new JsonSerializerOptions());
        Assert.Contains("\"companion\"", serialized);

        var anonymous = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley, 
            new WorldSnapshot(12, "rain", "Farm"),
            12,
            "2026-08-29T00:00:00.000Z",
            12,
            8,
            yesterdayOutcome: null);
        var serializedAnonymous = JsonSerializer.Serialize(anonymous, new JsonSerializerOptions());
        Assert.DoesNotContain("\"companion\"", serializedAnonymous);
    }

    [Fact]
    public void CompanionSoulRoundTripsBesideTheIdentity()
    {
        var soul = new BridgeCompanionSoul(
            new[] { "honesty before comfort, including about the player's own plans" },
            new[] { "the player's trust, earned one receipt at a time" },
            "Direct and warm with dry humor.",
            new[] { "never claims an action happened without a receipt proving it" });
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley, 
            new WorldSnapshot(12, "rain", "Farm"),
            12,
            "2026-08-29T00:00:00.000Z",
            12,
            8,
            yesterdayOutcome: null,
            companion: new BridgeCompanionIdentity("Mira", "the player's candid farm partner", soul));

        var serialized = JsonSerializer.Serialize(turn, new JsonSerializerOptions());
        Assert.Contains("\"soul\"", serialized);
        var deserialized = JsonSerializer.Deserialize<DecisionTurnEnvelope>(serialized);
        var roundTripped = deserialized?.Companion?.Soul;
        Assert.NotNull(roundTripped);
        Assert.Equal(soul.Values, roundTripped!.Values);
        Assert.Equal(soul.Bonds, roundTripped.Bonds);
        Assert.Equal(soul.Voice, roundTripped.Voice);
        Assert.Equal(soul.Boundaries, roundTripped.Boundaries);

    }

    [Fact]
    public void CompanionSoulValidationRejectsMalformedRows()
    {
        var tooManyRows = new BridgeCompanionSoul(
            Enumerable.Repeat("a row", DecisionBridgeRules.MaxSoulItems + 1).ToArray(),
            Array.Empty<string>(), "voice", Array.Empty<string>());
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateCompanionSoul(tooManyRows));

        var rowTooLong = new BridgeCompanionSoul(
            new[] { new string('x', DecisionBridgeRules.MaxSoulItemLength + 1) },
            Array.Empty<string>(), "voice", Array.Empty<string>());
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateCompanionSoul(rowTooLong));

        var voiceTooLong = new BridgeCompanionSoul(
            Array.Empty<string>(), Array.Empty<string>(), new string('x', DecisionBridgeRules.MaxSoulVoiceLength + 1), Array.Empty<string>());
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateCompanionSoul(voiceTooLong));

        var withoutCommitments = new BridgeCompanionSoul(Array.Empty<string>(), Array.Empty<string>(), "   ", Array.Empty<string>());
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateCompanionSoul(withoutCommitments));

        var blankRow = new BridgeCompanionSoul(new[] { " " }, Array.Empty<string>(), "voice", Array.Empty<string>());
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateCompanionSoul(blankRow));
    }

    [Fact]
    public void RecoveryRejectsAReceiptThatDoesNotBelongToTheSequence()
    {
        var receipt = new BridgeActionReceipt(
            "turn-99:proposal",
            DecisionBridgeRules.CapabilityId,
            "completed",
            "2026-08-29T00:00:03.000Z",
            "stardew-location:Farm:tile:12,8",
            DecisionBridgeRules.AllowedScope,
            "A temporary world marker was shown.");

        var (turn, _) = LoadGolden();
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateReceipt(turn, receipt));
    }

    [Fact]
    public void RecoveryRejectsAReceiptForAnotherTarget()
    {
        var (turn, request) = LoadGolden();
        var grant = DecisionBridgeRules.CreateGrant(
            request,
            true,
            "2026-08-29T00:00:01.000Z",
            "2026-08-29T00:05:00.000Z");
        var authorization = DecisionBridgeRules.Authorize(turn, request, grant, "2026-08-29T00:00:02.000Z");
        var receipt = DecisionBridgeRules.CompleteGranted(
            authorization,
            true,
            "2026-08-29T00:00:03.000Z").Receipt with
        {
            Target = "stardew-location:Town:tile:12,8",
        };

        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateReceipt(turn, receipt));
    }

    [Fact]
    public void AdvertisesAndValidatesThePresenceCapabilityWithItsOwnScope()
    {
        var createdAt = "2026-08-29T00:00:00.000Z";
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley, 
            new WorldSnapshot(12, "rain", "Farm"),
            12,
            createdAt,
            12,
            8,
            yesterdayOutcome: null);
        Assert.Equal(
            new[] { DecisionBridgeRules.CapabilityId, DecisionBridgeRules.CompanionPresence.Id },
            turn.Adapter.Capabilities.Select(capability => capability.Id).ToArray());

        var presenceRequest = new BridgeActionRequest(
            DecisionBridgeRules.WireVersion,
            12,
            DecisionBridgeRules.AwaitingPlayerStatus,
            new BridgeProposal(
                "turn-12:proposal",
                createdAt,
                new[] { "world-12" },
                DecisionBridgeRules.CompanionPresence.Id,
                new BridgeProposalIntent("stardew-location:Farm:tile:12,8"),
                DecisionBridgeRules.CompanionPresence.Scope,
                "Standing nearby makes planning easier."));
        var grant = DecisionBridgeRules.CreateGrant(
            presenceRequest,
            true,
            "2026-08-29T00:00:01.000Z",
            "2026-08-29T00:05:00.000Z");
        var authorization = DecisionBridgeRules.Authorize(turn, presenceRequest, grant, "2026-08-29T00:00:02.000Z");
        var receipt = DecisionBridgeRules.CompleteGranted(authorization, true, "2026-08-29T00:00:03.000Z").Receipt;

        Assert.True(authorization.MayExecute);
        Assert.Equal(DecisionBridgeRules.CompanionPresence.GrantedDetail, receipt.Detail);
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateRequest(
            turn,
            presenceRequest with { Proposal = presenceRequest.Proposal with { Scope = DecisionBridgeRules.AllowedScope } }));
    }

    [Fact]
    public void AutonomousRequestAuthorizesExecutionAndMarksTheReceipt()
    {
        var (turn, request) = LoadGolden();
        var autonomous = request with { Status = DecisionBridgeRules.AutonomousStatus };

        var occurredAt = "2026-08-29T00:00:02.000Z";
        var authorization = DecisionBridgeRules.AuthorizeAutonomous(turn, autonomous, occurredAt);
        var completion = DecisionBridgeRules.CompleteGranted(
            authorization,
            receiptShown: true,
            "2026-08-29T00:00:03.000Z",
            DecisionBridgeRules.FullAutonomy);

        Assert.True(authorization.MayExecute);
        Assert.Equal("completed", completion.Receipt.Status);
        Assert.Equal(DecisionBridgeRules.FullAutonomy, completion.Receipt.Autonomy);
        Assert.Equal(
            DecisionBridgeRules.FullAutonomy,
            JsonSerializer.Deserialize<BridgeActionReceipt>(
                JsonSerializer.Serialize(completion.Receipt, new JsonSerializerOptions()), JsonOptions)?.Autonomy);
    }

    [Fact]
    public void ConsultReceiptsCarryNoAutonomyMarkerAndAutonomousLaneRejectsConsultRequests()
    {
        var (turn, request) = LoadGolden();
        var grant = DecisionBridgeRules.CreateGrant(request, true, "2026-08-29T00:00:01.000Z", "2026-08-29T00:05:00.000Z");
        var authorization = DecisionBridgeRules.Authorize(turn, request, grant, "2026-08-29T00:00:02.000Z");
        var consultReceipt = DecisionBridgeRules.CompleteGranted(authorization, true, "2026-08-29T00:00:03.000Z").Receipt;
        Assert.Null(consultReceipt.Autonomy);

        Assert.Throws<InvalidOperationException>(() =>
            DecisionBridgeRules.AuthorizeAutonomous(turn, request, "2026-08-29T00:00:02.000Z"));
    }

    [Fact]
    public void ValidateRequestRejectsAnUnknownStatusAndCompleteGrantedRejectsAnUnknownAutonomy()
    {
        var (turn, request) = LoadGolden();
        Assert.Throws<InvalidOperationException>(() =>
            DecisionBridgeRules.ValidateRequest(turn, request with { Status = "auto-approved" }));

        var autonomous = request with { Status = DecisionBridgeRules.AutonomousStatus };
        var authorization = DecisionBridgeRules.AuthorizeAutonomous(turn, autonomous, "2026-08-29T00:00:02.000Z");
        Assert.Throws<ArgumentException>(() =>
            DecisionBridgeRules.CompleteGranted(authorization, true, "2026-08-29T00:00:03.000Z", "unbounded"));
    }

    [Fact]
    public void RecoveryAcceptsAnAutonomousPresenceReceiptForItsOwnCapability()
    {
        var (turn, _) = LoadGolden();
        var presenceReceipt = new BridgeActionReceipt(
            "turn-12:proposal",
            DecisionBridgeRules.CompanionPresence.Id,
            "completed",
            "2026-08-29T00:00:03.000Z",
            "stardew-location:Farm:tile:12,8",
            DecisionBridgeRules.CompanionPresence.Scope,
            DecisionBridgeRules.CompanionPresence.GrantedDetail,
            DecisionBridgeRules.FullAutonomy);

        Assert.Equal(
            DecisionBridgeRules.CompanionPresence.Id,
            DecisionBridgeRules.ValidateReceipt(turn, presenceReceipt).CapabilityId);

        var forged = presenceReceipt with { Autonomy = "consult" };
        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateReceipt(turn, forged));
    }

    [Fact]
    public void CreatedTurnCarriesBoundedFarmerFacts()
    {
        var items = Enumerable.Range(1, 15).Select(index => new InventoryItemSnapshot($"Item {index}", index)).ToArray();
        var snapshot = Player2Rules.CreateSnapshot(
            12,
            "rain",
            "Farm",
            Player2Rules.CreateFarmerSnapshot("Alex", 1250, 15, 24, items));
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley, 
            snapshot,
            12,
            "2026-08-29T00:00:00.000Z",
            12,
            8,
            yesterdayOutcome: null);

        var self = Assert.Single(turn.Observations, observation => observation.Kind == "self");
        Assert.Equal("self-12", self.Id);
        Assert.Equal("Alex", self.Facts["farmerName"].GetString());
        Assert.Equal(1250, self.Facts["money"].GetInt32());
        Assert.Equal(24, self.Facts["inventorySlotCapacity"].GetInt32());
        var inventory = self.Facts["inventory"];
        Assert.Equal(DecisionBridgeRules.MaxInventoryItems, inventory.GetArrayLength());
        Assert.True(self.Facts["inventoryTruncated"].GetBoolean());
    }

    [Fact]
    public void FarmerSnapshotRejectsMalformedFactsAndClipsLongNames()
    {
        var longName = new string('x', DecisionBridgeRules.MaxItemNameLength + 10);
        var bounded = Player2Rules.CreateFarmerSnapshot("Alex", 10, 1, 12, new[] { new InventoryItemSnapshot(longName, 1) });
        Assert.Equal(DecisionBridgeRules.MaxItemNameLength, bounded.Items[0].Name.Length);

        Assert.Throws<ArgumentException>(() =>
            Player2Rules.CreateFarmerSnapshot(" ", 10, 1, 12, Array.Empty<InventoryItemSnapshot>()));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            Player2Rules.CreateFarmerSnapshot("Alex", -1, 1, 12, Array.Empty<InventoryItemSnapshot>()));
    }

    private static (DecisionTurnEnvelope Turn, BridgeActionRequest Request) LoadGolden()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "fixtures", "stardew-visual-receipt.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var turn = document.RootElement.GetProperty("turn").Deserialize<DecisionTurnEnvelope>(JsonOptions)
            ?? throw new InvalidOperationException("Golden fixture has no turn.");
        var request = document.RootElement.GetProperty("expectedRequest").Deserialize<BridgeActionRequest>(JsonOptions)
            ?? throw new InvalidOperationException("Golden fixture has no request.");
        return (turn, request);
    }

    private static BridgeCompanionSoul CuteSoul()
    {
        return new BridgeCompanionSoul(
            new[] { "curiosity and kindness" },
            new[] { "the player as an equal friend" },
            "Bright, gently playful, and honest.",
            new[] { "never invents facts or completed actions" });
    }
}
