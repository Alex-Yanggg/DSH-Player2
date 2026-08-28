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
    private readonly int requestTimeoutTicks;
    private readonly CancellationTokenSource cancellation = new();
    private DecisionTurnEnvelope? turn;
    private Task<BridgeActionReceipt?>? recoveryTask;
    private Task? publishTask;
    private Task<BridgeActionRequest?>? pollTask;
    private Task? settlementTask;
    private int pollCountdown;
    private int waitedTicks;
    private bool published;
    private bool closed;
    private bool settlementFailureReported;

    public DecisionBridgeHost(string bridgeDirectory, int pollIntervalTicks, int requestTimeoutTicks)
    {
        this.files = new DecisionBridgeFiles(bridgeDirectory);
        this.pollIntervalTicks = Math.Clamp(pollIntervalTicks, 1, 600);
        this.requestTimeoutTicks = Math.Max(requestTimeoutTicks, this.pollIntervalTicks);
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
                receipt = DecisionBridgeRules.ValidateReceipt(activeTurn.Sequence, receipt);
                this.closed = true;
                return DecisionBridgeHostUpdate.Recovered(receipt);
            }
            this.publishTask = this.files.PublishTurnAsync(activeTurn, this.cancellation.Token);
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
        }

        if (!this.published)
        {
            return DecisionBridgeHostUpdate.None;
        }
        this.waitedTicks++;
        if (this.waitedTicks > this.requestTimeoutTicks)
        {
            return this.CloseWith(new TimeoutException("DSH did not produce a decision request before the local fallback deadline."));
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
        else if (this.pollTask is null)
        {
            this.pollTask = this.files.TryReadRequestAsync(activeTurn, this.cancellation.Token);
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
