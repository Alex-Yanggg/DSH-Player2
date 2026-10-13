using System;
using System.Collections.Generic;

namespace DSHPlayer2.Core;

/// <summary>One chat line the player sent while an earlier reply was still on its way.</summary>
public sealed record QueuedChatInput(string Id, string Message, DateTimeOffset SubmittedAt);

/// <summary>
/// Ordered, bounded chat input (P2-0016): two lines sent back to back are both
/// answered, in order, instead of the second being refused while the first
/// reply is pending. The queue is game-free; the Mod drains it one turn at a
/// time, so the DSH social lane still sees exactly one turn in flight.
/// </summary>
public sealed class ChatInputQueue
{
    /// <summary>Lines held at most; past this the player is told to wait.</summary>
    public const int DefaultCapacity = 3;

    private readonly Queue<QueuedChatInput> items = new();
    private readonly int capacity;

    public ChatInputQueue(int capacity = DefaultCapacity)
    {
        if (capacity < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity), "A chat queue holds at least one line.");
        }
        this.capacity = capacity;
    }

    /// <summary>Number of lines waiting.</summary>
    public int Count => this.items.Count;

    /// <summary>
    /// Holds one non-empty line; returns null when the queue is full, so the
    /// caller keeps the draft instead of silently dropping it.
    /// </summary>
    public QueuedChatInput? TryEnqueue(string message, DateTimeOffset submittedAt)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            throw new ArgumentException("A queued chat line must not be empty.", nameof(message));
        }
        if (this.items.Count >= this.capacity)
        {
            return null;
        }
        var queued = new QueuedChatInput(Guid.NewGuid().ToString(), message, submittedAt);
        this.items.Enqueue(queued);
        return queued;
    }

    /// <summary>The oldest waiting line, or null when none waits.</summary>
    public QueuedChatInput? TryDequeue()
    {
        return this.items.Count == 0 ? null : this.items.Dequeue();
    }

    /// <summary>Drops every waiting line (title screen, startup failure).</summary>
    public void Clear()
    {
        this.items.Clear();
    }
}
