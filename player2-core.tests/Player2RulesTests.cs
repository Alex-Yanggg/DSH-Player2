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
    public void NativeProposalDisplaysPersonaUtteranceVerbatimWithoutCoordinatesOrTemplate()
    {
        const string utterance = "雨停之前，我想在农舍陪你把今天的小计划想清楚，可以吗？";
        var proposal = new Proposal(
            1,
            "clear",
            "FarmHouse",
            "I only know the current weather and location.",
            12,
            8,
            "temporary visual receipt only",
            utterance,
            "农舍");

        var rendered = Player2Rules.FormatProposal(proposal);

        Assert.Equal(utterance, rendered);
        Assert.DoesNotContain("12", rendered);
        Assert.DoesNotContain("范围", rendered);
    }

    [Fact]
    public void ProposalPresentationNeverWrapsTheNativeUtterance()
    {
        var proposal = new Proposal(
            1,
            "clear",
            "FarmHouse",
            "A grounded DSH reason.",
            12,
            8,
            "temporary visual receipt only",
            "The Farm is quiet this morning; may I stand with you for a moment?",
            "Farm");

        var english = Player2Rules.FormatProposal(proposal, "Rowan", "clear");
        var fallback = Player2Rules.FormatProposal(proposal, "  ", "clear");

        Assert.Equal(proposal.Utterance, english);
        Assert.Equal(proposal.Utterance, fallback);
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
