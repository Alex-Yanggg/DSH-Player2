using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DSHPlayer2.Core;

/// <summary>
/// The body file lane of one session (P2-0021): the adapter replaces its
/// declaration, state and world files and every task status; it only reads
/// tasks, cancels, speech and the spoken cheat grant. Reads are bounded and a
/// malformed file is reported, never guessed at.
/// </summary>
public sealed class BodyBridgeFiles
{
    public const string ProtocolVersion = "0.1";
    public const int MaxStateBytes = 512 * 1024;
    public const int MaxFrameBytes = 64 * 1024;

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = null,
        WriteIndented = false,
    };

    private static readonly Regex TaskName = new(@"^task-(\d+)\.json$", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex CancelName = new(@"^cancel-(\d+)\.json$", RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex SpeechName = new(@"^say-(\d+)\.json$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly string session;

    public BodyBridgeFiles(string sessionDirectory)
    {
        if (string.IsNullOrWhiteSpace(sessionDirectory))
        {
            throw new ArgumentException("Body bridge needs a session directory.", nameof(sessionDirectory));
        }
        this.session = Path.GetFullPath(sessionDirectory);
    }

    public string BodyDirectory => Path.Combine(this.session, "body");
    public string InputDirectory => Path.Combine(this.BodyDirectory, "input");
    public string StatusDirectory => Path.Combine(this.BodyDirectory, "status");
    public string SpeechDirectory => Path.Combine(this.session, "speech");
    public string CheatGrantPath => Path.Combine(this.session, "goal", "cheat.json");

    public void WriteDeclaration(BodyDeclaration declaration) => this.Replace(Path.Combine(this.BodyDirectory, "declaration.json"), declaration, MaxFrameBytes);
    public int WriteState(BodyState state) => this.Replace(Path.Combine(this.BodyDirectory, "state.json"), state, MaxStateBytes);
    public int WriteWorld(BodyWorld world) => this.Replace(Path.Combine(this.BodyDirectory, "world.json"), world, MaxStateBytes);
    public void WriteStatus(BodyTaskStatus status) => this.Replace(Path.Combine(this.StatusDirectory, $"task-{status.Seq}.json"), status, MaxFrameBytes);

    public bool HasStatus(int seq) => File.Exists(Path.Combine(this.StatusDirectory, $"task-{seq}.json"));

    /// <summary>Unanswered task sequences above <paramref name="after"/>, oldest first.</summary>
    public IReadOnlyList<int> PendingTaskSequences(int after)
    {
        return Sequences(this.InputDirectory, TaskName).Where(seq => seq > after && !this.HasStatus(seq)).OrderBy(seq => seq).ToArray();
    }

    public BodyTask ReadTask(int seq)
    {
        var task = this.Read<BodyTask>(Path.Combine(this.InputDirectory, $"task-{seq}.json"), MaxFrameBytes);
        if (task.Version != ProtocolVersion) throw new InvalidDataException($"Body task {seq} has version '{task.Version}', expected {ProtocolVersion}.");
        if (task.Seq != seq) throw new InvalidDataException($"Body task file {seq} carries seq {task.Seq}.");
        if (!Guid.TryParse(task.TaskId, out _)) throw new InvalidDataException($"Body task {seq} has a malformed task id.");
        if (task.Steps is null || task.Steps.Count == 0) throw new InvalidDataException($"Body task {seq} has no steps.");
        return task;
    }

    /// <summary>True when the plugin asked to cancel exactly this task.</summary>
    public bool IsCancelled(int seq, string taskId)
    {
        var path = Path.Combine(this.InputDirectory, $"cancel-{seq}.json");
        if (!File.Exists(path)) return false;
        try
        {
            var cancel = this.Read<BodyCancel>(path, MaxFrameBytes);
            return cancel.Seq == seq && string.Equals(cancel.TaskId, taskId, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException)
        {
            // A half-written cancel is read again next poll.
            return false;
        }
    }

    /// <summary>Unshown speech lines, oldest first; a line is shown once and then renamed aside.</summary>
    public IReadOnlyList<BodySpeech> TakeSpeech()
    {
        var lines = new List<BodySpeech>();
        foreach (var seq in Sequences(this.SpeechDirectory, SpeechName).OrderBy(seq => seq))
        {
            var path = Path.Combine(this.SpeechDirectory, $"say-{seq}.json");
            try
            {
                var speech = this.Read<BodySpeech>(path, MaxFrameBytes);
                File.Move(path, path + ".shown", overwrite: true);
                if (speech.Version == ProtocolVersion && !string.IsNullOrWhiteSpace(speech.Text)) lines.Add(speech);
            }
            catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException)
            {
                // Possibly still being written; the next poll retries it.
            }
        }
        return lines;
    }

    /// <summary>The spoken cheat switch for this save, or null when none was given.</summary>
    public BodyCheatGrant? ReadCheatGrant()
    {
        if (!File.Exists(this.CheatGrantPath)) return null;
        try
        {
            return this.Read<BodyCheatGrant>(this.CheatGrantPath, MaxFrameBytes);
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException)
        {
            return null;
        }
    }

    /// <summary>
    /// Forwards the player's own stop command to the goal lane, so a goal stops
    /// at once instead of waiting for the chat reply. Returns the file written.
    /// </summary>
    public string WriteGoalInterrupt(string command, DateTimeOffset at)
    {
        var path = Path.Combine(this.session, "goal", $"interrupt-{at.ToUnixTimeMilliseconds()}.json");
        this.Replace(path, new BodyGoalInterrupt(ProtocolVersion, DecisionBridgeRules.UtcTimestamp(at), command), MaxFrameBytes);
        return path;
    }

    /// <summary>Removes task, cancel, status and shown speech files older than <paramref name="age"/>.</summary>
    public int SweepOlderThan(TimeSpan age, DateTimeOffset now)
    {
        var removed = 0;
        foreach (var directory in new[] { this.InputDirectory, this.StatusDirectory, this.SpeechDirectory })
        {
            if (!Directory.Exists(directory)) continue;
            foreach (var file in Directory.EnumerateFiles(directory))
            {
                try
                {
                    if (now - File.GetLastWriteTimeUtc(file) > age)
                    {
                        File.Delete(file);
                        removed++;
                    }
                }
                catch (IOException)
                {
                }
            }
        }
        return removed;
    }

    public T Read<T>(string path, int limit)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (stream.Length > limit) throw new InvalidDataException($"{Path.GetFileName(path)} exceeds {limit} bytes.");
        var buffer = new byte[stream.Length];
        var read = 0;
        while (read < buffer.Length)
        {
            var n = stream.Read(buffer, read, buffer.Length - read);
            if (n == 0) break;
            read += n;
        }
        return JsonSerializer.Deserialize<T>(buffer.AsSpan(0, read), JsonOptions)
            ?? throw new InvalidDataException($"{Path.GetFileName(path)} is empty.");
    }

    /// <summary>Atomically replaces one file; returns the byte size written.</summary>
    private int Replace<T>(string path, T value, int limit)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        if (bytes.Length > limit) throw new InvalidDataException($"{Path.GetFileName(path)} would be {bytes.Length} bytes, over the {limit} byte bound.");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = $"{path}.{Guid.NewGuid():N}.tmp";
        File.WriteAllBytes(temp, bytes);
        File.Move(temp, path, overwrite: true);
        return bytes.Length;
    }

    private static IEnumerable<int> Sequences(string directory, Regex pattern)
    {
        if (!Directory.Exists(directory)) yield break;
        foreach (var file in Directory.EnumerateFiles(directory))
        {
            var match = pattern.Match(Path.GetFileName(file));
            if (match.Success && int.TryParse(match.Groups[1].Value, out var seq) && seq > 0) yield return seq;
        }
    }
}
