using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

/// <summary>P2-0015 plumbing: growth intake, latency trace lines, and the mouth warm-up handshake.</summary>
public sealed class W0BaselineTests : IDisposable
{
    private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-w0-{Guid.NewGuid():N}");

    [Fact]
    public async Task GrowthIntakeAppliesReflectAndDreamProposalsInSequenceOrder()
    {
        var outbox = Path.Combine(this.root, "outbox");
        Directory.CreateDirectory(outbox);
        WriteProposal(Path.Combine(outbox, "dream-growth-5.json"), 5, "The dream kept the parsnip day.", "Notice the crops first.");
        WriteProposal(Path.Combine(outbox, "growth-3.json"), 3, "Markers near the crops get granted.", null);

        var result = await CompanionGrowthIntake.ConsumePendingAsync(this.root);

        Assert.Empty(result.Errors);
        Assert.Equal(2, result.Applied);
        Assert.Equal(5, result.Asset?.Revision);
        Assert.Equal("Notice the crops first.", result.Asset?.Focus);
        Assert.Equal(new[] { "growth-3-1", "growth-5-1" }, result.Asset!.Insights.Select(insight => insight.Id).ToArray());
        Assert.Empty(Directory.EnumerateFiles(outbox));
    }

    [Fact]
    public async Task GrowthIntakeKeepsARefusedProposalAsEvidenceWithoutBlockingTheRest()
    {
        var outbox = Path.Combine(this.root, "outbox");
        Directory.CreateDirectory(outbox);
        File.WriteAllText(Path.Combine(outbox, "growth-2.json"), "{ damaged");
        WriteProposal(Path.Combine(outbox, "growth-4.json"), 4, "A grounded insight.", null);

        var result = await CompanionGrowthIntake.ConsumePendingAsync(this.root);

        Assert.Equal(1, result.Applied);
        Assert.Single(result.Errors);
        Assert.StartsWith("growth-2:", result.Errors[0]);
        Assert.True(File.Exists(Path.Combine(outbox, "growth-2.json")));
        Assert.Equal(4, result.Asset?.Revision);
    }

    [Fact]
    public async Task GrowthIntakeWithNothingPendingReturnsTheStoredAsset()
    {
        var result = await CompanionGrowthIntake.ConsumePendingAsync(this.root);

        Assert.Equal(0, result.Applied);
        Assert.Null(result.Asset);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void LatencyTraceWritesOneMillisecondUtcLinePerStage()
    {
        var at = new DateTimeOffset(2026, 8, 30, 8, 0, 0, 125, TimeSpan.FromHours(8));
        LatencyTrace.Append(this.root, "social", "turn-1", "published", at);
        LatencyTrace.Append(this.root, "social", "turn-1", "rendered", at.AddMilliseconds(900), "reply");

        var lines = File.ReadAllLines(LatencyTrace.PathFor(this.root));

        Assert.Equal(2, lines.Length);
        using var first = JsonDocument.Parse(lines[0]);
        Assert.Equal("2026-08-30T00:00:00.125Z", first.RootElement.GetProperty("at").GetString());
        Assert.Equal("mod", first.RootElement.GetProperty("source").GetString());
        Assert.Equal("published", first.RootElement.GetProperty("stage").GetString());
        using var second = JsonDocument.Parse(lines[1]);
        Assert.Equal("reply", second.RootElement.GetProperty("detail").GetString());
        Assert.Throws<ArgumentException>(() => LatencyTrace.Append(this.root, "social", " ", "published", at));
    }

    [Fact]
    public void MouthReadinessAcceptsOnlyTheMarkerThatAnswersThisWarmup()
    {
        var companion = new BridgeCompanionIdentity("Mira", "a farm companion", new BridgeCompanionSoul(
            new[] { "honesty before comfort" }, Array.Empty<string>(), "Direct.", Array.Empty<string>()));
        var request = MouthReadiness.WriteWarmupRequest(this.root, companion, "2026-08-30T06:00:00.000Z");
        MouthReadiness.WriteWarmupRequest(this.root, companion, "2026-08-30T06:00:01.000Z");

        using (var written = JsonDocument.Parse(File.ReadAllText(MouthReadiness.WarmupPath(this.root))))
        {
            Assert.Equal("2026-08-30T06:00:01.000Z", written.RootElement.GetProperty("requestedAt").GetString());
            Assert.Equal("Mira", written.RootElement.GetProperty("companion").GetProperty("name").GetString());
        }
        Assert.Equal(DecisionBridgeRules.WireVersion, request.Version);
        Assert.Null(MouthReadiness.TryReadReady(this.root, "2026-08-30T06:00:01.000Z"));

        Directory.CreateDirectory(Path.GetDirectoryName(MouthReadiness.ReadyPath(this.root))!);
        var marker = new MouthReadyMarker(DecisionBridgeRules.WireVersion, "ready", "dsh", "2026-08-30T06:00:00.000Z", "2026-08-30T06:00:02.000Z", "session-1", "created", 1800);
        File.WriteAllText(MouthReadiness.ReadyPath(this.root), JsonSerializer.Serialize(marker, CamelCase));
        Assert.Null(MouthReadiness.TryReadReady(this.root, "2026-08-30T06:00:01.000Z"));

        File.WriteAllText(MouthReadiness.ReadyPath(this.root), JsonSerializer.Serialize(marker with { RequestedAt = "2026-08-30T06:00:01.000Z" }, CamelCase));
        Assert.Equal("created", MouthReadiness.TryReadReady(this.root, "2026-08-30T06:00:01.000Z")?.Mode);
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root)) Directory.Delete(this.root, true);
    }

    private static void WriteProposal(string path, int sequence, string insight, string? focus)
    {
        var proposal = new BridgeGrowthProposal(
            DecisionBridgeRules.WireVersion, sequence, new[] { new BridgeGrowthProposalInsight(insight, new[] { 1 }) }, focus);
        File.WriteAllText(path, JsonSerializer.Serialize(proposal));
    }
}
