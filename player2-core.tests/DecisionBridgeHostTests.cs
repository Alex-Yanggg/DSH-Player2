using System;
using System.IO;
using System.Text.Json;
using System.Threading;
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
        using var host = new DecisionBridgeHost(this.root, pollIntervalTicks: 1, requestTimeout: TimeSpan.FromSeconds(30));
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
    public async Task AutonomousSettlementPersistsOnlyTheMarkedReceipt()
    {
        var (turn, requestJson) = LoadGolden();
        using var host = new DecisionBridgeHost(this.root, pollIntervalTicks: 1, requestTimeout: TimeSpan.FromSeconds(30));
        host.Start(turn);

        await WaitForAsync(host, _ => File.Exists(Path.Combine(this.root, "inbox", "turn-12.json")));
        Directory.CreateDirectory(Path.Combine(this.root, "outbox"));
        var autonomousRequest = JsonSerializer.Deserialize<BridgeActionRequest>(
            requestJson, JsonOptions)! with { Status = DecisionBridgeRules.AutonomousStatus };
        await File.WriteAllTextAsync(
            Path.Combine(this.root, "outbox", "request-12.json"),
            JsonSerializer.Serialize(autonomousRequest));

        var requested = await WaitForAsync(host, update => update.Request is not null);
        var authorization = DecisionBridgeRules.AuthorizeAutonomous(
            turn,
            requested.Request!,
            "2026-08-29T00:00:02.000Z");
        var completion = DecisionBridgeRules.CompleteGranted(
            authorization,
            true,
            "2026-08-29T00:00:03.000Z",
            DecisionBridgeRules.FullAutonomy);
        host.RecordAutonomousSettlement(completion.Receipt);

        await WaitForAsync(host, _ => File.Exists(Path.Combine(this.root, "receipts", "receipt-12.json")));
        var receipt = await new DecisionBridgeFiles(this.root).TryReadReceiptAsync(12);

        Assert.Equal("completed", receipt?.Status);
        Assert.Equal(DecisionBridgeRules.FullAutonomy, receipt?.Autonomy);
        Assert.False(File.Exists(Path.Combine(this.root, "grants", "grant-12.json")),
            "An autonomous settlement has no player answer, so it must not write a grant file.");
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
        using (var recovery = new DecisionBridgeHost(this.root, 1, TimeSpan.FromSeconds(5)))
        {
            recovery.Start(turn);
            var update = await WaitForAsync(recovery, value => value.RecoveredReceipt is not null);
            Assert.Equal(receipt, update.RecoveredReceipt);
        }

        var timeoutRoot = Path.Combine(this.root, "timeout");
        using var timeout = new DecisionBridgeHost(timeoutRoot, 1, TimeSpan.FromMilliseconds(60));
        timeout.Start(turn);
        var failed = await WaitForAsync(timeout, update => update.Error is TimeoutException);
        Assert.IsType<TimeoutException>(failed.Error);
    }

    [Fact]
    public async Task InfiniteRequestTimeoutWaitsForARequest()
    {
        var (turn, requestJson) = LoadGolden();
        using var host = new DecisionBridgeHost(this.root, pollIntervalTicks: 1, requestTimeout: Timeout.InfiniteTimeSpan);
        host.Start(turn);

        await WaitForAsync(host, _ => File.Exists(Path.Combine(this.root, "inbox", "turn-12.json")));
        // A headless harness may intentionally own the outer process timeout;
        // the bridge host must keep polling instead of treating InfiniteTimeSpan
        // as a one-millisecond negative deadline.
        var beforeRequest = host.Update();
        Assert.Null(beforeRequest.Error);
        Directory.CreateDirectory(Path.Combine(this.root, "outbox"));
        await File.WriteAllTextAsync(Path.Combine(this.root, "outbox", "request-12.json"), requestJson);

        var requested = await WaitForAsync(host, update => update.Request is not null);
        Assert.Equal("turn-12:proposal", requested.Request!.Proposal.Id);
    }

    [Fact]
    public async Task InvalidRecoveryReceiptReturnsAControlledFailure()
    {
        var (turn, _) = LoadGolden();
        var receipt = new BridgeActionReceipt(
            "turn-99:proposal",
            DecisionBridgeRules.CapabilityId,
            "completed",
            "2026-08-29T00:00:02.000Z",
            "stardew-location:Farm:tile:12,8",
            DecisionBridgeRules.AllowedScope,
            "A temporary world marker was shown.");
        await new DecisionBridgeFiles(this.root).WriteReceiptAsync(12, receipt);
        using var host = new DecisionBridgeHost(this.root, 1, TimeSpan.FromSeconds(5));
        host.Start(turn);

        var update = await WaitForAsync(host, value => value.Error is not null);

        Assert.IsType<InvalidOperationException>(update.Error);
    }

    [Fact]
    public void DecisionSequenceAndGameDayAreIndependent()
    {
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley,
            new WorldSnapshot(2, "clear", "Farm"),
            1_000_000,
            "2026-08-30T03:00:00.000Z",
            12,
            8,
            null);

        Assert.Equal(1_000_000, turn.Sequence);
        Assert.Equal(3, turn.GameDay);
    }

    [Fact]
    public async Task SurfacesDshRuntimeErrorImmediatelyInsteadOfWaitingForTimeout()
    {
        var (turn, _) = LoadGolden();
        using var host = new DecisionBridgeHost(this.root, 1, TimeSpan.FromSeconds(30));
        host.Start(turn);
        await WaitForAsync(host, _ => File.Exists(Path.Combine(this.root, "inbox", "turn-12.json")));
        var outbox = Path.Combine(this.root, "outbox");
        Directory.CreateDirectory(outbox);
        await File.WriteAllTextAsync(Path.Combine(outbox, "error-12.json"), JsonSerializer.Serialize(new BridgeRuntimeError(
            DecisionBridgeRules.WireVersion,
            12,
            "dsh:decision:12:test",
            "DSH_DECISION_TURN_FAILED",
            "The native DSH agent did not produce an action request.")));

        var failed = await WaitForAsync(host, update => update.Error is not null);

        Assert.Contains("DSH_DECISION_TURN_FAILED", failed.Error!.Message);
        Assert.Contains("dsh:decision:12:test", failed.Error.Message);
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
