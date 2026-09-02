using System;
using System.Threading;
using System.Threading.Tasks;
using DSHPlayer2.Core;

namespace DSHPlayer2.Core;

/// <summary>Owns asynchronous bridge I/O without reading or mutating any SMAPI/game object.</summary>
public sealed class DecisionBridgeHost : IDisposable
{
    private readonly DecisionBridgeFiles files;
    private readonly int pollIntervalTicks;
    private readonly TimeSpan requestTimeout;
    private readonly CancellationTokenSource cancellation = new();
    private DecisionTurnEnvelope? turn;
    private Task<BridgeActionReceipt?>? recoveryTask;
    private Task? publishTask;
    private Task<BridgeActionRequest?>? pollTask;
    private Task<BridgeRuntimeError?>? errorPollTask;
    private Task? settlementTask;
    private int pollCountdown;
    private DateTimeOffset? deadline;
    private bool published;
    private bool closed;
    private bool settlementFailureReported;

    /// <summary>
    /// The request timeout is a wall-clock deadline, not a tick count: game
    /// pauses, loading stutters, and menu time otherwise inflate or shrink the
    /// real wait. Pass <see cref="System.Threading.Timeout.InfiniteTimeSpan"/>
    /// to disable the deadline entirely (headless harnesses only).
    /// </summary>
    public DecisionBridgeHost(string bridgeDirectory, int pollIntervalTicks, TimeSpan requestTimeout)
    {
        this.files = new DecisionBridgeFiles(bridgeDirectory);
        if (requestTimeout <= TimeSpan.Zero && requestTimeout != System.Threading.Timeout.InfiniteTimeSpan)
        {
            throw new ArgumentOutOfRangeException(nameof(requestTimeout));
        }
        this.pollIntervalTicks = Math.Clamp(pollIntervalTicks, 1, 600);
        this.requestTimeout = requestTimeout;
    }

    public void Start(DecisionTurnEnvelope decisionTurn)
    {
        if (this.turn is not null)
        {
            throw new InvalidOperationException("Decision bridge host already owns a game day.");
        }
        this.turn = decisionTurn;
        this.recoveryTask = this.files.TryReadReceiptAsync(decisionTurn.Sequence, this.cancellation.Token);
    }

    /// <summary>Advances task ownership from the game thread without waiting on incomplete work.</summary>
    public DecisionBridgeHostUpdate Update()
    {
        if (this.settlementTask is not null && this.settlementTask.IsCompleted)
        {
            if (this.settlementTask.IsFaulted && !this.settlementFailureReported)
            {
                this.settlementFailureReported = true;
                return DecisionBridgeHostUpdate.Failed(this.FailureOf(this.settlementTask));
            }
            this.settlementTask = null;
        }
        if (this.closed)
        {
            return DecisionBridgeHostUpdate.None;
        }
        var activeTurn = this.turn ?? throw new InvalidOperationException("Decision bridge host has not started.");

        if (this.recoveryTask is not null)
        {
            if (!this.recoveryTask.IsCompleted)
            {
                return DecisionBridgeHostUpdate.None;
            }
            if (this.recoveryTask.IsFaulted)
            {
                return this.CloseWith(this.FailureOf(this.recoveryTask));
            }
            var receipt = this.recoveryTask.GetAwaiter().GetResult();
            this.recoveryTask = null;
            if (receipt is not null)
            {
                try
                {
                    receipt = DecisionBridgeRules.ValidateReceipt(activeTurn, receipt);
                    this.closed = true;
                    return DecisionBridgeHostUpdate.Recovered(receipt);
                }
                catch (Exception error)
                {
                    return this.CloseWith(error);
                }
            }
            this.publishTask = this.PublishTurnForRetryAsync(activeTurn);
        }

        if (this.publishTask is not null)
        {
            if (!this.publishTask.IsCompleted)
            {
                return DecisionBridgeHostUpdate.None;
            }
            if (this.publishTask.IsFaulted)
            {
                return this.CloseWith(this.FailureOf(this.publishTask));
            }
            this.publishTask.GetAwaiter().GetResult();
            this.publishTask = null;
            this.published = true;
            this.pollCountdown = 0;
            // The deadline starts once the turn is actually on the bridge.
            // InfiniteTimeSpan is a sentinel, not a duration to add to now:
            // adding it would produce a deadline one millisecond in the past.
            if (this.requestTimeout != System.Threading.Timeout.InfiniteTimeSpan)
            {
                this.deadline ??= DateTimeOffset.UtcNow + this.requestTimeout;
            }
        }

        if (!this.published)
        {
            return DecisionBridgeHostUpdate.None;
        }
        if (this.deadline is { } deadline && DateTimeOffset.UtcNow > deadline)
        {
            return this.CloseWith(new TimeoutException("DSH did not produce a decision request before the DSH bridge deadline."));
        }

        if (this.errorPollTask is not null)
        {
            if (!this.errorPollTask.IsCompleted)
            {
                return DecisionBridgeHostUpdate.None;
            }
            if (this.errorPollTask.IsFaulted)
            {
                return this.CloseWith(this.FailureOf(this.errorPollTask));
            }
            var runtimeError = this.errorPollTask.GetAwaiter().GetResult();
            this.errorPollTask = null;
            if (runtimeError is not null)
            {
                return this.CloseWith(new InvalidOperationException($"{runtimeError.Code} trace={runtimeError.TraceId}: {runtimeError.Message}"));
            }
        }

        if (this.pollTask is not null)
        {
            if (!this.pollTask.IsCompleted)
            {
                return DecisionBridgeHostUpdate.None;
            }
            if (this.pollTask.IsFaulted)
            {
                return this.CloseWith(this.FailureOf(this.pollTask));
            }
            var request = this.pollTask.GetAwaiter().GetResult();
            this.pollTask = null;
            if (request is not null)
            {
                this.closed = true;
                return DecisionBridgeHostUpdate.Requested(request);
            }
            this.pollCountdown = this.pollIntervalTicks;
        }

        if (this.pollCountdown > 0)
        {
            this.pollCountdown--;
        }
        else if (this.pollTask is null && this.errorPollTask is null)
        {
            this.pollTask = this.files.TryReadRequestAsync(activeTurn, this.cancellation.Token);
            this.errorPollTask = this.files.TryReadErrorAsync(activeTurn, this.cancellation.Token);
        }
        return DecisionBridgeHostUpdate.None;
    }

    public void RecordSettlement(BridgePermissionGrant grant, BridgeActionReceipt receipt)
    {
        var activeTurn = this.turn ?? throw new InvalidOperationException("Decision bridge host has not started.");
        if (this.settlementTask is not null)
        {
            throw new InvalidOperationException("Decision bridge settlement is already being persisted.");
        }
        this.closed = true;
        this.settlementTask = this.PersistSettlementAsync(activeTurn.Sequence, grant, receipt);
    }

    /// <summary>
    /// Persists one autonomous execution. No grant file exists because no
    /// player answer was produced; the receipt (with its autonomy marker) is
    /// the only fact the next day's memory is projected from.
    /// </summary>
    public void RecordAutonomousSettlement(BridgeActionReceipt receipt)
    {
        var activeTurn = this.turn ?? throw new InvalidOperationException("Decision bridge host has not started.");
        if (this.settlementTask is not null)
        {
            throw new InvalidOperationException("Decision bridge settlement is already being persisted.");
        }
        this.closed = true;
        this.settlementTask = this.files.WriteReceiptAsync(activeTurn.Sequence, receipt, this.cancellation.Token);
    }

    public void Dispose()
    {
        this.closed = true;
        this.cancellation.Cancel();
        this.cancellation.Dispose();
    }

    private async Task PersistSettlementAsync(int sequence, BridgePermissionGrant grant, BridgeActionReceipt receipt)
    {
        await this.files.WriteGrantAsync(sequence, grant, this.cancellation.Token).ConfigureAwait(false);
        await this.files.WriteReceiptAsync(sequence, receipt, this.cancellation.Token).ConfigureAwait(false);
    }

    private async Task PublishTurnForRetryAsync(DecisionTurnEnvelope activeTurn)
    {
        await this.files.ClearRuntimeErrorAsync(activeTurn.Sequence, this.cancellation.Token).ConfigureAwait(false);
        try
        {
            await this.files.PublishTurnAsync(activeTurn, this.cancellation.Token).ConfigureAwait(false);
        }
        catch (InvalidOperationException error) when (error.Message == "Refusing to overwrite a conflicting decision bridge file.")
        {
            await this.files.ResetUnsettledTurnAsync(activeTurn.Sequence, this.cancellation.Token).ConfigureAwait(false);
            await this.files.PublishTurnAsync(activeTurn, this.cancellation.Token).ConfigureAwait(false);
        }
    }

    private DecisionBridgeHostUpdate CloseWith(Exception error)
    {
        this.closed = true;
        return DecisionBridgeHostUpdate.Failed(error);
    }

    private Exception FailureOf(Task task)
    {
        return task.Exception?.GetBaseException() ?? new InvalidOperationException("Decision bridge task failed without an exception.");
    }
}

public sealed record DecisionBridgeHostUpdate(
    BridgeActionRequest? Request,
    BridgeActionReceipt? RecoveredReceipt,
    Exception? Error)
{
    public static readonly DecisionBridgeHostUpdate None = new(null, null, null);

    public static DecisionBridgeHostUpdate Requested(BridgeActionRequest request) => new(request, null, null);

    public static DecisionBridgeHostUpdate Recovered(BridgeActionReceipt receipt) => new(null, receipt, null);

    public static DecisionBridgeHostUpdate Failed(Exception error) => new(null, null, error);
}
