using System.Linq;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class CompanionMovementTests
{
    [Theory]
    [InlineData("立刻来我面前", "come")]
    [InlineData("跟着我！", "follow")]
    [InlineData("不要跟着我", "stay")]
    [InlineData(" /come ", "come")]
    [InlineData("不要来我面前", null)]
    [InlineData("你为什么不能跟着我？", null)]
    [InlineData("她说‘跟着我’", null)]
    [InlineData("过来，然后替我收菜", null)]
    public void OnlyExplicitBoundedCommandsGrantMovement(string message, string? expected)
        => Assert.Equal(expected, CompanionMovement.ParseCommand(message));

    [Fact]
    public void ChineseWrapKeepsSpeakerWithMessageAndPreservesText()
    {
        const string text = "Mira: 嗯我在这里今天我们可以一起去农场看看";
        var lines = ChatTextLayout.Wrap(text, 13, value => value.Length).ToArray();
        Assert.Contains("嗯", lines[0]);
        Assert.Equal(text, string.Concat(lines));
        Assert.All(lines, line => Assert.True(line.Length <= 13));
    }

    [Fact]
    public void TranscriptRevisionAdvancesAfterRetentionLimit()
    {
        var transcript = new ChatTranscript();
        for (var i = 0; i < 50; i++) transcript.Append("Mira", i.ToString());
        var revision = transcript.Revision;
        transcript.Append("Mira", "new reply");
        Assert.Equal(50, transcript.Lines.Count);
        Assert.True(transcript.Revision > revision);
        Assert.Equal("new reply", transcript.Lines.Last().Text);
    }
}
