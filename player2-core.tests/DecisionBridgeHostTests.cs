using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class DecisionBridgeHostTests : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-host-{Guid.NewGuid():N}");

    [Fact]
    public async Task PublishesPollsAndPersistsSettlementWithoutBlockingUpdate()
    {
        var (turn, requestJson) = LoadGolden();
        using var host = new DecisionBridgeHost(this.root, pollIntervalTicks: 1, requestTimeoutTicks: 1000);
        host.Start(turn);

        await WaitForAsync(host, _ => File.Exists(Path.Combine(this.root, "inbox", "turn-12.json")));
        var outbox = Path.Combine(this.root, "outbox");
        Directory.CreateDirectory(outbox);
        await File.WriteAllTextAsync(Path.Combine(outbox, "request-12.json"), requestJson);

        var requested = await WaitForAsync(host, update => update.Request is not null);
        var grant = DecisionBridgeRules.CreateGrant(
            requested.Request!,
            false,
            "2026-08-29T00:00:01.000Z",
            "2026-08-29T00:05:00.000Z");
        var authorization = DecisionBridgeRules.Authorize(
            turn,
            requested.Request!,
            grant,
            "2026-08-29T00:00:02.000Z");
        host.RecordSettlement(grant, authorization.TerminalReceipt!);

        await WaitForAsync(host, _ => File.Exists(Path.Combine(this.root, "receipts", "receipt-12.json")));
        var receipt = await new DecisionBridgeFiles(this.root).TryReadReceiptAsync(12);

        Assert.Equal("declined", receipt?.Status);
    }

    [Fact]
    public async Task RecoversAValidReceiptAndTimesOutWithoutARequest()
    {
        var (turn, _) = LoadGolden();
        var receipt = new BridgeActionReceipt(
            "turn-12:proposal",
            DecisionBridgeRules.CapabilityId,
            "declined",
            "2026-08-29T00:00:02.000Z",
            null,
            DecisionBridgeRules.AllowedScope,
            "The player declined this proposal.");
        await new DecisionBridgeFiles(this.root).WriteReceiptAsync(12, receipt);
        using (var recovery = new DecisionBridgeHost(this.root, 1, 100))
        {
            recovery.Start(turn);
            var update = await WaitForAsync(recovery, value => value.RecoveredReceipt is not null);
            Assert.Equal(receipt, update.RecoveredReceipt);
        }

        var timeoutRoot = Path.Combine(this.root, "timeout");
        using var timeout = new DecisionBridgeHost(timeoutRoot, 1, 2);
        timeout.Start(turn);
        var failed = await WaitForAsync(timeout, update => update.Error is TimeoutException);
        Assert.IsType<TimeoutException>(failed.Error);
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root))
        {
            Directory.Delete(this.root, true);
        }
    }

    private static async Task<DecisionBridgeHostUpdate> WaitForAsync(
        DecisionBridgeHost host,
        Func<DecisionBridgeHostUpdate, bool> predicate)
    {
        for (var attempt = 0; attempt < 400; attempt++)
        {
            var update = host.Update();
            if (predicate(update))
            {
                return update;
            }
            await Task.Delay(5);
        }
        throw new TimeoutException("Decision bridge host test did not reach the expected state.");
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
