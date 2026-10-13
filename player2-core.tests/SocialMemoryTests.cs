using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class SocialMemoryTests : IDisposable
{
    private const string Scope = "visual marker + sound only";
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-social-memory-{Guid.NewGuid():N}");

    [Fact]
    public void ProjectsYesterdaysReceiptBackedOutcomeAndCountsDamagedReceipts()
    {
        this.SeedReceipts();

        var context = SocialMemory.Load(this.root, Yesterday(), currentDay: 11);

        Assert.Equal(1, context.SkippedReceipts);
        Assert.Equal("proposal-day-11", context.LatestReceipt?.ProposalId);
        var memory = Assert.IsType<NativeSharedOutcomeMemory>(context.PriorMemory);
        Assert.Equal("memory-receipt-3", memory.Id);
        Assert.Equal(11, memory.GameDay);
        Assert.Equal("A temporary marker was shown near the parsnips.", memory.Summary);
    }

    [Fact]
    public void OnlyTheImmediatelyPriorDayBecomesCitableMemory()
    {
        this.SeedReceipts();

        Assert.Null(SocialMemory.Load(this.root, Yesterday(), currentDay: 12).PriorMemory);
        Assert.Null(SocialMemory.Load(this.root, Yesterday() with { Status = "declined" }, currentDay: 11).PriorMemory);
        Assert.Null(SocialMemory.Load(this.root, Yesterday() with { Scope = "another scope" }, currentDay: 11).PriorMemory);
        Assert.NotNull(SocialMemory.Load(this.root, Yesterday(), currentDay: 12).LatestReceipt);
    }

    [Fact]
    public void AMissingReceiptsDirectoryIsAnEmptyHistoryNotAnError()
    {
        Assert.Same(SocialMemoryContext.Empty, SocialMemory.Load(this.root, Yesterday(), currentDay: 11));
    }

    [Fact]
    public void OnlyDamagedReceiptsLeaveNoLatestReceipt()
    {
        var receipts = Path.Combine(this.root, "receipts");
        Directory.CreateDirectory(receipts);
        File.WriteAllText(Path.Combine(receipts, "receipt-1.json"), "{\"proposalId\":\"\"}");
        File.WriteAllText(Path.Combine(receipts, "receipt-2.json"), "not json");

        var context = SocialMemory.Load(this.root, Yesterday(), currentDay: 11);

        Assert.Null(context.LatestReceipt);
        Assert.Null(context.PriorMemory);
        Assert.Equal(2, context.SkippedReceipts);
    }

    /// <summary>
    /// The golden envelope shared with the TypeScript contract test: the Player
    /// writer must produce exactly fixtures/social-turn/stardew-social-memory.json
    /// from the seeded receipts and growth asset.
    /// </summary>
    [Fact]
    public async Task PublishedEnvelopeMatchesTheSharedGoldenFixture()
    {
        this.SeedReceipts();
        var context = SocialMemory.Load(this.root, Yesterday(), currentDay: 11);
        var growth = new BridgeGrowthAsset(
            DecisionBridgeRules.WireVersion,
            7,
            new[] { new BridgeGrowthInsight("growth-7-1", "Markers near the crops are the plans the player grants.", new[] { 3 }, "2026-08-29T20:00:00.000Z") },
            "Learn which plans the player grants.");
        var turn = new NativeSocialBridgeTurn(
            "0.0.9", "5b0f3c2e-7a41-4d8e-9c55-0d6f1e2a3b4c", "2026-08-30T08:10:00.000Z", 12,
            new NativeCompanionIdentity("Mira", "a farm companion", new BridgeCompanionSoul(
                new[] { "honesty before comfort" },
                new[] { "the player's trust, earned one receipt at a time" },
                "Direct and warm with dry humor.",
                new[] { "never claims an action happened without a receipt proving it" })),
            new NativeAdapterDescriptor("stardew-smapi", "stardew-valley", "semantic", Array.Empty<object>()),
            new[] { new NativeObservation("world-12", "world", "2026-08-30T08:10:00.000Z", null, "stardew-smapi", "semantic", 1, new NativeWorldFacts("sunny", "Farm")) },
            context.PriorMemory, context.LatestReceipt,
            new NativePlayerMessage("message-12", "昨天的标记有用吗？", "2026-08-30T08:10:00.000Z"),
            Growth: growth);

        using var host = new SocialBridgeHost(this.root, pollIntervalTicks: 1, timeout: TimeSpan.FromSeconds(5));
        host.Start(turn);
        var inbox = Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json");
        for (var attempt = 0; attempt < 400 && !File.Exists(inbox); attempt++)
        {
            var update = host.Update();
            if (update.Error is not null) throw update.Error;
            await Task.Delay(5);
        }

        var golden = Path.Combine(AppContext.BaseDirectory, "fixtures", "stardew-social-memory.json");
        Assert.Equal(Canonical(await File.ReadAllTextAsync(golden)), Canonical(await File.ReadAllTextAsync(inbox)));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root)) Directory.Delete(this.root, true);
    }

    private static SharedOutcome Yesterday() => new(Player2Rules.StateVersion, 10, 12, 8, Scope, "completed");

    private void SeedReceipts()
    {
        var receipts = Path.Combine(this.root, "receipts");
        Directory.CreateDirectory(receipts);
        File.WriteAllText(Path.Combine(receipts, "receipt-2.json"), JsonSerializer.Serialize(new BridgeActionReceipt(
            "proposal-day-9", "visual-receipt", "declined", "2026-08-27T09:00:00.000Z", "tile 3, 4", Scope, "The player said no.")));
        File.WriteAllText(Path.Combine(receipts, "receipt-3.json"), JsonSerializer.Serialize(new BridgeActionReceipt(
            "proposal-day-11", "visual-receipt", "completed", "2026-08-29T09:00:00.000Z", "tile 12, 8", Scope, "A temporary marker was shown near the parsnips.")));
        File.WriteAllText(Path.Combine(receipts, "receipt-4.json"), "{ damaged");
    }

    private static string Canonical(string json)
    {
        using var document = JsonDocument.Parse(json);
        return JsonSerializer.Serialize(document.RootElement);
    }
}
