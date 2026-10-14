using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class BodyBridgeTests : IDisposable
{
    private const double TickMs = 1000d / 60d;
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-body-{Guid.NewGuid():N}");

    private static readonly BodyInputDescriptor[] Declared =
    {
        new("MoveUp", "hold", "up"), new("MoveRight", "hold", "right"), new("MoveDown", "hold", "down"), new("MoveLeft", "hold", "left"),
        new("UseTool", "press", "tool"), new("Action", "press", "action"), new("Slot1", "press", "slot"),
        new("NoClip", "modifier", "cheat", Cheat: true),
    };

    private static JsonNode Fixture() => JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "stardew-body-frames.json")))!;

    private static BodyTask Task(params BodyInputStep[] steps) => Task(null, steps);

    private static BodyTask Task(BodyUntil? until, params BodyInputStep[] steps) =>
        new("0.1", Guid.NewGuid().ToString(), 1, "2026-10-14T06:00:00.000Z", steps, until, null);

    private static BodyTickFacts Facts(long tick, int x = 0, bool held = false, double moved = 0, string location = "Farm", double? monster = null) =>
        new(tick, location, x, 0, held, moved, monster);

    [Fact]
    public void GoldenTaskPlaysToTheGoldenStatus()
    {
        var fixture = Fixture();
        var task = JsonSerializer.Deserialize<BodyTask>(fixture["task"]!.ToJsonString(), BodyBridgeFiles.JsonOptions)!;
        var runner = new BodyTaskRunner(task, Declared, false, TickMs, 64, 10_000);
        var held = 0;
        var presses = new List<string>();
        for (var tick = 1; tick < 100 && !runner.IsTerminal; tick++)
        {
            var command = runner.Tick(Facts(tick, held: held > 0, moved: held > 0 ? 4 : 0));
            held = command.Held.Count;
            presses.AddRange(command.Pressed);
        }
        var status = JsonNode.Parse(JsonSerializer.Serialize(runner.ToStatus(41, "2026-10-14T06:00:02.500Z"), BodyBridgeFiles.JsonOptions))!;
        var expected = fixture["status"]!;
        foreach (var key in new[] { "version", "taskId", "seq", "status", "step", "reason" })
        {
            Assert.Equal(expected[key]!.ToJsonString(), status[key]!.ToJsonString());
        }
        Assert.Equal(new[] { "Slot1", "UseTool" }, presses);
    }

    [Fact]
    public void GoldenAdapterFramesDeserialize()
    {
        var fixture = Fixture();
        var declaration = JsonSerializer.Deserialize<BodyDeclaration>(fixture["declaration"]!.ToJsonString(), BodyBridgeFiles.JsonOptions)!;
        var state = JsonSerializer.Deserialize<BodyState>(fixture["state"]!.ToJsonString(), BodyBridgeFiles.JsonOptions)!;
        var speech = JsonSerializer.Deserialize<BodySpeech>(fixture["speech"]!.ToJsonString(), BodyBridgeFiles.JsonOptions)!;
        Assert.True(declaration.Inputs.Single(input => input.Id == "NoClip").Cheat);
        Assert.Equal(4, declaration.Limits.WalkPxPerTick);
        Assert.Equal("Farm", state.Body!.Location);
        Assert.Equal("SeedShop", state.Body.Menu!.ShopId);
        Assert.Equal(5, state.Body.Menu.Items[1].Stock);
        Assert.Null(state.Body.Menu.Items[0].Stock);
        Assert.Equal("#.W.#", state.Map.Rows[2]);
        Assert.Equal("walk", state.Warps[0].Kind);
        Assert.Equal(3, speech.Seq);
    }

    [Fact]
    public void HoldDurationsCountTicksAndPressesFireOnceAtStepStart()
    {
        var runner = new BodyTaskRunner(Task(new BodyInputStep(new[] { "MoveRight" }, new[] { "Slot1" }, 100)), Declared, false, TickMs, 64, 10_000);
        var held = 0;
        var presses = 0;
        var tick = 0;
        while (!runner.IsTerminal && tick < 50)
        {
            var command = runner.Tick(Facts(++tick, held: true, moved: 4));
            if (command.Held.Contains("MoveRight")) held++;
            presses += command.Pressed.Count;
        }
        Assert.Equal(6, held);
        Assert.Equal(1, presses);
        Assert.Equal("done", runner.Status);
    }

    [Fact]
    public void UnknownWrongKindAndOversizedInputsFailUpFront()
    {
        Assert.StartsWith("unknown-input", new BodyTaskRunner(Task(new BodyInputStep(new[] { "Fly" }, null, 100)), Declared, false, TickMs, 64, 10_000).Reason);
        Assert.StartsWith("wrong-kind", new BodyTaskRunner(Task(new BodyInputStep(null, new[] { "MoveUp" }, 100)), Declared, false, TickMs, 64, 10_000).Reason);
        Assert.StartsWith("wrong-kind", new BodyTaskRunner(Task(new BodyInputStep(new[] { "UseTool" }, null, 100)), Declared, false, TickMs, 64, 10_000).Reason);
        Assert.StartsWith("step-too-long", new BodyTaskRunner(Task(new BodyInputStep(new[] { "MoveUp" }, null, 20_000)), Declared, false, TickMs, 64, 10_000).Reason);
        var many = Enumerable.Range(0, 65).Select(_ => new BodyInputStep(new[] { "MoveUp" }, null, 10)).ToArray();
        Assert.StartsWith("too-many-steps", new BodyTaskRunner(Task(many), Declared, false, TickMs, 64, 10_000).Reason);
    }

    [Fact]
    public void CheatInputsNeedASwitch()
    {
        var step = new BodyInputStep(new[] { "MoveUp", "NoClip" }, null, 100);
        var off = new BodyTaskRunner(Task(step), Declared, false, TickMs, 64, 10_000);
        var on = new BodyTaskRunner(Task(step), Declared, true, TickMs, 64, 10_000);
        Assert.Equal("failed", off.Status);
        Assert.StartsWith("cheat-off", off.Reason);
        Assert.Equal("running", on.Status);
    }

    [Fact]
    public void StopsEarlyOnArrivalBlockingMonstersAndWarps()
    {
        var arrive = new BodyTaskRunner(Task(new BodyUntil(new BodyArrive("Farm", 3, 0, 0), null, null, null), new BodyInputStep(new[] { "MoveRight" }, null, 5000)), Declared, false, TickMs, 64, 10_000);
        for (var x = 0; x <= 3 && !arrive.IsTerminal; x++) arrive.Tick(Facts(x + 1, x, true, 4));
        Assert.Equal(("done", "arrived"), (arrive.Status, arrive.Reason));

        var blocked = new BodyTaskRunner(Task(new BodyUntil(null, 100, null, null), new BodyInputStep(new[] { "MoveRight" }, null, 5000)), Declared, false, TickMs, 64, 10_000);
        for (var tick = 1; tick < 30 && !blocked.IsTerminal; tick++) blocked.Tick(Facts(tick, held: true, moved: 0));
        Assert.Equal(("interrupted", "blocked"), (blocked.Status, blocked.Reason));

        var monster = new BodyTaskRunner(Task(new BodyUntil(null, null, 2, null), new BodyInputStep(new[] { "MoveRight" }, null, 5000)), Declared, false, TickMs, 64, 10_000);
        monster.Tick(Facts(1, monster: 5));
        monster.Tick(Facts(2, monster: 1.5));
        Assert.Equal(("interrupted", "monster"), (monster.Status, monster.Reason));

        var warp = new BodyTaskRunner(Task(new BodyUntil(null, null, null, true), new BodyInputStep(new[] { "MoveRight" }, null, 5000)), Declared, false, TickMs, 64, 10_000);
        warp.Tick(Facts(1));
        warp.Tick(Facts(2, location: "BusStop"));
        Assert.Equal(("done", "warped"), (warp.Status, warp.Reason));
    }

    [Fact]
    public void BlockedWithoutAStopConditionIsReportedNotEnded()
    {
        var runner = new BodyTaskRunner(Task(new BodyInputStep(new[] { "MoveRight" }, null, 2000)), Declared, false, TickMs, 64, 10_000);
        for (var tick = 1; tick < 60; tick++) runner.Tick(Facts(tick, held: true, moved: 0));
        Assert.Equal("running", runner.Status);
        Assert.Contains(runner.Events, e => e.Kind == "blocked");
    }

    [Fact]
    public void FilesAnswerNewestTaskAndReadCancelsSpeechAndCheatGrant()
    {
        var files = new BodyBridgeFiles(this.root);
        Directory.CreateDirectory(files.InputDirectory);
        foreach (var seq in new[] { 3, 4 })
        {
            var task = Task(new BodyInputStep(new[] { "MoveUp" }, null, 100)) with { Seq = seq };
            File.WriteAllText(Path.Combine(files.InputDirectory, $"task-{seq}.json"), JsonSerializer.Serialize(task, BodyBridgeFiles.JsonOptions));
        }
        Assert.Equal(new[] { 3, 4 }, files.PendingTaskSequences(0));
        var read = files.ReadTask(4);
        var runner = new BodyTaskRunner(read, Declared, false, TickMs, 64, 10_000);
        files.WriteStatus(runner.ToStatus(1, "2026-10-14T06:00:00.000Z"));
        Assert.Equal(new[] { 3 }, files.PendingTaskSequences(0));
        Assert.Empty(files.PendingTaskSequences(3));

        File.WriteAllText(Path.Combine(files.InputDirectory, "cancel-4.json"), JsonSerializer.Serialize(new BodyCancel("0.1", 4, read.TaskId, "2026-10-14T06:00:00.000Z"), BodyBridgeFiles.JsonOptions));
        Assert.True(files.IsCancelled(4, read.TaskId));
        Assert.False(files.IsCancelled(4, Guid.NewGuid().ToString()));

        Directory.CreateDirectory(files.SpeechDirectory);
        File.WriteAllText(Path.Combine(files.SpeechDirectory, "say-2.json"), JsonSerializer.Serialize(new BodySpeech("0.1", 2, "second", "2026-10-14T06:00:00.000Z"), BodyBridgeFiles.JsonOptions));
        File.WriteAllText(Path.Combine(files.SpeechDirectory, "say-1.json"), JsonSerializer.Serialize(new BodySpeech("0.1", 1, "first", "2026-10-14T06:00:00.000Z"), BodyBridgeFiles.JsonOptions));
        Assert.Equal(new[] { "first", "second" }, files.TakeSpeech().Select(line => line.Text));
        Assert.Empty(files.TakeSpeech());

        Assert.Null(files.ReadCheatGrant());
        Directory.CreateDirectory(Path.GetDirectoryName(files.CheatGrantPath)!);
        File.WriteAllText(files.CheatGrantPath, "{\"version\":\"0.1\",\"granted\":true,\"at\":\"2026-10-14T06:00:00.000Z\",\"quote\":\"允许使用一切手段\"}");
        Assert.True(files.ReadCheatGrant()?.Granted);

        var interrupt = files.WriteGoalInterrupt("stay", DateTimeOffset.FromUnixTimeMilliseconds(1_791_960_000_000));
        Assert.EndsWith("interrupt-1791960000000.json", interrupt);
        Assert.Contains("\"command\":\"stay\"", File.ReadAllText(interrupt));
    }

    [Fact]
    public void StateBeyondTheBoundIsRefused()
    {
        var files = new BodyBridgeFiles(this.root);
        var rows = Enumerable.Repeat(new string('.', 600), 1000).ToArray();
        var state = new BodyState("0.1", 1, "2026-10-14T06:00:00.000Z", 1, false, new BodyTime(1, "spring", 1, 1, 600, "clear"),
            new BodyPlayerState("Farm", 0, 0, 0, 0, "down", "A", 0, 100, 270, Array.Empty<BodyItem>()), null,
            new BodyMap("Farm", 600, 1000, rows), Array.Empty<BodyObject>(), Array.Empty<BodyCharacter>(), Array.Empty<BodyWarp>(), new BodyTruncation(0));
        Assert.Throws<InvalidDataException>(() => files.WriteState(state));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root)) Directory.Delete(this.root, true);
    }
}
