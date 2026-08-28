using System.Text.Json;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class Player2RulesTests
{
    [Fact]
    public void RainSnapshotCreatesMinePreparationProposal()
    {
        var snapshot = Player2Rules.CreateSnapshot(42, "rain", "Farm");
        var proposal = Player2Rules.CreateProposal(snapshot, 12, 8);

        Assert.Equal("crops do not need watering today", snapshot.PendingTask);
        Assert.Equal("prepare tomorrow's mine supplies", proposal.Goal);
        Assert.Equal("rain removes today's watering pressure", proposal.Reason);
        Assert.Equal(12, proposal.TargetTileX);
        Assert.Equal(8, proposal.TargetTileY);
    }

    [Fact]
    public void ClearSnapshotCreatesCropAttentionProposal()
    {
        var snapshot = Player2Rules.CreateSnapshot(42, "clear", "Farm");
        var proposal = Player2Rules.CreateProposal(snapshot, 12, 8);

        Assert.Equal("nearby crops may still need attention", snapshot.PendingTask);
        Assert.Equal("keep three nearby crops in view before anything else", proposal.Goal);
        Assert.Equal("clear weather leaves crop care visible", proposal.Reason);
    }

    [Fact]
    public void PermissionTextNamesTargetScopeAndNonMutationBoundary()
    {
        var proposal = Player2Rules.CreateProposal(
            Player2Rules.CreateSnapshot(42, "rain", "Farm"),
            12,
            8);

        var text = Player2Rules.FormatProposal(proposal);

        Assert.Contains("tile 12, 8", text);
        Assert.Contains("No crops, inventory, map, or multiplayer state will change.", text);
        Assert.Contains("May I do that?", text);
    }

    [Theory]
    [InlineData(true, "completed")]
    [InlineData(false, "failed")]
    public void OutcomeReportsWhetherTheWorldReceiptWasShown(bool receiptShown, string expectedStatus)
    {
        var proposal = Player2Rules.CreateProposal(
            Player2Rules.CreateSnapshot(42, "clear", "Farm"),
            12,
            8);

        var outcome = Player2Rules.CreateOutcome(proposal, receiptShown);

        Assert.Equal(Player2Rules.StateVersion, outcome.Version);
        Assert.Equal(expectedStatus, outcome.Status);
        Assert.Equal(proposal.Scope, outcome.Scope);
    }

    [Fact]
    public void OnlyTheImmediatelyPriorCompatibleOutcomeCanBeRecalled()
    {
        var proposal = Player2Rules.CreateProposal(
            Player2Rules.CreateSnapshot(42, "clear", "Farm"),
            12,
            8);
        var yesterday = Player2Rules.CreateOutcome(proposal, true);
        var old = yesterday with { Day = 40 };
        var incompatible = yesterday with { Version = Player2Rules.StateVersion + 1 };

        Assert.Equal(yesterday, Player2Rules.GetYesterdayOutcome(yesterday, 43));
        Assert.Null(Player2Rules.GetYesterdayOutcome(yesterday, 42));
        Assert.Null(Player2Rules.GetYesterdayOutcome(old, 43));
        Assert.Null(Player2Rules.GetYesterdayOutcome(incompatible, 43));
    }

    [Fact]
    public void AgreementCreatesBothStateRecordsWithTheSameTargetAndScope()
    {
        var proposal = Player2Rules.CreateProposal(
            Player2Rules.CreateSnapshot(42, "rain", "Farm"),
            12,
            8);

        var acceptedState = Player2Rules.CreateAcceptedState(proposal, playerAgreed: true, receiptShown: true);

        Assert.NotNull(acceptedState);
        var commitment = acceptedState.Commitment;
        var outcome = acceptedState.Outcome;

        Assert.Equal(Player2Rules.StateVersion, commitment.Version);
        Assert.Equal(commitment.TargetTileX, outcome.TargetTileX);
        Assert.Equal(commitment.TargetTileY, outcome.TargetTileY);
        Assert.Equal(commitment.Scope, outcome.Scope);
    }

    [Fact]
    public void RefusalCreatesNoRetainedState()
    {
        var proposal = Player2Rules.CreateProposal(
            Player2Rules.CreateSnapshot(42, "clear", "Farm"),
            12,
            8);

        var acceptedState = Player2Rules.CreateAcceptedState(proposal, playerAgreed: false, receiptShown: false);

        Assert.Null(acceptedState);
    }

    [Fact]
    public void RetainedStateRoundTripsThroughJson()
    {
        var proposal = Player2Rules.CreateProposal(
            Player2Rules.CreateSnapshot(42, "rain", "Farm"),
            12,
            8);
        var acceptedState = Player2Rules.CreateAcceptedState(proposal, playerAgreed: true, receiptShown: true);

        Assert.NotNull(acceptedState);
        var commitment = JsonSerializer.Deserialize<Commitment>(JsonSerializer.Serialize(acceptedState.Commitment));
        var outcome = JsonSerializer.Deserialize<SharedOutcome>(JsonSerializer.Serialize(acceptedState.Outcome));

        Assert.Equal(acceptedState.Commitment, commitment);
        Assert.Equal(acceptedState.Outcome, outcome);
    }

    [Theory]
    [InlineData("为什么？", "reply")]
    [InlineData("今天该做什么？", "suggestion")]
    [InlineData("去浇水吧", "disagreement")]
    [InlineData("你好", "question")]
    public void TextFallbackSelectsAnActionlessSocialResponse(string message, string expectedKind)
    {
        var snapshot = Player2Rules.CreateSnapshot(42, "rain", "Farm");

        var reply = Player2Rules.CreateSocialReply(snapshot, message, null);

        Assert.Equal(expectedKind, reply.Kind);
        Assert.NotEmpty(reply.Text);
    }

    [Fact]
    public void TextFallbackCanRecallOnlyYesterdayOutcome()
    {
        var snapshot = Player2Rules.CreateSnapshot(42, "clear", "Farm");
        var yesterday = Player2Rules.CreateOutcome(
            Player2Rules.CreateProposal(Player2Rules.CreateSnapshot(41, "rain", "Farm"), 12, 8),
            true);

        var reply = Player2Rules.CreateSocialReply(snapshot, "hello", yesterday);

        Assert.Equal("reply", reply.Kind);
        Assert.True(reply.RecallsYesterdayOutcome);
    }
}
