using System;
using System.IO;
using System.Text;
using System.Text.Json;
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

    public async Task<BridgeActionRequest?> TryReadRequestAsync(
        DecisionTurnEnvelope turn,
        CancellationToken cancellationToken = default)
    {
        var request = await this.TryReadAsync<BridgeActionRequest>(
            this.PathFor("outbox", "request", turn.Sequence),
            cancellationToken).ConfigureAwait(false);
        return request is null ? null : DecisionBridgeRules.ValidateRequest(turn, request).Request;
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
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidOperationException("Bridge path has no directory."));
        try
        {
            await using var stream = new FileStream(
                path,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.Read,
                4096,
                FileOptions.Asynchronous | FileOptions.WriteThrough);
            await stream.WriteAsync(canonical.AsMemory(), cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
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
}
