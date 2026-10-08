using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class CompanionGrowthStoreTests
{
    [Fact]
    public async Task AppliesProposalToEmptyAssetAndPersistsIt()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            var proposal = new BridgeGrowthProposal(
                DecisionBridgeRules.WireVersion,
                7,
                new[] { new BridgeGrowthProposalInsight("Granted markers were near the crops.", new[] { 6, 5 }) },
                "Learn which plans the player grants.");

            var asset = await store.ApplyProposalAsync(proposal);

            Assert.Equal(7, asset.Revision);
            Assert.Equal("Learn which plans the player grants.", asset.Focus);
            var insight = Assert.Single(asset.Insights);
            Assert.Equal("growth-7-1", insight.Id);
            Assert.Equal(new[] { 6, 5 }, insight.BasedOnReceiptSequences);

            var persisted = await store.TryLoadAsync();
            Assert.NotNull(persisted);
            Assert.Equal(asset.Revision, persisted!.Revision);
            Assert.Equal(asset.Focus, persisted.Focus);
            var persistedInsight = Assert.Single(persisted.Insights);
            Assert.Equal(insight.Id, persistedInsight.Id);
            Assert.Equal(insight.Text, persistedInsight.Text);
            Assert.Equal(insight.BasedOnReceiptSequences, persistedInsight.BasedOnReceiptSequences);
            // The asset always carries the focus key, even when null, so the
            // TypeScript side parses the same shape it writes.
            var json = await File.ReadAllTextAsync(store.AssetPath);
            Assert.Contains("\"focus\"", json);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task WritesExplicitNullFocusWhenTheProposalCarriesNone()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            var proposal = new BridgeGrowthProposal(
                DecisionBridgeRules.WireVersion,
                3,
                new[] { new BridgeGrowthProposalInsight("A grounded insight.", new[] { 2 }) },
                null);

            await store.ApplyProposalAsync(proposal);

            var json = await File.ReadAllTextAsync(store.AssetPath);
            using var document = JsonDocument.Parse(json);
            Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("focus").ValueKind);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ReapplyingSameSequenceIsIdempotentAndStaleProposalIsRejected()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            var proposal = new BridgeGrowthProposal(
                DecisionBridgeRules.WireVersion,
                5,
                new[] { new BridgeGrowthProposalInsight("First.", new[] { 4 }) },
                null);

            var applied = await store.ApplyProposalAsync(proposal);
            var reapplied = await store.ApplyProposalAsync(
                new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion,
                    5,
                    new[] { new BridgeGrowthProposalInsight("Conflicting rewrite.", new[] { 4 }) },
                    "A new focus"));

            // The idempotent reapply returns the applied state: the conflicting
            // text and focus must not appear.
            Assert.Equal(applied.Revision, reapplied.Revision);
            Assert.Equal(applied.Focus, reapplied.Focus);
            Assert.Equal("First.", Assert.Single(reapplied.Insights).Text);

            await Assert.ThrowsAsync<InvalidOperationException>(
                () => store.ApplyProposalAsync(
                    new BridgeGrowthProposal(
                        DecisionBridgeRules.WireVersion,
                        3,
                        new[] { new BridgeGrowthProposalInsight("Stale.", new[] { 2 }) },
                        null)));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task TrimsOldestInsightsBeyondTheCapAndReplacesFocus()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            for (var sequence = 1; sequence <= 12; sequence += 1)
            {
                await store.ApplyProposalAsync(new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion,
                    sequence,
                    new[] { new BridgeGrowthProposalInsight($"Insight {sequence}.", new[] { sequence }) },
                    null));
            }

            var applied = await store.ApplyProposalAsync(new BridgeGrowthProposal(
                DecisionBridgeRules.WireVersion,
                13,
                new[] { new BridgeGrowthProposalInsight("Insight 13.", new[] { 12 }) },
                "Plan better markers"));

            Assert.Equal(13, applied.Revision);
            Assert.Equal(CompanionGrowthStore.MaxInsights, applied.Insights.Length);
            Assert.Equal("Insight 2.", applied.Insights[0].Text);
            Assert.Equal("Insight 13.", applied.Insights[^1].Text);
            Assert.Equal("Plan better markers", applied.Focus);

            var persisted = await store.TryLoadAsync();
            Assert.NotNull(persisted);
            Assert.Equal(applied.Revision, persisted!.Revision);
            Assert.Equal(applied.Focus, persisted.Focus);
            Assert.Equal(applied.Insights.Select(insight => insight.Text), persisted.Insights.Select(insight => insight.Text));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task RejectsMalformedProposals()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            var valid = new BridgeGrowthProposalInsight("Valid.", new[] { 1 });

            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal("0.0.1", 1, new[] { valid }, null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(DecisionBridgeRules.WireVersion, 0, new[] { valid }, null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(DecisionBridgeRules.WireVersion, 1, Array.Empty<BridgeGrowthProposalInsight>(), null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(DecisionBridgeRules.WireVersion, 1, new[] { valid, valid, valid, valid }, null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion, 1,
                    new[] { new BridgeGrowthProposalInsight(new string('x', 241), new[] { 1 }) }, null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion, 1,
                    new[] { new BridgeGrowthProposalInsight("Dup.", new[] { 1, 1 }) }, null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion, 1,
                    new[] { new BridgeGrowthProposalInsight("Zero seq.", new[] { 0 }) }, null)));
            await Assert.ThrowsAsync<ArgumentException>(() => store.ApplyProposalAsync(
                new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion, 1,
                    new[] { valid }, new string('f', 161))));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task TreatsMissingAssetAsEmptyAndDamagedAssetAsTraceableError()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            Assert.Null(await store.TryLoadAsync());

            Directory.CreateDirectory(Path.Combine(root, "growth"));
            await File.WriteAllTextAsync(store.AssetPath, "{ not json");

            var error = await Assert.ThrowsAsync<InvalidDataException>(() => store.TryLoadAsync());
            Assert.Contains("damaged", error.Message);
            Assert.Contains("never silently reset", error.Message);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ReadsAndClearsTheConsumedProposalFile()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new CompanionGrowthStore(root);
            Assert.Null(await store.TryReadProposalAsync(7));

            Directory.CreateDirectory(Path.Combine(root, "outbox"));
            var proposalPath = Path.Combine(root, "outbox", "growth-7.json");
            await File.WriteAllTextAsync(proposalPath, JsonSerializer.Serialize(
                new BridgeGrowthProposal(
                    DecisionBridgeRules.WireVersion,
                    7,
                    new[] { new BridgeGrowthProposalInsight("From the file.", new[] { 6 }) },
                    (string?)null),
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));

            var proposal = await store.TryReadProposalAsync(7);
            Assert.NotNull(proposal);
            Assert.Equal(7, proposal!.Sequence);

            await store.ApplyProposalAsync(proposal);
            await store.ClearProposalAsync(7);
            Assert.False(File.Exists(proposalPath));
            Assert.NotNull(await store.TryLoadAsync());
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void CreateTurnAttachesValidatedGrowthAndOmitsItWhenAbsent()
    {
        var adapter = AdapterProfile.StardewValley;
        var self = Player2Rules.CreateFarmerSnapshot("Alex", 500, 1, 12, new[] { new InventoryItemSnapshot("Axe", 1) });
        var snapshot = new WorldSnapshot(12, "rain", "Farm", self);
        var growth = new BridgeGrowthAsset(
            DecisionBridgeRules.WireVersion,
            7,
            new[] { new BridgeGrowthInsight("growth-7-1", "An insight.", new[] { 6 }, "2026-09-03T00:00:00.000Z") },
            null);

        var withGrowth = DecisionBridgeRules.CreateTurn(
            adapter, snapshot, 8, DecisionBridgeRules.UtcTimestamp(DateTimeOffset.UtcNow), 12, 8, null, null, growth);
        Assert.NotNull(withGrowth.Growth);
        Assert.Equal(7, withGrowth.Growth!.Revision);

        var withoutGrowth = DecisionBridgeRules.CreateTurn(
            adapter, snapshot, 8, DecisionBridgeRules.UtcTimestamp(DateTimeOffset.UtcNow), 12, 8, null);
        Assert.Null(withoutGrowth.Growth);
        var json = JsonSerializer.Serialize(withoutGrowth, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        Assert.DoesNotContain("growth", json);

        Assert.Throws<ArgumentException>(() => DecisionBridgeRules.CreateTurn(
            adapter, snapshot, 8, DecisionBridgeRules.UtcTimestamp(DateTimeOffset.UtcNow), 12, 8, null, null,
            new BridgeGrowthAsset(DecisionBridgeRules.WireVersion, -1, Array.Empty<BridgeGrowthInsight>(), null)));
    }

    private static string TemporaryDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), $"player2-growth-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        return root;
    }
}
