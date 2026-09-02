using System;
using System.Linq;
using System.Text.Json;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class Player2RulesTests
{
    [Fact]
    public void SnapshotContainsOnlyDirectGameFactsAndNeverInventsATask()
    {
        var snapshot = Player2Rules.CreateSnapshot(0, "clear", "FarmHouse");

        Assert.Equal(0, snapshot.Day);
        Assert.Equal("clear", snapshot.Weather);
        Assert.Equal("FarmHouse", snapshot.Location);
        Assert.DoesNotContain("task", JsonSerializer.Serialize(snapshot), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("crop", JsonSerializer.Serialize(snapshot), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void NativeProposalDisplaysItsOwnGroundedReasonWithoutALocalGoal()
    {
        var proposal = new Proposal(1, "clear", "FarmHouse", "I only know the current weather and location, so I suggest meeting here first.", 12, 8, "temporary visual receipt only");

        var rendered = Player2Rules.FormatProposal(proposal, "Kai", "雨天", Player2TextSet.SimplifiedChinese);

        Assert.Contains(proposal.Reason, rendered);
        Assert.Contains("Kai基于当前信息的理由", rendered);
        Assert.Contains("地块（12，8）", rendered);
    }

    [Fact]
    public void ProposalRendersTheCompanionIdentityInsteadOfATemplateDefault()
    {
        var proposal = new Proposal(1, "clear", "FarmHouse", "A grounded DSH reason.", 12, 8, "temporary visual receipt only");

        var english = Player2Rules.FormatProposal(proposal, "Rowan", "clear");
        var fallback = Player2Rules.FormatProposal(proposal, "  ", "clear");

        Assert.Contains("Rowan's grounded reason: A grounded DSH reason.", english);
        Assert.Contains("Player2's grounded reason: A grounded DSH reason.", fallback);
    }

    [Fact]
    public void OnlyTheImmediatelyPriorCompatibleOutcomeCanBeRecalled()
    {
        var outcome = new SharedOutcome(Player2Rules.StateVersion, 41, 12, 8, "temporary visual receipt only", "completed");

        Assert.Equal(outcome, Player2Rules.GetYesterdayOutcome(outcome, 42));
        Assert.Null(Player2Rules.GetYesterdayOutcome(outcome, 41));
        Assert.Null(Player2Rules.GetYesterdayOutcome(outcome with { Day = 40 }, 42));
        Assert.Null(Player2Rules.GetYesterdayOutcome(outcome with { Version = 2 }, 42));
    }

    [Fact]
    public void AgreementCreatesPlayerOwnedOutcomeFromTheNativeReason()
    {
        var proposal = new Proposal(1, "clear", "FarmHouse", "A grounded DSH reason.", 12, 8, "temporary visual receipt only");
        var accepted = Player2Rules.CreateAcceptedState(proposal, true, true);

        Assert.NotNull(accepted);
        Assert.Equal("A grounded DSH reason.", accepted!.Commitment.Goal);
        Assert.Equal("completed", accepted.Outcome.Status);
    }

    [Fact]
    public void TranscriptCapsItsHistoryAndRecallsTheLastPlayerLine()
    {
        var transcript = new ChatTranscript();
        for (var day = 0; day < ChatTranscript.MaxLines + 5; day++)
        {
            transcript.Append("Mira", $"turn {day}");
            transcript.Append("Alex", $"hello {day}");
        }

        Assert.Equal(ChatTranscript.MaxLines, transcript.Lines.Count);
        Assert.Equal("hello 54", transcript.LastPlayerLine("Alex")?.Text);
        Assert.Equal("turn 54", transcript.LastPlayerLine("Mira")?.Text);
    }

    [Fact]
    public void TranscriptRoundTripsThroughItsPersistenceShape()
    {
        var transcript = new ChatTranscript();
        transcript.Append("Alex", "你好");
        transcript.Append("Mira", "我只会在原生 DSH 反馈后回答。");

        var restored = ChatTranscript.Import(transcript.Export());

        Assert.Equal(transcript.Lines, restored.Lines);
        Assert.Throws<ArgumentException>(() => transcript.Append("", "still here"));
        Assert.Equal("我只会在原生 DSH 反馈后回答。", restored.Lines.Last().Text);
    }
}
