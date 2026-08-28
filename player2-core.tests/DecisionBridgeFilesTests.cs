using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class DecisionBridgeFilesTests : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-bridge-{Guid.NewGuid():N}");

    [Fact]
    public async Task TurnGrantAndReceiptAreWriteOnceAndIdempotent()
    {
        var files = new DecisionBridgeFiles(this.root);
        var turn = CreateTurn();
        var receipt = new BridgeActionReceipt(
            "turn-12:proposal",
            DecisionBridgeRules.CapabilityId,
            "completed",
            "2026-08-29T00:00:03.000Z",
            "farm:tile:12,8",
            DecisionBridgeRules.AllowedScope,
            "A temporary world marker was shown.");
        var grant = new BridgePermissionGrant(
            "turn-12:proposal",
            true,
            "2026-08-29T00:00:01.000Z",
            "2026-08-29T00:05:00.000Z");

        await files.PublishTurnAsync(turn);
        await files.PublishTurnAsync(turn);
        await files.WriteGrantAsync(turn.Sequence, grant);
        await files.WriteGrantAsync(turn.Sequence, grant);
        await files.WriteReceiptAsync(turn.Sequence, receipt);
        await files.WriteReceiptAsync(turn.Sequence, receipt);

        Assert.Equal(receipt, await files.TryReadReceiptAsync(turn.Sequence));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            files.PublishTurnAsync(turn with { CreatedAt = "2026-08-29T01:00:00.000Z" }));
    }

    [Fact]
    public async Task ReadsAndValidatesTheTypeScriptGoldenRequest()
    {
        var files = new DecisionBridgeFiles(this.root);
        var (turn, requestJson) = LoadGolden();
        var outbox = Path.Combine(this.root, "outbox");
        Directory.CreateDirectory(outbox);
        await File.WriteAllTextAsync(Path.Combine(outbox, "request-12.json"), requestJson);

        var request = await files.TryReadRequestAsync(turn);

        Assert.NotNull(request);
        Assert.Equal("turn-12:proposal", request?.Proposal.Id);
    }

    [Fact]
    public async Task RejectsOversizedAndConflictingFiles()
    {
        var files = new DecisionBridgeFiles(this.root);
        var turn = CreateTurn();
        var outbox = Path.Combine(this.root, "outbox");
        Directory.CreateDirectory(outbox);
        await File.WriteAllTextAsync(
            Path.Combine(outbox, "request-12.json"),
            new string('x', DecisionBridgeFiles.MaxFileBytes + 1));

        await Assert.ThrowsAsync<InvalidDataException>(() => files.TryReadRequestAsync(turn));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root))
        {
            Directory.Delete(this.root, true);
        }
    }

    private static DecisionTurnEnvelope CreateTurn()
    {
        return DecisionBridgeRules.CreateTurn(
            new WorldSnapshot(11, "rain", "Farm", "prepare tomorrow's mine supplies"),
            12,
            "2026-08-29T00:00:00.000Z",
            12,
            8,
            null);
    }

    private static (DecisionTurnEnvelope Turn, string RequestJson) LoadGolden()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "fixtures", "stardew-visual-receipt.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var turn = document.RootElement.GetProperty("turn").Deserialize<DecisionTurnEnvelope>(JsonOptions)
            ?? throw new InvalidOperationException("Golden fixture has no turn.");
        return (turn, document.RootElement.GetProperty("expectedRequest").GetRawText());
    }
}
