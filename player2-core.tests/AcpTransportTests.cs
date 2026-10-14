using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class AcpClientTests : IDisposable
{
    private readonly AnonymousPipeServerStream toServer = new(PipeDirection.Out);
    private readonly AnonymousPipeServerStream toClient = new(PipeDirection.Out);
    private readonly StreamReader serverIn;
    private readonly StreamWriter serverOut;
    private readonly AcpClient client;

    public AcpClientTests()
    {
        this.serverIn = new StreamReader(new AnonymousPipeClientStream(PipeDirection.In, this.toServer.ClientSafePipeHandle));
        this.serverOut = new StreamWriter(this.toClient) { AutoFlush = true, NewLine = "\n" };
        this.client = new AcpClient(this.toServer, new AnonymousPipeClientStream(PipeDirection.In, this.toClient.ClientSafePipeHandle));
    }

    public void Dispose()
    {
        this.client.Dispose();
        this.toClient.Dispose();
    }

    [Fact]
    public async Task PromptTurnsCommittedMessagesIntoSpeechAndAnswersPermission()
    {
        var init = this.client.InitializeAsync();
        this.Reply(await this.NextAsync("initialize"), new JsonObject { ["protocolVersion"] = 1 });
        await init;

        var open = this.client.OpenSessionAsync(null, "/save", new JsonArray());
        var created = await this.NextAsync("session/new");
        Assert.Equal("/save", created["params"]!["cwd"]!.GetValue<string>());
        this.Reply(created, new JsonObject { ["sessionId"] = "s1" });
        Assert.Equal("s1", await open);

        var prompt = this.client.PromptAsync("s1", "[chat] hi");
        var asked = await this.NextAsync("session/prompt");
        Assert.Equal("[chat] hi", asked["params"]!["prompt"]![0]!["text"]!.GetValue<string>());
        this.Update("s1", "m1", "Hello");
        this.Update("s1", "m1", " there");
        this.Send(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 99, ["method"] = "session/request_permission", ["params"] = new JsonObject { ["sessionId"] = "s1" } });
        var permission = JsonNode.Parse((await this.serverIn.ReadLineAsync())!)!;
        Assert.Equal(99, permission["id"]!.GetValue<int>());
        Assert.Equal("allow-once", permission["result"]!["outcome"]!["optionId"]!.GetValue<string>());
        this.Update("s1", "m2", "Done.");
        this.Reply(asked, new JsonObject { ["stopReason"] = "end_turn" });
        Assert.Equal("end_turn", await prompt);

        Assert.Equal(new[] { "said:Hello there", "said:Done.", "turn-ended:end_turn" }, this.Drain());
    }

    [Fact]
    public async Task UnknownSessionFallsBackToANewOne()
    {
        var open = this.client.OpenSessionAsync("gone", "/save", new JsonArray());
        var resume = await this.NextAsync("session/resume");
        this.Send(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = resume["id"]!.GetValue<int>(), ["error"] = new JsonObject { ["code"] = -32002, ["message"] = "unknown" } });
        this.Reply(await this.NextAsync("session/new"), new JsonObject { ["sessionId"] = "fresh" });
        Assert.Equal("fresh", await open);
    }

    [Fact]
    public async Task ExitFailsPendingCallsAndIsReported()
    {
        var init = this.client.InitializeAsync();
        await this.NextAsync("initialize");
        this.toClient.Dispose();
        await Assert.ThrowsAsync<AcpException>(() => init);
        Assert.Contains(this.Drain(), line => line.StartsWith("exited:", StringComparison.Ordinal));
    }

    private async Task<JsonObject> NextAsync(string method)
    {
        var frame = JsonNode.Parse((await this.serverIn.ReadLineAsync())!)!.AsObject();
        Assert.Equal(method, frame["method"]!.GetValue<string>());
        return frame;
    }

    private void Reply(JsonObject request, JsonObject result) =>
        this.Send(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = request["id"]!.GetValue<int>(), ["result"] = result });

    private void Update(string session, string messageId, string text) => this.Send(new JsonObject
    {
        ["jsonrpc"] = "2.0",
        ["method"] = "session/update",
        ["params"] = new JsonObject
        {
            ["sessionId"] = session,
            ["update"] = new JsonObject { ["sessionUpdate"] = "agent_message_chunk", ["messageId"] = messageId, ["content"] = new JsonObject { ["type"] = "text", ["text"] = text } },
        },
    });

    private void Send(JsonObject frame) => this.serverOut.WriteLine(frame.ToJsonString());

    private List<string> Drain()
    {
        var lines = new List<string>();
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            while (this.client.Events.TryDequeue(out var item)) lines.Add($"{item.Kind}:{item.Text}");
            if (lines.Exists(line => line.StartsWith("turn-ended", StringComparison.Ordinal) || line.StartsWith("exited", StringComparison.Ordinal))) break;
            Thread.Sleep(20);
        }
        return lines;
    }
}

public sealed class GameMcpServerTests
{
    [Fact]
    public async Task ServesBodyToolsOverHttpBehindItsToken()
    {
        var channel = new BodyChannel();
        channel.Attach(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        using var server = new GameMcpServer(channel.Tools());
        server.Start();
        var entry = server.McpServerEntry();
        var url = entry["url"]!.GetValue<string>();
        var bearer = entry["headers"]![0]!["value"]!.GetValue<string>();
        using var http = new HttpClient();

        var refused = await http.PostAsync(url, new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);

        async Task<JsonNode> Call(string method, JsonObject? parameters = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = method, ["params"] = parameters ?? new JsonObject() }.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("Authorization", bearer);
            var response = await http.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        }

        Assert.Equal("player2-game", (await Call("initialize"))["result"]!["serverInfo"]!["name"]!.GetValue<string>());
        var names = (await Call("tools/list"))["result"]!["tools"]!.AsArray();
        Assert.Contains(names, tool => tool!["name"]!.GetValue<string>() == "body_run");
        var cancel = await Call("tools/call", new JsonObject { ["name"] = "body_cancel", ["arguments"] = new JsonObject() });
        Assert.False(cancel["result"]!["isError"]!.GetValue<bool>());
        Assert.Equal("nothing was running", cancel["result"]!["content"]![0]!["text"]!.GetValue<string>());
        var unknown = await Call("tools/call", new JsonObject { ["name"] = "fly" });
        Assert.True(unknown["result"]!["isError"]!.GetValue<bool>());
    }
}

public sealed class BodyChannelTests
{
    private static BodyState State(bool paused) => new(BodyChannel.ProtocolVersion, 1, "now", 1, paused,
        new BodyTime(1, "spring", 1, 1, 600, "sun"), null!, null, new BodyMap("Farm", 0, 0, Array.Empty<string>()),
        Array.Empty<BodyObject>(), Array.Empty<BodyCharacter>(), Array.Empty<BodyWarp>(), new BodyTruncation(0));

    [Fact]
    public async Task RunWaitsForTheAdaptersTerminalStatus()
    {
        var channel = new BodyChannel();
        channel.Attach(Path.GetTempPath());
        channel.WriteState(State(paused: false));
        var run = Call(channel, "body_run", new JsonObject { ["steps"] = new JsonArray(new JsonObject { ["hold"] = new JsonArray("MoveUp"), ["ms"] = 200 }) });
        var seq = await WaitPending(channel);
        var task = channel.ReadTask(seq);
        Assert.Equal("MoveUp", task.Steps[0].Hold![0]);
        channel.WriteStatus(new BodyTaskStatus(BodyChannel.ProtocolVersion, task.TaskId, seq, "running", 1, 0, Array.Empty<BodyEvent>(), null, 1, "now"));
        Assert.False(run.IsCompleted);
        channel.WriteStatus(new BodyTaskStatus(BodyChannel.ProtocolVersion, task.TaskId, seq, "done", 2, 1, new[] { new BodyEvent(5, "arrived", "Farm") }, null, 2, "now"));
        var result = JsonNode.Parse(await run)!;
        Assert.Equal("done", result["status"]!.GetValue<string>());
        Assert.Equal("arrived", result["events"]![0]!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task APausedWorldHoldsTheWaitAndTimeoutCancels()
    {
        var channel = new BodyChannel();
        channel.Attach(Path.GetTempPath());
        channel.WriteState(State(paused: true));
        var run = Call(channel, "body_run", new JsonObject { ["steps"] = new JsonArray(new JsonObject { ["ms"] = 10 }), ["timeoutMs"] = 300 });
        var seq = await WaitPending(channel);
        await Task.Delay(700);
        Assert.False(run.IsCompleted);
        channel.WriteState(State(paused: false));
        var result = JsonNode.Parse(await run)!;
        Assert.Equal("timeout", result["status"]!.GetValue<string>());
        Assert.True(channel.IsCancelled(seq, channel.ReadTask(seq).TaskId));
    }

    private static Task<string> Call(BodyChannel channel, string name, JsonObject args) =>
        Array.Find(channel.Tools() is GameTool[] tools ? tools : new List<GameTool>(channel.Tools()).ToArray(), tool => tool.Name == name)!.Call(args, CancellationToken.None);

    private static async Task<int> WaitPending(BodyChannel channel)
    {
        for (var i = 0; i < 100; i++)
        {
            var pending = channel.PendingTaskSequences(0);
            if (pending.Count > 0) return pending[^1];
            await Task.Delay(10);
        }
        throw new TimeoutException("no task was submitted");
    }
}

public sealed class SessionLayoutTests
{
    [Fact]
    public void ScopesOneSaveOfOnePersonToOneSafeFolder()
    {
        Assert.Equal(System.IO.Path.Combine("root", "projects", "mira-chan", "sessions", "42"), SessionLayout.SessionDirectory("root", " Mira Chan! ", SessionLayout.SaveId(42)));
        Assert.Throws<ArgumentException>(() => SessionLayout.SessionDirectory("root", "???", "1"));
    }
}
