using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>
/// The Player-owned growth asset for one companion session: the companion's
/// self-authored interpretation of its receipt-backed shared history, applied
/// only from validated DSH reflect proposals. Game-free and fully testable.
///
/// Trust boundary: the DSH side can only write an immutable
/// <c>outbox/growth-&lt;sequence&gt;.json</c> proposal; this store validates it,
/// applies it to the bounded versioned asset at <c>growth/growth.json</c>, and
/// never exposes a write path to the soul. The asset is L2 state owned by the
/// player, so it is atomically replaceable — unlike the write-once bridge
/// audit files — and its revision is the sequence of the last applied proposal.
/// </summary>
public sealed class CompanionGrowthStore
{
    public const int MaxInsights = 12;
    public const int MaxInsightLength = 240;
    public const int MaxCitedReceipts = 8;
    public const int MaxFocusLength = 160;

    private const int MaxProposalInsights = 3;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string sessionDirectory;

    public CompanionGrowthStore(string sessionDirectory)
    {
        if (string.IsNullOrWhiteSpace(sessionDirectory))
        {
            throw new ArgumentException("A growth store requires a non-empty session directory.", nameof(sessionDirectory));
        }
        this.sessionDirectory = Path.GetFullPath(sessionDirectory);
    }

    /// <summary>The Player-owned asset path inside the session directory.</summary>
    public string AssetPath => Path.Combine(this.sessionDirectory, "growth", "growth.json");

    /// <summary>
    /// Loads the current growth asset, or null when the companion has none yet.
    /// A damaged file is a traceable error, never silently reset: the asset is
    /// the fact source this companion's growth stands on.
    /// </summary>
    public async Task<BridgeGrowthAsset?> TryLoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(this.AssetPath))
        {
            return null;
        }
        try
        {
            var bytes = await this.ReadBoundedAsync(this.AssetPath, cancellationToken).ConfigureAwait(false);
            var asset = JsonSerializer.Deserialize<BridgeGrowthAsset>(bytes, JsonOptions)
                ?? throw new InvalidDataException("The growth asset contains JSON null.");
            ValidateAsset(asset);
            return asset;
        }
        catch (Exception error) when (error is InvalidDataException or JsonException)
        {
            throw new InvalidDataException(
                $"The growth asset at {this.AssetPath} is damaged: {error.Message}. " +
                "Repair or delete it by hand; the companion's growth is never silently reset.");
        }
    }

    /// <summary>
    /// Reads one DSH-authored reflect proposal, or null when this turn carried
    /// none. The file itself stays untouched: validation and consumption are
    /// separate steps so a failed apply leaves the evidence in place.
    /// </summary>
    public async Task<BridgeGrowthProposal?> TryReadProposalAsync(int sequence, CancellationToken cancellationToken = default)
    {
        var path = this.ProposalPath(sequence);
        if (!File.Exists(path))
        {
            return null;
        }
        var bytes = await this.ReadBoundedAsync(path, cancellationToken).ConfigureAwait(false);
        return JsonSerializer.Deserialize<BridgeGrowthProposal>(bytes, JsonOptions)
            ?? throw new InvalidDataException("The growth proposal contains JSON null.");
    }

    /// <summary>
    /// Validates one reflect proposal against the Player contract and applies
    /// it to the growth asset. Applying the same sequence twice is an idempotent
    /// no-op; a proposal older than the applied revision is stale and rejected.
    /// </summary>
    public async Task<BridgeGrowthAsset> ApplyProposalAsync(BridgeGrowthProposal proposal, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(proposal);
        ValidateProposal(proposal);
        var current = await this.TryLoadAsync(cancellationToken).ConfigureAwait(false) ?? EmptyAsset();
        if (proposal.Sequence < current.Revision)
        {
            throw new InvalidOperationException(
                $"Growth proposal sequence {proposal.Sequence} is older than the applied revision {current.Revision}.");
        }
        if (proposal.Sequence == current.Revision)
        {
            return current;
        }
        var appliedAt = DecisionBridgeRules.UtcTimestamp(DateTimeOffset.UtcNow);
        var insights = current.Insights
            .Concat(proposal.Insights.Select((insight, index) => new BridgeGrowthInsight(
                $"growth-{proposal.Sequence}-{index + 1}",
                insight.Text,
                insight.BasedOnReceiptSequences,
                appliedAt)))
            .ToArray();
        if (insights.Length > MaxInsights)
        {
            insights = insights[^MaxInsights..];
        }
        var asset = new BridgeGrowthAsset(DecisionBridgeRules.WireVersion, proposal.Sequence, insights, proposal.Focus);
        await this.WriteAssetAsync(asset, cancellationToken).ConfigureAwait(false);
        return asset;
    }

    /// <summary>Deletes the consumed proposal file after a successful apply.</summary>
    public Task ClearProposalAsync(int sequence)
    {
        File.Delete(this.ProposalPath(sequence));
        return Task.CompletedTask;
    }

    /// <summary>
    /// Mirrors the TypeScript growth schema at the Player writer boundary so
    /// both bridge sides reject the same malformed assets before DSH sees one.
    /// There is no soul row to validate: the type has none.
    /// </summary>
    public static void ValidateAsset(BridgeGrowthAsset asset)    {
        ArgumentNullException.ThrowIfNull(asset);
        if (asset.Version != DecisionBridgeRules.WireVersion)
        {
            throw new ArgumentException($"The growth asset must carry wire version {DecisionBridgeRules.WireVersion}.");
        }
        if (asset.Revision < 0)
        {
            throw new ArgumentException("The growth asset revision must not be negative.");
        }
        ValidateInsights(asset.Insights, MaxInsights);
        ValidateFocus(asset.Focus);
    }

    /// <summary>Player-boundary validation for one DSH-authored proposal, shared by the decision and dream lanes.</summary>
    public static void ValidateProposalContract(BridgeGrowthProposal proposal)
    {
        ValidateProposal(proposal);
    }

    private static void ValidateProposal(BridgeGrowthProposal proposal)
    {
        if (proposal.Version != DecisionBridgeRules.WireVersion)
        {
            throw new ArgumentException($"The growth proposal must carry wire version {DecisionBridgeRules.WireVersion}.");
        }
        if (proposal.Sequence < 1)
        {
            throw new ArgumentException("A growth proposal sequence must be positive.");
        }
        if (proposal.Insights.Length is < 1 or > MaxProposalInsights)
        {
            throw new ArgumentException($"A growth proposal carries between 1 and {MaxProposalInsights} insights.");
        }
        ValidateInsights(proposal.Insights.Select(insight => new BridgeGrowthInsight(
            "proposal", insight.Text, insight.BasedOnReceiptSequences, string.Empty)).ToArray(), MaxProposalInsights);
        ValidateFocus(proposal.Focus);
    }

    private static void ValidateInsights(BridgeGrowthInsight[] insights, int maxCount)
    {
        if (insights.Length > maxCount)
        {
            throw new ArgumentException($"The growth asset may carry at most {maxCount} insights.");
        }
        foreach (var insight in insights)
        {
            if (string.IsNullOrWhiteSpace(insight.Text) || insight.Text.Length > MaxInsightLength)
            {
                throw new ArgumentException($"A growth insight must be 1..{MaxInsightLength} characters.");
            }
            if (insight.BasedOnReceiptSequences.Length is < 1 or > MaxCitedReceipts ||
                insight.BasedOnReceiptSequences.Distinct().Count() != insight.BasedOnReceiptSequences.Length ||
                insight.BasedOnReceiptSequences.Any(sequence => sequence < 1))
            {
                throw new ArgumentException(
                    $"A growth insight cites 1..{MaxCitedReceipts} distinct positive receipt sequences.");
            }
        }
    }

    private static void ValidateFocus(string? focus)
    {
        if (focus is not null && (focus.Trim().Length == 0 || focus.Length > MaxFocusLength))
        {
            throw new ArgumentException($"The growth focus must be null or 1..{MaxFocusLength} characters.");
        }
    }

    private static BridgeGrowthAsset EmptyAsset()
    {
        return new BridgeGrowthAsset(DecisionBridgeRules.WireVersion, 0, Array.Empty<BridgeGrowthInsight>(), null);
    }

    private string ProposalPath(int sequence)
    {
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "Decision sequence must be positive.");
        }
        return Path.Combine(this.sessionDirectory, "outbox", $"growth-{sequence}.json");
    }

    private async Task WriteAssetAsync(BridgeGrowthAsset asset, CancellationToken cancellationToken)
    {
        var canonical = JsonSerializer.Serialize(asset, JsonOptions);
        var directory = Path.GetDirectoryName(this.AssetPath) ?? throw new InvalidOperationException("Growth path has no directory.");
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(this.AssetPath)}.{Guid.NewGuid():N}.tmp");
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
                var bytes = Encoding.UTF8.GetBytes($"{canonical}\n");
                await stream.WriteAsync(bytes.AsMemory(), cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            File.Move(temporaryPath, this.AssetPath, overwrite: true);
        }
        finally
        {
            TryDeleteTemporaryFile(temporaryPath);
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
        if (stream.Length > DecisionBridgeFiles.MaxFileBytes)
        {
            throw new InvalidDataException($"The growth file exceeds the {DecisionBridgeFiles.MaxFileBytes} byte limit.");
        }
        var buffer = new byte[DecisionBridgeFiles.MaxFileBytes + 1];
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
        if (offset > DecisionBridgeFiles.MaxFileBytes)
        {
            throw new InvalidDataException($"The growth file exceeds the {DecisionBridgeFiles.MaxFileBytes} byte limit.");
        }
        return buffer[..offset];
    }

    private static void TryDeleteTemporaryFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
            // The final asset file is authoritative; an unlinked temporary file is never consumed.
        }
        catch (UnauthorizedAccessException)
        {
            // Preserve the apply result when best-effort temporary cleanup is denied.
        }
    }
}
