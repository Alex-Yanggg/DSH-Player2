using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class CompanionSettlementStoreTests
{
    private readonly Dictionary<string, string> state = new();

    [Fact]
    public void ReservesOneSequencePerGameDayAndReusesItAfterRestart()
    {
        var allocations = 0;
        int NextSequence()
        {
            allocations++;
            return 100 + allocations;
        }

        var first = CompanionSettlementStore.ResolveSequence(new DictionaryKeyValueState(this.state), 3, NextSequence);
        var reused = CompanionSettlementStore.ResolveSequence(new DictionaryKeyValueState(this.state), 3, NextSequence);

        Assert.Equal(first, reused);
        Assert.Equal(1, allocations);
        Assert.Equal("3", this.state[CompanionSettlementStore.PendingGameDayKey]);
    }

    [Fact]
    public void MarkSettledRecordsTheSequenceAndClearsTheReservation()
    {
        var state = new DictionaryKeyValueState(this.state);
        CompanionSettlementStore.ResolveSequence(state, 3, () => 42);
        CompanionSettlementStore.MarkSettled(state, 42, 3);

        Assert.Equal("42", this.state[CompanionSettlementStore.SettledSequenceKey]);
        Assert.Equal("3", this.state[CompanionSettlementStore.SettledGameDayKey]);
        Assert.False(this.state.ContainsKey(CompanionSettlementStore.PendingSequenceKey));
        Assert.True(CompanionSettlementStore.IsGameDaySettled(state, 3));
        Assert.True(CompanionSettlementStore.IsGameDaySettled(state, 2));
        Assert.False(CompanionSettlementStore.IsGameDaySettled(state, 4));
    }

    [Fact]
    public void LegacyDayEqualsSequenceSavesStaySettledDuringMigration()
    {
        this.state[CompanionSettlementStore.SettledSequenceKey] = "7";

        Assert.True(CompanionSettlementStore.IsGameDaySettled(new DictionaryKeyValueState(this.state), 7));
        Assert.False(CompanionSettlementStore.IsGameDaySettled(new DictionaryKeyValueState(this.state), 8));
    }

    [Fact]
    public void ClearSettlementReopensTheDayForAnExplicitRetry()
    {
        var state = new DictionaryKeyValueState(this.state);
        CompanionSettlementStore.MarkSettled(state, 42, 3);

        CompanionSettlementStore.ClearSettlement(state);

        Assert.False(CompanionSettlementStore.IsGameDaySettled(state, 3));
        Assert.False(this.state.ContainsKey(CompanionSettlementStore.SettledSequenceKey));
    }
}

public sealed class DevelopmentLogWriterTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-devlog-{Guid.NewGuid():N}");

    [Fact]
    public void AppendsOneValidJsonlEntryPerCall()
    {
        DevelopmentLogWriter.Append(this.root, "SOME_CODE", "trace-1", "something happened", 12);
        DevelopmentLogWriter.Append(this.root, "OTHER_CODE", "trace-2", "again", null);

        var lines = File.ReadAllLines(Path.Combine(this.root, "development-logs", DevelopmentLogWriter.FileName));
        Assert.Equal(2, lines.Length);
        var first = JsonDocument.Parse(lines[0]).RootElement;
        Assert.Equal("SOME_CODE", first.GetProperty("code").GetString());
        Assert.Equal("trace-1", first.GetProperty("traceId").GetString());
        Assert.Equal(12, first.GetProperty("gameDay").GetInt32());
        var second = JsonDocument.Parse(lines[1]).RootElement;
        Assert.True(second.GetProperty("gameDay").ValueKind is JsonValueKind.Null);
    }

    [Fact]
    public void RefusesAnEmptyBridgeDirectory()
    {
        Assert.Throws<ArgumentException>(() => DevelopmentLogWriter.Append("", "CODE", "trace", "message", null));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root)) Directory.Delete(this.root, true);
    }
}
