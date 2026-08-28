using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using StardewValley;
using StardewValley.Menus;

namespace DSHPlayer2.Stardew;

/// <summary>Collects one player-authored companion message through the game's native keyboard dispatcher.</summary>
internal sealed class CompanionChatMenu : IClickableMenu
{
    private readonly Action<string> submit;
    private readonly TextBox textBox;

    /// <summary>Creates a small modal input surface without owning any game action.</summary>
    public CompanionChatMenu(Action<string> submit)
        : base(0, 0, Game1.tileSize * 12, Game1.tileSize * 4, true)
    {
        this.submit = submit;
        var position = Utility.getTopLeftPositionForCenteringOnScreen(this.width, this.height);
        this.xPositionOnScreen = (int)position.X;
        this.yPositionOnScreen = (int)position.Y;
        this.initializeUpperRightCloseButton();

        this.textBox = new TextBox(null, null, Game1.dialogueFont, Game1.textColor)
        {
            X = this.xPositionOnScreen + Game1.tileSize / 2,
            Y = this.yPositionOnScreen + Game1.tileSize * 2,
            Width = this.width - Game1.tileSize,
            Text = string.Empty,
            Selected = true,
            limitWidth = true,
        };
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
        }
    }

    /// <inheritdoc />
    public override void receiveLeftClick(int x, int y, bool playSound = true)
    {
        base.receiveLeftClick(x, y, playSound);
        if (Game1.activeClickableMenu is null)
        {
            return;
        }

        this.textBox.Selected = x >= this.textBox.X
            && x < this.textBox.X + this.textBox.Width
            && y >= this.textBox.Y
            && y < this.textBox.Y + this.textBox.Height;
        if (this.textBox.Selected)
        {
            Game1.keyboardDispatcher.Subscriber = this.textBox;
        }
    }

    /// <inheritdoc />
    public override void draw(SpriteBatch batch)
    {
        Game1.drawDialogueBox(this.xPositionOnScreen, this.yPositionOnScreen, this.width, this.height, false, true);
        Utility.drawTextWithShadow(
            batch,
            "Talk with Player2 (Enter to send; Esc to close)",
            Game1.smallFont,
            new Vector2(this.xPositionOnScreen + Game1.tileSize / 2, this.yPositionOnScreen + Game1.tileSize / 2),
            Game1.textColor);
        this.textBox.Draw(batch);
        this.drawMouse(batch);
    }

    /// <inheritdoc />
    public override void receiveRightClick(int x, int y, bool playSound = true)
    {
    }

    private void Submit()
    {
        var message = this.textBox.Text.Trim();
        if (message.Length == 0)
        {
            Game1.addHUDMessage(new HUDMessage("Player2: Please type a message first."));
            return;
        }

        this.submit(message);
        this.exitThisMenu();
    }
}
