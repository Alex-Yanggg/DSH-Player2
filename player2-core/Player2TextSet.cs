namespace DSHPlayer2.Core;

/// <summary>Localized presentation templates for validated native DSH proposals only.</summary>
public sealed record Player2TextSet(
    string ProposalDayLine,
    string ProposalReasonLine,
    string ProposalScopeLine,
    string ProposalBoundaryLine,
    string ProposalAskLine)
{
    public static readonly Player2TextSet English = new(
        "Day {day}: {weather} at {location}.",
        "{name}'s grounded reason: {reason}.",
        "Scope: mark tile {tileX}, {tileY} with a temporary visual receipt only.",
        "No crops, inventory, map, or multiplayer state will change.",
        "May I do that?");

    public static readonly Player2TextSet SimplifiedChinese = new(
        "第{day}天：{weather}，地点在{location}。",
        "{name}基于当前信息的理由：{reason}。",
        "范围：只在地块（{tileX}，{tileY}）留下一个临时的可见标记。",
        "不会改动庄稼、物品栏、地图或联机状态。",
        "可以吗？");
}
