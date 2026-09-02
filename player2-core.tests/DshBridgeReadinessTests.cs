using System;
using System.IO;
using System.Text.Json;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class DshBridgeReadinessTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-ready-{Guid.NewGuid():N}");

    [Fact]
    public void AcceptsOnlyAFreshNativeDshHeartbeatForTheCurrentWireVersion()
    {
        var now = new DateTimeOffset(2026, 8, 30, 3, 0, 0, TimeSpan.Zero);
        var runtime = Path.Combine(this.root, DshBridgeReadiness.ReadyDirectoryName);
        Directory.CreateDirectory(runtime);
        var ready = Path.Combine(runtime, "ready-42-test.json");
        File.WriteAllText(ready, JsonSerializer.Serialize(new
        {
            version = DecisionBridgeRules.WireVersion,
            status = "ready",
            source = "dsh",
            pid = 42,
            instanceId = "test-instance",
            startedAt = "2026-08-30T02:59:59.000Z",
        }));
        File.SetLastWriteTimeUtc(ready, now.UtcDateTime);

        var marker = DshBridgeReadiness.TryGetReadyMarker(this.root, now);

        Assert.NotNull(marker);
        Assert.Equal("test-instance", marker?.InstanceId);
    }

    [Fact]
    public void RejectsStaleOrWrongVersionMarkers()
    {
        var now = new DateTimeOffset(2026, 8, 30, 3, 0, 0, TimeSpan.Zero);
        var runtime = Path.Combine(this.root, DshBridgeReadiness.ReadyDirectoryName);
        Directory.CreateDirectory(runtime);
        var stale = Path.Combine(runtime, "ready-42-stale.json");
        File.WriteAllText(stale, "{\"version\":\"0.0.9\",\"status\":\"ready\",\"source\":\"dsh\",\"pid\":42,\"instanceId\":\"old\",\"startedAt\":\"2026-08-30T02:00:00.000Z\"}");
        File.SetLastWriteTimeUtc(stale, now.AddMinutes(-1).UtcDateTime);

        Assert.Null(DshBridgeReadiness.TryGetReadyMarker(this.root, now));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root))
        {
            Directory.Delete(this.root, true);
        }
    }
}
