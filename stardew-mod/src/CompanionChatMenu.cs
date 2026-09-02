using System;
using System.Collections.Generic;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using DSHPlayer2.Core;
using StardewValley;
using StardewValley.Menus;

namespace DSHPlayer2.Stardew;

/// <summary>
/// A bounded chat window in the multiplayer ChatBox tradition: the last lines
/// stay visible above the input, the wheel and PageUp/PageDown scroll back,
/// and submitting keeps the menu open. The window never causes game actions.
/// </summary>
internal sealed class CompanionChatMenu : IClickableMenu
{
    private const int ScrollStep = 3;
    private const int PreferredWidth = 680;
    private const int PreferredHeight = 288;
    private const int ScreenMargin = 20;
    private const int InnerPadding = 20;
    private const int HeaderHeight = 44;
    private const int InputAreaHeight = 68;
    private const int BorderWidth = 2;
    private const int InputInset = 10;

    private readonly ChatTranscript transcript;
    private readonly string playerSpeaker;
    private readonly Func<string, bool> submit;
    private readonly Func<bool> isWaiting;
    private readonly Func<string, string> translate;
    private readonly string title;
    private readonly TextBox textBox;
    private List<string> wrappedLines = new();
    private int wrappedForCount = -1;
    private int scrollOffset;

    /// <summary>Creates the chat window around the shared, player-owned transcript.</summary>
    public CompanionChatMenu(
        ChatTranscript transcript,
        string playerSpeaker,
        Func<string, bool> submit,
        Func<bool> isWaiting,
        string title,
        Func<string, string> translate)
        : base(0, 0, PreferredWidth, PreferredHeight, false)
    {
        this.transcript = transcript;
        this.playerSpeaker = playerSpeaker;
        this.submit = submit;
        this.isWaiting = isWaiting;
        this.title = title;
        this.translate = translate;
        this.textBox = new TextBox(null, null, Game1.dialogueFont, Game1.textColor)
        {
            Text = string.Empty,
            Selected = true,
            limitWidth = true,
        };
        this.Reposition();
        Game1.keyboardDispatcher.Subscriber = this.textBox;
    }

    /// <inheritdoc />
    public override void receiveKeyPress(Keys key)
    {
        if (key == Keys.Enter)
        {
            this.Submit();
            return;
        }

        if (key == Keys.Escape)
        {
            this.exitThisMenu();
            return;
        }

        if (key == Keys.PageUp)
        {
            this.scrollOffset += ScrollStep * 2;
            this.ClampScroll();
            return;
        }

        if (key == Keys.PageDown)
        {
            this.scrollOffset -= ScrollStep * 2;
            this.ClampScroll();
            return;
        }

        if (key == Keys.Up && this.textBox.Text.Length == 0)
        {
            this.textBox.Text = this.transcript.LastPlayerLine(this.playerSpeaker)?.Text ?? string.Empty;
        }
    }

    /// <inheritdoc />
    public override void receiveScrollWheelAction(int direction)
    {
        base.receiveScrollWheelAction(direction);
        this.scrollOffset += Math.Sign(direction) * ScrollStep;
        this.ClampScroll();
    }

    /// <inheritdoc />
    public override void receiveLeftClick(int x, int y, bool playSound = true)
    {
        base.receiveLeftClick(x, y, playSound);
        if (Game1.activeClickableMenu is null)
        {
            return;
        }

        var input = this.InputBounds();
        this.textBox.Selected = input.Contains(x, y);
        if (this.textBox.Selected)
        {
            Game1.keyboardDispatcher.Subscriber = this.textBox;
        }
    }

    /// <inheritdoc />
    public override void draw(SpriteBatch batch)
    {
        // Every visual belongs to this one fixed rectangle. TextBox.Draw uses
        // a separate native nine-slice whose oversized caps drift outside a
        // compact overlay at some UI scales, so input is drawn locally too.
        var panel = new Rectangle(this.xPositionOnScreen, this.yPositionOnScreen, this.width, this.height);
        this.DrawRect(batch, panel, Color.Black * 0.82f);
        this.DrawBorder(batch, panel, new Color(210, 165, 92) * 0.9f);
        this.DrawRect(
            batch,
            new Rectangle(panel.X + BorderWidth, panel.Y + HeaderHeight, panel.Width - (BorderWidth * 2), 1),
            Color.White * 0.2f);
        Utility.drawTextWithShadow(
            batch,
            this.title,
            Game1.smallFont,
            new Vector2(this.xPositionOnScreen + InnerPadding, this.yPositionOnScreen + 14),
            Color.White);
        if (this.isWaiting())
        {
            var waiting = this.translate("chat.waiting-short");
            var waitingWidth = Game1.smallFont.MeasureString(waiting).X;
            Utility.drawTextWithShadow(
                batch,
                waiting,
                Game1.smallFont,
                new Vector2(this.xPositionOnScreen + this.width - InnerPadding - waitingWidth, this.yPositionOnScreen + 14),
                new Color(244, 207, 126));
        }

        var lineHeight = (int)Game1.smallFont.MeasureString("Ag").Y + 4;
        var historyTop = this.yPositionOnScreen + HeaderHeight;
        var historyHeight = Math.Max(lineHeight, this.textBox.Y - historyTop - 8);
        var visibleLines = Math.Max(1, historyHeight / lineHeight);
        this.RefreshWrappedLines();
        this.ClampScroll(visibleLines);
        var start = Math.Max(0, this.wrappedLines.Count - visibleLines - this.scrollOffset);
        var end = Math.Min(this.wrappedLines.Count, start + visibleLines);
        for (var index = start; index < end; index++)
        {
            Utility.drawTextWithShadow(
                batch,
                this.wrappedLines[index],
                Game1.smallFont,
                new Vector2(this.xPositionOnScreen + InnerPadding, historyTop + ((index - start) * lineHeight)),
                Color.White);
        }

        var input = this.InputBounds();
        this.DrawRect(batch, input, Color.Black * 0.48f);
        this.DrawBorder(batch, input, this.textBox.Selected ? new Color(244, 207, 126) : Color.White * 0.28f);
        var inputText = this.textBox.Text.Length == 0
            ? this.translate("chat.input-placeholder")
            : this.textBox.Text;
        var inputColor = this.textBox.Text.Length == 0 ? Color.White * 0.48f : Color.White;
        var textY = input.Y + Math.Max(0, (input.Height - (int)Game1.dialogueFont.MeasureString("Ag").Y) / 2) - 2;
        var textPosition = new Vector2(input.X + InputInset, textY);
        batch.DrawString(Game1.dialogueFont, inputText, textPosition, inputColor);
        if (this.textBox.Selected
            && this.textBox.Text.Length > 0
            && Game1.currentGameTime.TotalGameTime.TotalMilliseconds % 1000 < 550)
        {
            var caretX = Math.Min(input.Right - InputInset - 2, (int)(textPosition.X + Game1.dialogueFont.MeasureString(this.textBox.Text).X + 2));
            this.DrawRect(batch, new Rectangle(caretX, input.Y + 10, 2, input.Height - 20), Color.White * 0.85f);
        }
        this.drawMouse(batch);
    }

    /// <inheritdoc />
    public override void receiveRightClick(int x, int y, bool playSound = true)
    {
    }

    /// <inheritdoc />
    public override void gameWindowSizeChanged(Rectangle oldBounds, Rectangle newBounds)
    {
        base.gameWindowSizeChanged(oldBounds, newBounds);
        this.Reposition();
        this.wrappedForCount = -1;
    }

    /// <inheritdoc />
    protected override void cleanupBeforeExit()
    {
        if (Game1.keyboardDispatcher.Subscriber == this.textBox)
        {
            Game1.keyboardDispatcher.Subscriber = null;
        }
        base.cleanupBeforeExit();
    }

    private void Submit()
    {
        var message = this.textBox.Text.Trim();
        if (message.Length == 0)
        {
            Game1.addHUDMessage(new HUDMessage(this.translate("chat.empty")));
            return;
        }

        if (this.isWaiting())
        {
            Game1.addHUDMessage(new HUDMessage(this.translate("chat.waiting")));
            return;
        }
        if (!this.submit(message))
        {
            return;
        }
        this.textBox.Text = string.Empty;
        this.scrollOffset = 0;
    }

    /// <summary>Re-wraps the transcript for drawing only when its line count changed.</summary>
    private void RefreshWrappedLines()
    {
        if (this.wrappedForCount == this.transcript.Lines.Count)
        {
            return;
        }
        this.wrappedLines = new List<string>();
        var maxWidth = this.width - (InnerPadding * 2);
        foreach (var line in this.transcript.Lines)
        {
            this.wrappedLines.AddRange(this.Wrap($"{line.Speaker}: {line.Text}", maxWidth));
        }
        this.wrappedForCount = this.transcript.Lines.Count;
    }

    private void ClampScroll(int? visibleLines = null)
    {
        var lines = Math.Max(1, visibleLines ?? 10);
        this.scrollOffset = Math.Max(0, Math.Min(this.scrollOffset, Math.Max(0, this.wrappedLines.Count - lines)));
    }

    private IEnumerable<string> Wrap(string text, float maxWidth)
    {
        var remaining = text;
        while (Game1.smallFont.MeasureString(remaining).X > maxWidth)
        {
            var take = remaining.Length;
            while (take > 1 && Game1.smallFont.MeasureString(remaining[..take]).X > maxWidth)
            {
                take--;
            }
            var breakAt = remaining.LastIndexOf(' ', take - 1);
            if (breakAt > 0)
            {
                yield return remaining[..breakAt];
                remaining = remaining[(breakAt + 1)..];
            }
            else
            {
                yield return remaining[..take];
                remaining = remaining[take..].TrimStart();
            }
            if (remaining.Length == 0)
            {
                yield break;
            }
        }
        yield return remaining;
    }

    /// <summary>Anchors the compact chat to the lower-left play area at every UI scale.</summary>
    private void Reposition()
    {
        this.width = Math.Max(320, Math.Min(PreferredWidth, Game1.uiViewport.Width - (ScreenMargin * 2)));
        this.height = Math.Max(220, Math.Min(PreferredHeight, Game1.uiViewport.Height - (ScreenMargin * 2)));
        this.xPositionOnScreen = ScreenMargin;
        this.yPositionOnScreen = Math.Max(ScreenMargin, Game1.uiViewport.Height - this.height - ScreenMargin);
        var input = this.InputBounds();
        this.textBox.X = input.X + InputInset;
        this.textBox.Y = input.Y;
        this.textBox.Width = input.Width - (InputInset * 2);
    }

    private Rectangle InputBounds()
    {
        return new Rectangle(
            this.xPositionOnScreen + InnerPadding,
            this.yPositionOnScreen + this.height - InputAreaHeight + 8,
            this.width - (InnerPadding * 2),
            InputAreaHeight - 20);
    }

    private void DrawBorder(SpriteBatch batch, Rectangle rectangle, Color color)
    {
        this.DrawRect(batch, new Rectangle(rectangle.X, rectangle.Y, rectangle.Width, BorderWidth), color);
        this.DrawRect(batch, new Rectangle(rectangle.X, rectangle.Bottom - BorderWidth, rectangle.Width, BorderWidth), color);
        this.DrawRect(batch, new Rectangle(rectangle.X, rectangle.Y, BorderWidth, rectangle.Height), color);
        this.DrawRect(batch, new Rectangle(rectangle.Right - BorderWidth, rectangle.Y, BorderWidth, rectangle.Height), color);
    }

    private void DrawRect(SpriteBatch batch, Rectangle rectangle, Color color)
    {
        batch.Draw(Game1.staminaRect, rectangle, color);
    }
}
