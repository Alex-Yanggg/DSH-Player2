using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>Something the companion's DSH session did, queued for the game thread.</summary>
public sealed record AcpEvent(string Kind, string SessionId, string Text);

/// <summary>
/// Thin client for DSH's own automation protocol (ACP, newline-delimited
/// JSON-RPC over the child's stdio). DSH owns sessions, models, tools, goals
/// and logs; this class only frames messages. Reads happen on a background
/// thread and never touch game state: the game drains <see cref="Events"/>.
/// </summary>
public sealed class AcpClient : IDisposable
{
    public const string Said = "said";
    public const string TurnEnded = "turn-ended";
    public const string Exited = "exited";

    private readonly TextWriter writer;
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonNode?>> pending = new();
    private readonly ConcurrentDictionary<int, string> prompts = new();
    private readonly object writeLock = new();
    private readonly Process? process;
    private int nextId;
    private string? openMessageId;
    private string? openSessionId;
    private readonly StringBuilder openText = new();

    public AcpClient(Stream toServer, Stream fromServer, Process? process = null)
    {
        this.writer = new StreamWriter(toServer, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        this.process = process;
        var reader = new StreamReader(fromServer, Encoding.UTF8);
        new Thread(() => this.ReadLoop(reader)) { IsBackground = true, Name = "player2-acp" }.Start();
    }

    /// <summary>Companion speech and turn ends, in arrival order.</summary>
    public ConcurrentQueue<AcpEvent> Events { get; } = new();

    /// <summary>Starts <c>dsh --profile acp</c> with the given patch overlays and connects to it.</summary>
    public static AcpClient Launch(string dshCommand, IEnumerable<string> patches, string workingDirectory)
    {
        var start = new ProcessStartInfo
        {
            FileName = dshCommand,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = false,
            WorkingDirectory = workingDirectory,
            StandardOutputEncoding = Encoding.UTF8,
        };
        start.ArgumentList.Add("--profile");
        start.ArgumentList.Add("acp");
        foreach (var patch in patches)
        {
            start.ArgumentList.Add("--patch");
            start.ArgumentList.Add(patch);
        }
        var process = Process.Start(start) ?? throw new InvalidOperationException("DSH did not start.");
        return new AcpClient(process.StandardInput.BaseStream, process.StandardOutput.BaseStream, process);
    }

    public Task InitializeAsync() =>
        this.RequestAsync("initialize", new JsonObject { ["protocolVersion"] = 1, ["clientCapabilities"] = new JsonObject() });

    /// <summary>Resumes the save's session when DSH still has it, otherwise opens a new one; returns its id.</summary>
    public async Task<string> OpenSessionAsync(string? sessionId, string cwd, JsonArray mcpServers)
    {
        if (!string.IsNullOrEmpty(sessionId))
        {
            try
            {
                await this.RequestAsync("session/resume", new JsonObject { ["sessionId"] = sessionId, ["cwd"] = cwd, ["mcpServers"] = mcpServers.Clone() });
                return sessionId;
            }
            catch (AcpException)
            {
                // Unknown or unreadable session: the save starts a fresh one; the old log stays in DSH.
            }
        }
        var created = await this.RequestAsync("session/new", new JsonObject { ["cwd"] = cwd, ["mcpServers"] = mcpServers.Clone() });
        return created?["sessionId"]?.GetValue<string>() ?? throw new AcpException("session/new returned no sessionId");
    }

    /// <summary>Sends one player-side message; completes when DSH settles the turn.</summary>
    public async Task<string> PromptAsync(string sessionId, string text)
    {
        var result = await this.RequestAsync("session/prompt", new JsonObject
        {
            ["sessionId"] = sessionId,
            ["prompt"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }),
        }, sessionId);
        return result?["stopReason"]?.GetValue<string>() ?? "end_turn";
    }

    /// <summary>Stops the turn in flight and any autonomous goal round; the goal itself stays.</summary>
    public void Cancel(string sessionId) =>
        this.Write(new JsonObject { ["jsonrpc"] = "2.0", ["method"] = "session/cancel", ["params"] = new JsonObject { ["sessionId"] = sessionId } });

    public void Dispose()
    {
        try
        {
            this.writer.Dispose();
            if (this.process is { HasExited: false } running && !running.WaitForExit(2000))
            {
                running.Kill(entireProcessTree: true);
            }
        }
        catch (Exception)
        {
            // Teardown is best effort; DSH flushes its own log on stdin EOF.
        }
    }

    private async Task<JsonNode?> RequestAsync(string method, JsonObject parameters, string? promptSession = null)
    {
        var id = Interlocked.Increment(ref this.nextId);
        var completion = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        this.pending[id] = completion;
        if (promptSession is not null) this.prompts[id] = promptSession;
        this.Write(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = method, ["params"] = parameters });
        return await completion.Task.ConfigureAwait(false);
    }

    private void Write(JsonObject message)
    {
        lock (this.writeLock)
        {
            this.writer.WriteLine(message.ToJsonString());
        }
    }

    private void ReadLoop(StreamReader reader)
    {
        string? error = null;
        try
        {
            string? line;
            while ((line = reader.ReadLine()) is not null)
            {
                if (line.Trim().Length == 0) continue;
                JsonNode? message;
                try { message = JsonNode.Parse(line); }
                catch (JsonException) { continue; }
                if (message is JsonObject frame) this.Dispatch(frame);
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }
        this.FlushMessage();
        foreach (var waiting in this.pending.Values) waiting.TrySetException(new AcpException("DSH exited"));
        this.pending.Clear();
        this.Events.Enqueue(new AcpEvent(Exited, "", error ?? "DSH closed its output"));
    }

    private void Dispatch(JsonObject frame)
    {
        var method = frame["method"]?.GetValue<string>();
        var id = frame["id"];
        if (method is null && id is not null && this.pending.TryRemove(id.GetValue<int>(), out var waiting))
        {
            if (this.prompts.TryRemove(id.GetValue<int>(), out var promptSession))
            {
                // Updates precede their prompt's response on the wire, so the turn's last words are already buffered.
                this.FlushMessage();
                var stop = frame["result"]?["stopReason"]?.GetValue<string>() ?? "error";
                this.Events.Enqueue(new AcpEvent(TurnEnded, promptSession, stop));
            }
            if (frame["error"] is JsonNode failure) waiting.TrySetException(new AcpException(failure.ToJsonString()));
            else waiting.TrySetResult(frame["result"]);
            return;
        }
        if (method == "session/request_permission" && id is not null)
        {
            // The player's request is the authorization (P2-0021); DSH asks only for tools that need it.
            this.Write(new JsonObject
            {
                ["jsonrpc"] = "2.0",
                ["id"] = id.Clone(),
                ["result"] = new JsonObject { ["outcome"] = new JsonObject { ["outcome"] = "selected", ["optionId"] = "allow-once" } },
            });
            return;
        }
        if (method == "session/update")
        {
            var parameters = frame["params"];
            var update = parameters?["update"];
            var sessionId = parameters?["sessionId"]?.GetValue<string>() ?? "";
            if (update?["sessionUpdate"]?.GetValue<string>() == "agent_message_chunk"
                && update["content"]?["type"]?.GetValue<string>() == "text")
            {
                var messageId = update["messageId"]?.GetValue<string>() ?? "";
                if (messageId != this.openMessageId) this.FlushMessage();
                this.openMessageId = messageId;
                this.openSessionId = sessionId;
                this.openText.Append(update["content"]!["text"]!.GetValue<string>());
                return;
            }
            this.FlushMessage();
            return;
        }
        if (id is not null && method is not null)
        {
            this.Write(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id.Clone(), ["error"] = new JsonObject { ["code"] = -32601, ["message"] = "not supported" } });
        }
    }

    /// <summary>Reader thread only: emits the buffered assistant message as one line of speech.</summary>
    private void FlushMessage()
    {
        var text = this.openText.ToString().Trim();
        if (text.Length > 0) this.Events.Enqueue(new AcpEvent(Said, this.openSessionId ?? "", text));
        this.openText.Clear();
        this.openMessageId = null;
    }
}

public sealed class AcpException : Exception
{
    public AcpException(string message) : base(message) { }
}

internal static class JsonNodeCopy
{
    /// <summary>A detached copy (net6 has no JsonNode.DeepClone); a node can have only one parent.</summary>
    public static JsonNode? Clone(this JsonNode? node) => node is null ? null : JsonNode.Parse(node.ToJsonString());
}
