using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>Bounded, fixed-path, write-once persistence for the Player decision bridge.</summary>
public sealed class DecisionBridgeFiles
{
    public const int MaxFileBytes = 64 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string root;

    private static readonly Regex SequenceFileName = new(
        @"^(?:turn|proposal|request|error|grant|receipt)-(\d+)\.json$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public DecisionBridgeFiles(string bridgeDirectory)
    {
        if (string.IsNullOrWhiteSpace(bridgeDirectory))
        {
            throw new ArgumentException("Decision bridge directory must not be empty.", nameof(bridgeDirectory));
        }
        this.root = Path.GetFullPath(bridgeDirectory);
    }

    public Task PublishTurnAsync(DecisionTurnEnvelope turn, CancellationToken cancellationToken = default)
    {
        return this.WriteOnceAsync(this.PathFor("inbox", "turn", turn.Sequence), turn, cancellationToken);
    }

    /// <summary>
    /// Allocates a bridge-wide monotonic sequence instead of reusing game-day
    /// numbers such as <c>turn-1</c> for every save. Existing immutable bridge
    /// artifacts are included, so a new save or a restarted game cannot consume
    /// another turn's stale request or error.
    /// </summary>
    public int NextAvailableSequence(DateTimeOffset now)
    {
        var unixSeconds = now.ToUnixTimeSeconds();
        if (unixSeconds is < 1 or >= int.MaxValue)
        {
            throw new ArgumentOutOfRangeException(nameof(now), "The current time cannot be represented as a decision sequence.");
        }
        var candidate = (int)unixSeconds;
        foreach (var directoryName in new[] { "inbox", "drafts", "outbox", "grants", "receipts" })
        {
            var directory = Path.Combine(this.root, directoryName);
            if (!Directory.Exists(directory))
            {
                continue;
            }
            foreach (var path in Directory.EnumerateFiles(directory, "*.json"))
            {
                var match = SequenceFileName.Match(Path.GetFileName(path));
                if (match.Success && int.TryParse(match.Groups[1].Value, out var existing) && existing >= candidate)
                {
                    if (existing == int.MaxValue)
                    {
                        throw new InvalidOperationException("The decision bridge sequence space is exhausted.");
                    }
                    candidate = existing + 1;
                }
            }
        }
        return candidate;
    }

    /// <summary>
    /// Clears only a prior DSH runtime error before a deliberate game-side
    /// retry. The immutable input and the DSH JSONL trace remain intact, while
    /// a repaired DSH process may answer the same day instead of being held
    /// hostage by yesterday's launch error.
    /// </summary>
    public Task ClearRuntimeErrorAsync(int sequence, CancellationToken cancellationToken = default)
    {
        var path = this.PathFor("outbox", "error", sequence);
        return Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (File.Exists(path)) File.Delete(path);
        }, cancellationToken);
    }

    /// <summary>
    /// Resets only an unreceived request after a bridge contract upgrade. This
    /// is a development migration for a conflicting immutable turn; grants and
    /// receipts are intentionally never removed, so settled player history is
    /// preserved.
    /// </summary>
    public async Task ResetUnsettledTurnAsync(int sequence, CancellationToken cancellationToken = default)
    {
        if (await this.TryReadReceiptAsync(sequence, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw new InvalidOperationException("Refusing to reset a settled decision bridge turn.");
        }
        await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            foreach (var path in new[]
            {
                this.PathFor("inbox", "turn", sequence),
                this.PathFor("drafts", "proposal", sequence),
                this.PathFor("outbox", "request", sequence),
                this.PathFor("outbox", "error", sequence),
            })
            {
                if (File.Exists(path)) File.Delete(path);
            }
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task<BridgeActionRequest?> TryReadRequestAsync(
        DecisionTurnEnvelope turn,
        CancellationToken cancellationToken = default)
    {
        var request = await this.TryReadAsync<BridgeActionRequest>(
            this.PathFor("outbox", "request", turn.Sequence),
            cancellationToken).ConfigureAwait(false);
        return request is null ? null : DecisionBridgeRules.ValidateRequest(turn, request).Request;
    }

    /// <summary>Reads the DSH-owned terminal error channel for a decision turn.</summary>
    public async Task<BridgeRuntimeError?> TryReadErrorAsync(
        DecisionTurnEnvelope turn,
        CancellationToken cancellationToken = default)
    {
        var error = await this.TryReadAsync<BridgeRuntimeError>(
            this.PathFor("outbox", "error", turn.Sequence),
            cancellationToken).ConfigureAwait(false);
        if (error is null)
        {
            return null;
        }
        if (error.Version != DecisionBridgeRules.WireVersion || error.Sequence != turn.Sequence ||
            string.IsNullOrWhiteSpace(error.TraceId) || string.IsNullOrWhiteSpace(error.Code) ||
            string.IsNullOrWhiteSpace(error.Message))
        {
            throw new InvalidDataException("DSH decision error does not belong to the active bridge turn.");
        }
        return error;
    }

    public Task WriteGrantAsync(
        int sequence,
        BridgePermissionGrant grant,
        CancellationToken cancellationToken = default)
    {
        return this.WriteOnceAsync(this.PathFor("grants", "grant", sequence), grant, cancellationToken);
    }

    public Task WriteReceiptAsync(
        int sequence,
        BridgeActionReceipt receipt,
        CancellationToken cancellationToken = default)
    {
        return this.WriteOnceAsync(this.PathFor("receipts", "receipt", sequence), receipt, cancellationToken);
    }

    public Task<BridgeActionReceipt?> TryReadReceiptAsync(int sequence, CancellationToken cancellationToken = default)
    {
        return this.TryReadAsync<BridgeActionReceipt>(this.PathFor("receipts", "receipt", sequence), cancellationToken);
    }

    private async Task WriteOnceAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        var canonical = Serialize(value);
        var directory = Path.GetDirectoryName(path) ?? throw new InvalidOperationException("Bridge path has no directory.");
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                4096,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(canonical.AsMemory(), cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            try
            {
                File.Move(temporaryPath, path);
                return;
            }
            catch (IOException) when (File.Exists(path))
            {
                var existing = await this.ReadBoundedAsync(path, cancellationToken).ConfigureAwait(false);
                var parsed = JsonSerializer.Deserialize<T>(existing, JsonOptions)
                    ?? throw new InvalidDataException("Existing bridge file contains JSON null.");
                if (!Serialize(parsed).AsSpan().SequenceEqual(canonical))
                {
                    throw new InvalidOperationException("Refusing to overwrite a conflicting decision bridge file.");
                }
            }
        }
        finally
        {
            TryDeleteTemporaryFile(temporaryPath);
        }
    }

    private async Task<T?> TryReadAsync<T>(string path, CancellationToken cancellationToken)
        where T : class
    {
        if (!File.Exists(path))
        {
            return null;
        }
        try
        {
            var bytes = await this.ReadBoundedAsync(path, cancellationToken).ConfigureAwait(false);
            return JsonSerializer.Deserialize<T>(bytes, JsonOptions)
                ?? throw new InvalidDataException("Decision bridge file contains JSON null.");
        }
        catch (FileNotFoundException)
        {
            return null;
        }
    }

    private async Task<byte[]> ReadBoundedAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite,
            4096,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (stream.Length > MaxFileBytes)
        {
            throw new InvalidDataException($"Decision bridge file exceeds the {MaxFileBytes} byte limit.");
        }
        var buffer = new byte[MaxFileBytes + 1];
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), cancellationToken)
                .ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }
            offset += read;
        }
        if (offset > MaxFileBytes)
        {
            throw new InvalidDataException($"Decision bridge file exceeds the {MaxFileBytes} byte limit.");
        }
        return buffer[..offset];
    }

    private string PathFor(string directory, string prefix, int sequence)
    {
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "Decision sequence must be positive.");
        }
        return Path.Combine(this.root, directory, $"{prefix}-{sequence}.json");
    }

    private static byte[] Serialize<T>(T value)
    {
        var bytes = Encoding.UTF8.GetBytes($"{JsonSerializer.Serialize(value, JsonOptions)}{Environment.NewLine}");
        if (bytes.Length > MaxFileBytes)
        {
            throw new InvalidDataException($"Decision bridge value exceeds the {MaxFileBytes} byte limit.");
        }
        return bytes;
    }

    private static void TryDeleteTemporaryFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // The final immutable file is authoritative; an unlinked temporary file is never consumed.
        }
        catch (UnauthorizedAccessException)
        {
            // Preserve the publish result when best-effort temporary cleanup is denied.
        }
    }
}
