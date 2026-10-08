using System;
using System.Text.RegularExpressions;

namespace DSHPlayer2.Core;

/// <summary>Explicit player commands only; quoted, negative and speculative prose grants nothing.</summary>
public static class CompanionMovement
{
    public static string? ParseCommand(string text)
    {
        var command = Regex.Replace(text.Trim().ToLowerInvariant(), @"[\s，,。.!！]+", "");
        return command switch
        {
            "/come" or "comehere" or "cometome" or "过来" or "来我这里" or "到我这里来"
                or "来我面前" or "立刻来我面前" or "马上来我面前" or "站到我面前" or "到我面前来"
                or "请过来" or "你过来" or "过来一下" => "come",
            "/follow" or "followme" or "跟着我" or "跟我来" or "跟上我" or "请跟着我" => "follow",
            "/stay" or "stayhere" or "stop" or "停下" or "停下来" or "别跟着我" or "不要跟着我"
                or "待在这里" or "在这等我" or "原地等我" => "stay",
            _ => null,
        };
    }
}
