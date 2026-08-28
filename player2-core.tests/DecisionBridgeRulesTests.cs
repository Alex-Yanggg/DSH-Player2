using System;
using System.IO;
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
        var turn = DecisionBridgeRules.CreateTurn(
            new WorldSnapshot(12, "rain", "Farm", "prepare supplies"),
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

        Assert.Throws<InvalidOperationException>(() => DecisionBridgeRules.ValidateReceipt(12, receipt));
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
}
