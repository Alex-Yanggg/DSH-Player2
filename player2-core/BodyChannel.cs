using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>
/// The companion's body as seen from DSH (P2-0021 body protocol, now in
/// memory instead of files): the adapter publishes declaration, world and task
/// status on the game thread, and builds state only when the plugin asks for
/// it (serialized here, off the game thread); the plugin's calls arrive
/// through <see cref="Tools"/> on pool threads. Only the spoken cheat grant is
/// stored on disk, because it belongs to the save.
/// </summary>
public sealed class BodyChannel
{
    public const string ProtocolVersion = "0.2";
    public const int MaxStateBytes = 512 * 1024;

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = null,
        WriteIndented = false,
    };

    private readonly object gate = new();
    private readonly SortedDictionary<int, BodyTask> tasks = new();
    private readonly Dictionary<int, BodyTaskStatus> statuses = new();
    private readonly Dictionary<int, TaskCompletionSource<BodyTaskStatus>> waiters = new();
    private readonly HashSet<int> cancelled = new();
    private static readonly TimeSpan StateWait = TimeSpan.FromSeconds(2);
    private string declaration = "null";
    private BodyState? state;
    private TaskCompletionSource<bool>? stateRequest;
    private string world = "null";
    private bool paused = true;
    private int nextSeq;
    private string? cheatGrantPath;

    /// <summary>Binds the cheat grant to one save; pending work from another save is dropped.</summary>
    public void Attach(string sessionDirectory)
    {
        lock (this.gate)
        {
            this.cheatGrantPath = Path.Combine(sessionDirectory, "goal", "cheat.json");
            foreach (var waiter in this.waiters.Values) waiter.TrySetCanceled();
            this.waiters.Clear();
            this.tasks.Clear();
            this.statuses.Clear();
            this.cancelled.Clear();
        }
    }

    // Game thread: publish.
    public void WriteDeclaration(BodyDeclaration value) => this.Set(ref this.declaration, value);
    public int WriteWorld(BodyWorld value) => this.Set(ref this.world, value);

    /// <summary>Whether the plugin is waiting for a fresh state (the adapter builds one on its next tick).</summary>
    public bool StateWanted
    {
        get { lock (this.gate) return this.stateRequest is not null; }
    }

    public void SetPaused(bool value)
    {
        lock (this.gate) this.paused = value;
    }

    public void WriteState(BodyState value)
    {
        TaskCompletionSource<bool>? request;
        lock (this.gate)
        {
            this.paused = value.Paused;
            this.state = value;
            request = this.stateRequest;
            this.stateRequest = null;
        }
        request?.TrySetResult(true);
    }

    public void WriteStatus(BodyTaskStatus status)
    {
        lock (this.gate)
        {
            this.statuses[status.Seq] = status;
            if (status.Status is "done" or "interrupted" or "failed" or "cancelled"
                && this.waiters.Remove(status.Seq, out var waiter))
            {
                waiter.TrySetResult(status);
            }
        }
    }

    public bool HasStatus(int seq)
    {
        lock (this.gate) return this.statuses.ContainsKey(seq);
    }

    /// <summary>Unanswered task sequences above <paramref name="after"/>, oldest first.</summary>
    public IReadOnlyList<int> PendingTaskSequences(int after)
    {
        lock (this.gate) return this.tasks.Keys.Where(seq => seq > after && !this.statuses.ContainsKey(seq)).ToArray();
    }

    public BodyTask ReadTask(int seq)
    {
        lock (this.gate) return this.tasks[seq];
    }

    public bool IsCancelled(int seq, string taskId)
    {
        lock (this.gate) return this.cancelled.Contains(seq) && this.tasks.TryGetValue(seq, out var task) && task.TaskId == taskId;
    }

    public BodyCheatGrant? ReadCheatGrant()
    {
        var path = this.cheatGrantPath;
        if (path is null || !File.Exists(path)) return null;
        try { return JsonSerializer.Deserialize<BodyCheatGrant>(File.ReadAllText(path), JsonOptions); }
        catch (Exception ex) when (ex is IOException or JsonException) { return null; }
    }

    // Pool threads: the plugin's calls.
    public IReadOnlyList<GameTool> Tools() => new[]
    {
        Tool("body_declaration", "Inputs the body accepts, state fields, grid legend and limits.", Empty(), (_, _) => Task.FromResult(this.Read(ref this.declaration))),
        Tool("world_state", "Raw state around the body (map rows, objects, characters, warps, clock, toolbar, open menu).", Empty(), this.ReadStateAsync),
        Tool("world_map", "Every location and its warps.", Empty(), (_, _) => Task.FromResult(this.Read(ref this.world))),
        Tool("body_run", "Plays one raw input sequence on the body and returns its final status. A paused game stops the input at once (status cancelled, reason paused).",
            Schema(("steps", "array"), ("until", "object"), ("fastState", "boolean"), ("timeoutMs", "number")), this.RunAsync),
        Tool("body_cancel", "Stops the body's running input sequence.", Empty(), (_, _) => Task.FromResult(this.CancelActive())),
        Tool("cheat_grant", "Records the player's own spoken grant or withdrawal of cheat inputs for this save.",
            Schema(("granted", "boolean"), ("quote", "string")), (args, _) => Task.FromResult(this.Grant(args))),
    };

    private static readonly TimeSpan PausedReturn = TimeSpan.FromSeconds(1);
    private const string PausedReason = "paused: the player paused the game; keep the goal and end this step, play resumes later";

    private async Task<string> RunAsync(JsonObject args, CancellationToken cancel)
    {
        var steps = args["steps"].Deserialize<List<BodyInputStep>>(JsonOptions);
        if (steps is null || steps.Count == 0) throw new InvalidDataException("steps must hold at least one input step");
        var timeoutMs = args["timeoutMs"]?.Deserialize<double?>() ?? steps.Sum(step => Math.Max(step.Ms, 17)) + 15_000;
        var completion = new TaskCompletionSource<BodyTaskStatus>(TaskCreationOptions.RunContinuationsAsynchronously);
        BodyTask task;
        lock (this.gate)
        {
            task = new BodyTask(ProtocolVersion, Guid.NewGuid().ToString(), ++this.nextSeq, DateTimeOffset.UtcNow.ToString("O"),
                steps, args["until"].Deserialize<BodyUntil>(JsonOptions), args["fastState"]?.GetValue<bool>());
            this.tasks[task.Seq] = task;
            this.waiters[task.Seq] = completion;
        }
        var budget = TimeSpan.FromMilliseconds(timeoutMs);
        var tick = TimeSpan.FromMilliseconds(250);
        var heldFor = TimeSpan.Zero;
        while (!completion.Task.IsCompleted)
        {
            await Task.WhenAny(completion.Task, Task.Delay(tick, cancel)).ConfigureAwait(false);
            if (cancel.IsCancellationRequested) break;
            bool holding;
            lock (this.gate) holding = this.paused;
            heldFor = holding ? heldFor + tick : TimeSpan.Zero;
            if (heldFor >= PausedReturn)
            {
                // A paused game never blocks a turn: the goal is kept and the companion carries on when play resumes.
                lock (this.gate) this.cancelled.Add(task.Seq);
                return JsonSerializer.Serialize(new { seq = task.Seq, status = "cancelled", reason = PausedReason, events = Array.Empty<BodyEvent>() }, JsonOptions);
            }
            if (!holding) budget -= tick;
            if (budget <= TimeSpan.Zero) break;
        }
        if (!completion.Task.IsCompleted)
        {
            lock (this.gate) this.cancelled.Add(task.Seq);
            return JsonSerializer.Serialize(new { seq = task.Seq, status = "timeout", reason = $"not finished after {timeoutMs:0} ms of unpaused time", events = Array.Empty<BodyEvent>() }, JsonOptions);
        }
        var status = await completion.Task.ConfigureAwait(false);
        return JsonSerializer.Serialize(new { seq = status.Seq, status = status.Status, reason = status.Reason, events = status.Events, stateRevision = status.StateRevision }, JsonOptions);
    }

    /// <summary>Asks the game thread for a fresh state; a game that does not tick (title, loading) answers with the last one.</summary>
    private async Task<string> ReadStateAsync(JsonObject _, CancellationToken cancel)
    {
        Task wanted;
        lock (this.gate) wanted = (this.stateRequest ??= new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously)).Task;
        await Task.WhenAny(wanted, Task.Delay(StateWait, cancel)).ConfigureAwait(false);
        BodyState? value;
        lock (this.gate) value = this.state;
        var json = JsonSerializer.Serialize(value, JsonOptions);
        if (json.Length > MaxStateBytes) throw new InvalidDataException($"state would be {json.Length} bytes, over {MaxStateBytes}.");
        return json;
    }

    private string CancelActive()
    {
        lock (this.gate)
        {
            foreach (var seq in this.waiters.Keys) this.cancelled.Add(seq);
            return this.waiters.Count == 0 ? "nothing was running" : "cancel requested";
        }
    }

    private string Grant(JsonObject args)
    {
        var path = this.cheatGrantPath ?? throw new InvalidOperationException("no save is loaded");
        var grant = new BodyCheatGrant(ProtocolVersion, args["granted"]?.GetValue<bool>() ?? false, DateTimeOffset.UtcNow.ToString("O"), args["quote"]?.GetValue<string>() ?? "");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(grant, JsonOptions));
        return grant.Granted ? "cheats granted for this save" : "cheats withdrawn for this save";
    }

    private int Set<T>(ref string slot, T value)
    {
        var json = JsonSerializer.Serialize(value, JsonOptions);
        if (json.Length > MaxStateBytes) throw new InvalidDataException($"{typeof(T).Name} would be {json.Length} bytes, over {MaxStateBytes}.");
        Volatile.Write(ref slot, json);
        return json.Length;
    }

    private string Read(ref string slot) => Volatile.Read(ref slot);

    private static GameTool Tool(string name, string description, JsonObject schema, Func<JsonObject, CancellationToken, Task<string>> call) =>
        new(name, description, schema, call);

    private static JsonObject Empty() => new() { ["type"] = "object", ["properties"] = new JsonObject() };

    private static JsonObject Schema(params (string Name, string Type)[] fields)
    {
        var properties = new JsonObject();
        foreach (var (name, type) in fields) properties[name] = new JsonObject { ["type"] = type };
        return new JsonObject { ["type"] = "object", ["properties"] = properties };
    }
}
