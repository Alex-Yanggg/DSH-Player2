using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class SocialBridgeHostTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-social-{Guid.NewGuid():N}");

    [Fact]
    public void MovementEnvelopeCannotGrantACommandThePlayerDidNotGive()
    {
        using var host = this.CreateHost();
        Assert.Throws<InvalidOperationException>(() => host.Start(this.CreateTurn("不要来我面前") with { MovementCommand = "come" }));
        Assert.False(Directory.Exists(Path.Combine(this.root, "social-inbox")));
    }

    [Fact]
    public async Task ExplicitMovementGrantSurvivesTheNativeDshRoundTrip()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn("立刻来我面前") with { MovementCommand = "come" };
        host.Start(turn);
        var path = Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json");
        await this.WaitForFileAsync(host, path);
        using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(path));
        Assert.Equal("come", doc.RootElement.GetProperty("movementCommand").GetString());
        await this.WriteResultAsync(turn.Id, "completed", this.ValidResponse());
        var update = await this.WaitForAsync(host, value => value.Result is not null || value.Error is not null);
        Assert.Null(update.Error);
        Assert.Equal("come", host.Turn?.MovementCommand);
        Assert.NotNull(update.Result);
    }

    [Fact]
    public async Task PublishesCamelCaseEnvelopeAndReadsCamelCaseDshResult()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        host.Start(turn);

        var inboxPath = Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json");
        await this.WaitForFileAsync(host, inboxPath);
        using (var document = JsonDocument.Parse(await File.ReadAllTextAsync(inboxPath)))
        {
            Assert.True(document.RootElement.TryGetProperty("createdAt", out _));
            Assert.False(document.RootElement.TryGetProperty("CreatedAt", out _));
            var companion = document.RootElement.GetProperty("companion");
            Assert.True(companion.TryGetProperty("soul", out var soul));
            Assert.True(soul.TryGetProperty("values", out _));
            Assert.True(soul.TryGetProperty("boundaries", out _));
            var selfFacts = document.RootElement.GetProperty("observations")[1].GetProperty("facts");
            Assert.True(selfFacts.TryGetProperty("farmerName", out _));
            Assert.True(selfFacts.TryGetProperty("inventoryTruncated", out _));
        }

        await this.WriteResultAsync(turn.Id, status: "completed", response: this.ValidResponse());
        var update = await this.WaitForAsync(host, value => value.Result is not null || value.Error is not null);
        Assert.Equal("Native DSH reply.", update.Result?.Text);
        Assert.Equal("dsh:social:test", update.TraceId);
    }

    [Fact]
    public async Task ConsumedResultFilesAreCleanedUp()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        host.Start(turn);
        await this.WaitForFileAsync(host, Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json"));
        await this.WriteResultAsync(turn.Id, status: "completed", response: this.ValidResponse());

        await this.WaitForAsync(host, value => value.Result is not null || value.Error is not null);

        Assert.False(File.Exists(Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json")));
        Assert.False(File.Exists(Path.Combine(this.root, "social-outbox", $"result-{turn.Id}.json")));
    }

    [Fact]
    public async Task PublishingCreatesTheReplyLaneBeforeDshCanConsumeTheTurn()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        host.Start(turn);

        await this.WaitForFileAsync(host, Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json"));

        Assert.True(Directory.Exists(Path.Combine(this.root, "social-outbox")));
    }

    [Fact]
    public async Task TimedOutTurnsDoNotLeaveAnInboxThatDshWillRetryForever()
    {
        using var host = new SocialBridgeHost(this.root, pollIntervalTicks: 1, timeout: TimeSpan.FromSeconds(2));
        var turn = this.CreateTurn();
        host.Start(turn);
        var inboxPath = Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json");
        await this.WaitForFileAsync(host, inboxPath);
        await Task.Delay(TimeSpan.FromMilliseconds(2100));

        var update = await this.WaitForAsync(host, value => value.Error is TimeoutException);

        Assert.IsType<TimeoutException>(update.Error);
        Assert.False(File.Exists(inboxPath));
    }

    [Fact]
    public async Task RejectsAResultThatCitesAnUnadvertisedObservation()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        host.Start(turn);
        await this.WaitForFileAsync(host, Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json"));
        var response = this.ValidResponse();
        response.BasedOnObservationIds = new[] { "world-1", "ghost-observation" };
        await this.WriteResultAsync(turn.Id, status: "completed", response);

        var update = await this.WaitForAsync(host, value => value.Error is not null);

        Assert.IsType<InvalidDataException>(update.Error);
        Assert.Contains("never advertised", update.Error!.Message);
    }

    [Fact]
    public async Task RejectsAResultWithAnUnknownKindOrWrongVersion()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        host.Start(turn);
        await this.WaitForFileAsync(host, Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json"));
        var response = this.ValidResponse();
        response.Kind = "lecture";
        await this.WriteResultAsync(turn.Id, status: "completed", response);

        var update = await this.WaitForAsync(host, value => value.Error is not null);
        Assert.IsType<InvalidDataException>(update.Error);

        using var second = this.CreateHost();
        var turn2 = this.CreateTurn(id: "a1b2c3d4-aaaa-4bbb-8ccc-1234567890cd");
        second.Start(turn2);
        await this.WaitForFileAsync(second, Path.Combine(this.root, "social-inbox", $"turn-{turn2.Id}.json"));
        await File.WriteAllTextAsync(
            Path.Combine(this.root, "social-outbox", $"result-{turn2.Id}.json"),
            JsonSerializer.Serialize(new
            {
                version = "9.9.9",
                id = turn2.Id,
                status = "completed",
                source = "dsh",
                traceId = "dsh:social:test",
                sessionId = "session-test",
                response = new { kind = "reply", text = "hello", basedOnObservationIds = Array.Empty<string>(), basedOnMemoryId = (string?)null, rememberLatestReceipt = false, memorySummary = (string?)null },
            }));
        var update2 = await this.WaitForAsync(second, value => value.Error is not null);
        Assert.Contains("does not match the wire contract", update2.Error!.Message);
    }

    [Fact]
    public void RejectsAnOversizedPlayerMessageAtTheBoundary()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn(message: new string('x', 801));
        Assert.Throws<InvalidOperationException>(() => host.Start(turn));
    }

    [Fact]
    public void RejectsATurnWithAnEmptyObservationId()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        var broken = new NativeObservation(string.Empty, "world", turn.Observations[0].ObservedAt, null, "stardew-smapi", "semantic", 1, new NativeWorldFacts("rain", "Farm"));
        var brokenTurn = turn with { Observations = new[] { broken } };
        Assert.Throws<InvalidOperationException>(() => host.Start(brokenTurn));
    }

    [Fact]
    public async Task OversizedResultFileIsRefusedInsteadOfRead()
    {
        using var host = this.CreateHost();
        var turn = this.CreateTurn();
        host.Start(turn);
        await this.WaitForFileAsync(host, Path.Combine(this.root, "social-inbox", $"turn-{turn.Id}.json"));
        var outbox = Path.Combine(this.root, "social-outbox");
        Directory.CreateDirectory(outbox);
        await File.WriteAllTextAsync(Path.Combine(outbox, $"result-{turn.Id}.json"), new string('x', DecisionBridgeFiles.MaxFileBytes + 1));

        var update = await this.WaitForAsync(host, value => value.Error is not null);

        Assert.IsType<InvalidDataException>(update.Error);
        Assert.Contains("byte limit", update.Error!.Message);
    }

    [Fact]
    public void SweepRemovesOnlyStaleSocialFiles()
    {
        var inbox = Path.Combine(this.root, "social-inbox");
        var outbox = Path.Combine(this.root, "social-outbox");
        Directory.CreateDirectory(inbox);
        Directory.CreateDirectory(outbox);
        var stale = Path.Combine(inbox, "turn-stale.json");
        var fresh = Path.Combine(inbox, "turn-fresh.json");
        File.WriteAllText(stale, "{}");
        File.WriteAllText(fresh, "{}");
        File.SetLastWriteTimeUtc(stale, DateTimeOffset.UtcNow.AddDays(-8).UtcDateTime);

        SocialBridgeHost.SweepStaleFiles(this.root);

        Assert.False(File.Exists(stale));
        Assert.True(File.Exists(fresh));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root)) Directory.Delete(this.root, true);
    }

    private SocialBridgeHost CreateHost()
    {
        return new SocialBridgeHost(this.root, pollIntervalTicks: 1, timeout: TimeSpan.FromSeconds(5));
    }

    private NativeSocialBridgeTurn CreateTurn(string? message = null, string? id = null)
    {
        return new NativeSocialBridgeTurn(
            "0.0.9", id ?? "f4e3c2b1-aaaa-4bbb-8ccc-1234567890ab", "2026-08-30T00:00:00.000Z", 1,
            new NativeCompanionIdentity("Mira", "a farm companion", new BridgeCompanionSoul(
                new[] { "honesty before comfort" },
                new[] { "the player's trust, earned one receipt at a time" },
                "Direct and warm with dry humor.",
                new[] { "never claims an action happened without a receipt proving it" })),
            new NativeAdapterDescriptor("stardew-smapi", "stardew-valley", "semantic", Array.Empty<object>()),
            new[]
            {
                new NativeObservation("world-1", "world", "2026-08-30T00:00:00.000Z", null, "stardew-smapi", "semantic", 1, new NativeWorldFacts("clear", "Farm")),
                new NativeObservation("self-1", "self", "2026-08-30T00:00:00.000Z", null, "stardew-smapi", "semantic", 1, new NativeSelfFacts(
                    "Alex", 1250, 3, 12, new[] { new NativeInventoryItemFact("Axe", 1) }, false)),
            },
            null, null, new NativePlayerMessage("message-1", message ?? "hello", "2026-08-30T00:00:00.000Z"));
    }

    private NativeSocialResponse ValidResponse()
    {
        return new NativeSocialResponse
        {
            Kind = "reply",
            Text = "Native DSH reply.",
            BasedOnObservationIds = new[] { "world-1" },
            BasedOnMemoryId = null,
            RememberLatestReceipt = false,
            MemorySummary = null,
        };
    }

    private async Task WriteResultAsync(string id, string status, NativeSocialResponse? response)
    {
        var outbox = Path.Combine(this.root, "social-outbox");
        Directory.CreateDirectory(outbox);
        var payload = new
        {
            version = "0.0.9",
            id,
            status,
            source = "dsh",
            traceId = "dsh:social:test",
            sessionId = "session-test",
            response,
        };
        await File.WriteAllTextAsync(Path.Combine(outbox, $"result-{id}.json"), JsonSerializer.Serialize(payload));
    }

    private async Task WaitForFileAsync(SocialBridgeHost host, string path)
    {
        for (var attempt = 0; attempt < 400; attempt++)
        {
            var update = host.Update();
            if (update.Error is not null) throw update.Error;
            if (File.Exists(path)) return;
            await Task.Delay(5);
        }
        throw new TimeoutException("Social bridge host did not publish its turn.");
    }

    private async Task<SocialBridgeHostUpdate> WaitForAsync(
        SocialBridgeHost host,
        Func<SocialBridgeHostUpdate, bool> predicate)
    {
        for (var attempt = 0; attempt < 400; attempt++)
        {
            var update = host.Update();
            if (predicate(update)) return update;
            await Task.Delay(5);
        }
        throw new TimeoutException("Social bridge host test did not reach the expected state.");
    }
}
