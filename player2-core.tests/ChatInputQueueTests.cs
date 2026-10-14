using System;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class ChatInputQueueTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 13, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void KeepsBackToBackLinesInOrder()
    {
        var queue = new ChatInputQueue();
        var first = queue.TryEnqueue("先去钓鱼", Now);
        var second = queue.TryEnqueue("然后回家", Now.AddSeconds(1));

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.NotEqual(first!.Id, second!.Id);
        Assert.Equal("先去钓鱼", queue.TryDequeue()?.Message);
        Assert.Equal("然后回家", queue.TryDequeue()?.Message);
        Assert.Null(queue.TryDequeue());
    }

    [Fact]
    public void RefusesPastCapacityInsteadOfDropping()
    {
        var queue = new ChatInputQueue(capacity: 2);
        Assert.NotNull(queue.TryEnqueue("a", Now));
        Assert.NotNull(queue.TryEnqueue("b", Now));

        Assert.Null(queue.TryEnqueue("c", Now));
        Assert.Equal(2, queue.Count);
        Assert.Equal("a", queue.TryDequeue()?.Message);
        Assert.NotNull(queue.TryEnqueue("c", Now));
    }

    [Fact]
    public void ClearsAndRejectsEmptyLines()
    {
        var queue = new ChatInputQueue();
        queue.TryEnqueue("a", Now);
        queue.Clear();

        Assert.Equal(0, queue.Count);
        Assert.Throws<ArgumentException>(() => queue.TryEnqueue("  ", Now));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ChatInputQueue(0));
    }
}
