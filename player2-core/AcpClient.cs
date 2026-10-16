using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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
    /// <summary>Where a spoken sentence ends: CJK or Latin end marks (with closing quotes), a line break, or ". ".</summary>
    private static readonly Regex SentenceEnd = new(@"[。！？!?\n]+[」』”""）)]*|\.\s", RegexOptions.Compiled);
    private readonly Queue<string> diagnostics = new();

    public AcpClient(Stream toServer, Stream fromServer, Process? process = null)
    {
        this.writer = new StreamWriter(toServer, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        this.process = process;
        var reader = new StreamReader(fromServer, Encoding.UTF8);
        new Thread(() => this.ReadLoop(reader)) { IsBackground = true, Name = "player2-acp" }.Start();
    }

    /// <summary>Whether DSH's output has closed; a closed client never recovers.</summary>
    public bool HasExited { get; private set; }

    /// <summary>Companion speech and turn ends, in arrival order.</summary>
    public ConcurrentQueue<AcpEvent> Events { get; } = new();

    /// <summary>
    /// Starts <c>dsh --profile acp</c> with the given patch overlays and connects to it.
    /// A Windows <c>.cmd</c> shim runs through the command shell; DSH's own
    /// diagnostics on stderr are kept as the last lines for an exit report.
    /// </summary>
    public static AcpClient Launch(string dshCommand, IEnumerable<string> patches, string workingDirectory, IReadOnlyDictionary<string, string>? environment = null)
    {
        var arguments = new List<string> { "--profile", "acp" };
        foreach (var patch in patches)
        {
            arguments.Add("--patch");
            arguments.Add(patch);
        }
        var start = new ProcessStartInfo
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = workingDirectory,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (OperatingSystem.IsWindows() && dshCommand.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase))
        {
            start.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
            start.Arguments = $"/d /s /c \"{Quote(dshCommand)} {string.Join(" ", arguments.ConvertAll(Quote))}\"";
        }
        else
        {
            start.FileName = dshCommand;
            foreach (var argument in arguments) start.ArgumentList.Add(argument);
        }
        foreach (var (name, value) in environment ?? new Dictionary<string, string>()) start.Environment[name] = value;
        var process = Process.Start(start) ?? throw new InvalidOperationException("DSH did not start.");
        var client = new AcpClient(process.StandardInput.BaseStream, process.StandardOutput.BaseStream, process);
        process.ErrorDataReceived += (_, line) => client.RecordDiagnostic(line.Data);
        process.BeginErrorReadLine();
        return client;
    }

    /// <summary>DSH's last diagnostic lines (stderr), for reporting why it stopped.</summary>
    public string Diagnostics
    {
        get { lock (this.diagnostics) return string.Join("\n", this.diagnostics); }
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

    private void RecordDiagnostic(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        lock (this.diagnostics)
        {
            this.diagnostics.Enqueue(line.Length > 300 ? line[..300] : line);
            while (this.diagnostics.Count > 8) this.diagnostics.Dequeue();
        }
    }

    private static string Quote(string value) => value.IndexOfAny(new[] { ' ', '"', '&', '(', ')', '^' }) < 0 ? value : $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

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
        this.HasExited = true;
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
                var stop = frame["error"] is JsonNode error
                    ? $"error: {error["message"]?.GetValue<string>() ?? error.ToJsonString()}"
                    : frame["result"]?["stopReason"]?.GetValue<string>() ?? "end_turn";
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
                // Each sentence is said as soon as it is complete, so the first words show while the rest streams.
                var text = this.openText.ToString();
                var ends = SentenceEnd.Matches(text);
                if (ends.Count > 0)
                {
                    var cut = ends[^1].Index + ends[^1].Length;
                    this.Speak(text[..cut]);
                    this.openText.Remove(0, cut);
                }
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

    /// <summary>Reader thread only: says what is left of the buffered assistant message.</summary>
    private void FlushMessage()
    {
        this.Speak(this.openText.ToString());
        this.openText.Clear();
        this.openMessageId = null;
    }

    private void Speak(string text)
    {
        text = text.Trim();
        if (text.Length > 0) this.Events.Enqueue(new AcpEvent(Said, this.openSessionId ?? "", text));
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
