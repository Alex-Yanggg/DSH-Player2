using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>
/// The Player side of the P2-0014 dream lane: writing the explicit day-end
/// request and consuming the one outcome a dream turn may write. The dream
/// outcome is a growth proposal validated and applied through the existing
/// <see cref="CompanionGrowthStore"/> — this bridge deliberately has no other
/// write path, so a dream can never touch the soul, capabilities, or autonomy.
/// </summary>
public sealed class CompanionDreamBridge
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string root;

    public CompanionDreamBridge(string sessionDirectory)
    {
        if (string.IsNullOrWhiteSpace(sessionDirectory))
        {
            throw new ArgumentException("A dream bridge requires a non-empty session directory.", nameof(sessionDirectory));
        }
        this.root = Path.GetFullPath(sessionDirectory);
    }

    /// <summary>The Player-owned path inside the session directory.</summary>
    public string RequestPath(int sequence)
    {
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "Decision sequence must be positive.");
        }
        return Path.Combine(this.root, "dream-inbox", $"dream-{sequence}.json");
    }

    /// <summary>
    /// Publishes the explicit day-end request (write-once). Re-publishing the
    /// same day-end is a byte-equal no-op; a conflicting file is refused.
    /// </summary>
    public Task WriteRequestAsync(BridgeDreamRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Version != DecisionBridgeRules.WireVersion)
        {
            throw new ArgumentException($"The dream request must carry wire version {DecisionBridgeRules.WireVersion}.");
        }
        return this.WriteOnceAsync(this.RequestPath(request.Sequence), request, cancellationToken);
    }

    /// <summary>
    /// Reads the dream outcome for one sequence, or null when the dream has not
    /// closed yet. A DSH error file fails loudly instead of degrading.
    /// </summary>
    public async Task<BridgeDreamOutcome?> TryReadOutcomeAsync(int sequence, CancellationToken cancellationToken = default)
    {
        var growth = await this.TryReadAsync<BridgeGrowthProposal>(this.OutcomePath("dream-growth", sequence), cancellationToken).ConfigureAwait(false);
        if (growth is not null)
        {
            CompanionGrowthStore.ValidateProposalContract(growth);
            return new BridgeDreamOutcome("growth", growth);
        }
        var noChange = await this.TryReadAsync<BridgeDreamNoChange>(this.OutcomePath("dream-nochange", sequence), cancellationToken).ConfigureAwait(false);
        if (noChange is not null)
        {
            if (noChange.Version != DecisionBridgeRules.WireVersion || noChange.Sequence != sequence || noChange.Outcome != "no-change")
            {
                throw new InvalidDataException("The dream no-change marker does not belong to this sequence.");
            }
            return new BridgeDreamOutcome("no-change", null);
        }
        var error = await this.TryReadAsync<BridgeRuntimeError>(this.OutcomePath("error-dream", sequence), cancellationToken).ConfigureAwait(false);
        if (error is not null)
        {
            throw new InvalidOperationException($"{error.Code} trace={error.TraceId}: {error.Message}");
        }
        return null;
    }

    /// <summary>
    /// Applies a growth outcome to the Player-owned asset and deletes the
    /// consumed file. Applying the same sequence twice is an idempotent no-op
    /// of the store; a no-change outcome only clears its marker.
    /// </summary>
    public async Task<BridgeGrowthAsset?> ConsumeAsync(
        BridgeDreamOutcome outcome,
        CompanionGrowthStore growthStore,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        ArgumentNullException.ThrowIfNull(growthStore);
        if (outcome.Proposal is null)
        {
            return null;
        }
        var applied = await growthStore.ApplyProposalAsync(outcome.Proposal, cancellationToken).ConfigureAwait(false);
        File.Delete(this.OutcomePath("dream-growth", outcome.Proposal.Sequence));
        return applied;
    }

    private string OutcomePath(string prefix, int sequence)
    {
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "Decision sequence must be positive.");
        }
        return Path.Combine(this.root, "outbox", $"{prefix}-{sequence}.json");
    }

    private async Task WriteOnceAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        var canonical = JsonSerializer.Serialize(value, JsonOptions);
        var directory = Path.GetDirectoryName(path) ?? throw new InvalidOperationException("Dream path has no directory.");
        Directory.CreateDirectory(directory);
        if (File.Exists(path))
        {
            var existing = await File.ReadAllTextAsync(path, cancellationToken).ConfigureAwait(false);
            if (existing.TrimEnd().Equals(canonical, StringComparison.Ordinal))
            {
                return;
            }
            throw new InvalidOperationException("Refusing to overwrite a conflicting dream bridge file.");
        }
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
                var bytes = System.Text.Encoding.UTF8.GetBytes($"{canonical}\n");
                await stream.WriteAsync(bytes.AsMemory(), cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            File.Move(temporaryPath, path, overwrite: false);
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
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
        if (bytes.Length > DecisionBridgeFiles.MaxFileBytes)
        {
            throw new InvalidDataException($"The dream file exceeds the {DecisionBridgeFiles.MaxFileBytes} byte limit.");
        }
        return JsonSerializer.Deserialize<T>(bytes, JsonOptions)
            ?? throw new InvalidDataException("The dream file contains JSON null.");
    }

    private static void TryDeleteTemporaryFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // The final file is authoritative; an unlinked temporary file is never consumed.
        }
    }
}
