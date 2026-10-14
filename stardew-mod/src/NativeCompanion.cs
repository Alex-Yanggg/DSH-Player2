using System;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using StardewValley;
using StardewValley.Pathfinding;

namespace DSHPlayer2.Stardew;

/// <summary>A real location actor. Stardew owns movement, collision, animation and farmer drawing.</summary>
internal sealed class NativeCompanion : NPC
{
    private readonly Farmer avatar;
    private readonly Action<string, string> report;
    private bool following;
    private bool approaching;
    private Point destination;
    private double repathMs;
    private double travelMs;
    private int? avatarMovementDirection;
    // P2-0021 raw input: directions currently held by a body task (bit 0 up,
    // 1 right, 2 down, 3 left) and the cheat-class no-clip modifier.
    private int heldDirections;
    private bool noClip;

    /// <summary>Walking distance per unpaused tick under raw input, declared to the plugin.</summary>
    public const float InputWalkPxPerTick = 4f;

    public NativeCompanion(string displayName, CompanionAppearance appearance, Action<string, string> report)
        : base(new AnimatedSprite("Characters/Farmer/farmer_base", 0, 16, 32), Vector2.Zero, 2, "DSHPlayer2_Companion")
    {
        this.avatar = Game1.player.CreateFakeEventFarmer();
        appearance.Apply(this.avatar);
        this.avatar.Name = displayName;
        this.displayName = displayName;
        this.report = report;
        this.followSchedule = false;
        this.SimpleNonVillagerNPC = true;
        this.willDestroyObjectsUnderfoot = false;
        this.Speed = 3;
        this.AllowDynamicAppearance = false;
        this.avatar.faceDirection(this.FacingDirection);
        CompanionInventoryStore.LoadInto(this.avatar);
    }

    public bool Following => this.following;
    public string MovementState => this.heldDirections != 0 ? "input" : this.controller is not null ? "walking" : this.following ? "following" : "standing";
    /// <summary>The farmer body Stardew draws and tools act through.</summary>
    public Farmer Avatar => this.avatar;
    /// <summary>
    /// Where the farmer avatar stands for this NPC body. A farmer's hitbox
    /// starts at its position and an NPC's 16 px lower; drawing and acting
    /// through the avatar 16 px lower keeps both hitboxes, and so the tile the
    /// body is drawn on, identical to the tile the game and the state report.
    /// </summary>
    public Vector2 AvatarPosition => this.Position + new Vector2(0, 16);
    /// <summary>Last game tick the location (or the adapter) updated this actor.</summary>
    public int LastUpdateTick { get; private set; } = -1;
    /// <summary>Whether movement was held on the last unpaused update, and how far it got.</summary>
    public bool LastHeldMovement { get; private set; }
    public double LastDisplacementPx { get; private set; }

    /// <summary>
    /// Applies the buttons a body task holds this tick. Holding a direction is
    /// what a player's WASD does: the body walks with the engine's collision.
    /// Any held direction ends come/follow, like a player taking the stick.
    /// </summary>
    public void SetHeld(System.Collections.Generic.IReadOnlyCollection<string> held)
    {
        var mask = 0;
        foreach (var id in held)
        {
            mask |= id switch { "MoveUp" => 1, "MoveRight" => 2, "MoveDown" => 4, "MoveLeft" => 8, _ => 0 };
        }
        this.noClip = System.Linq.Enumerable.Contains(held, "NoClip");
        if (mask != 0 && (this.controller is not null || this.following))
        {
            this.controller = null;
            this.following = false;
            this.approaching = false;
        }
        this.heldDirections = mask;
    }

    /// <summary>The box the last held step tried to enter, used for walk-warps at map edges.</summary>
    public Rectangle? LastAttemptedBox { get; set; }

    /// <summary>A body task took the controller: come/follow end silently.</summary>
    public void StopForInput()
    {
        this.controller = null;
        this.following = false;
        this.approaching = false;
    }

    /// <summary>Turns the body without stepping (a short tap of a direction).</summary>
    public void Face(int direction)
    {
        this.FacingDirection = direction;
        this.avatar.faceDirection(direction);
    }
    public void ApplyAppearance(CompanionAppearance appearance) => appearance.Apply(this.avatar);

    public static Point? FindOpenTileNearPlayer()
    {
        var location = Game1.currentLocation;
        foreach (var tile in NearbyTiles(Game1.player.TilePoint, 1, 3))
        {
            if (tile.X < 0 || tile.Y < 0 || tile.X >= location.Map.Layers[0].LayerWidth || tile.Y >= location.Map.Layers[0].LayerHeight) continue;
            if (!location.isCollidingPosition(new Rectangle(tile.X * 64 + 8, tile.Y * 64 + 16, 48, 32), Game1.viewport, true, 0, false, Game1.player, pathfinding: true)) return tile;
        }
        return null;
    }

    public bool PlaceAt(GameLocation location, Point tile)
    {
        if (!this.IsOpen(location, tile)) return false;
        this.controller = null;
        this.Halt();
        this.currentLocation?.characters.Remove(this);
        this.currentLocation = location;
        this.Position = new Vector2(tile.X * 64, tile.Y * 64);
        this.StopAvatarMovement();
        this.avatar.Position = this.AvatarPosition;
        this.avatar.currentLocation = location;
        location.characters.Add(this);
        return true;
    }

    public override bool shouldCollideWithBuildingLayer(GameLocation location) => true;
    public override bool canPassThroughActionTiles() => false;
    public override bool checkAction(Farmer who, GameLocation location) => false;
    public override void dayUpdate(int dayOfMonth)
    {
        this.avatar.Stamina = this.avatar.MaxStamina;
        this.heldDirections = 0;
        this.controller = null;
        this.following = false;
        this.approaching = false;
        this.Halt();
        this.StopAvatarMovement();
    }

    // The location invokes this, including correct pause/menu behavior. No second mod tick moves the actor.
    public override void update(GameTime time, GameLocation location)
    {
        this.LastUpdateTick = Game1.ticks;
        this.currentLocation = location;
        var before = this.Position;
        if (Game1.activeClickableMenu is null && !Game1.eventUp && Game1.shouldTimePass())
        {
            this.LastAttemptedBox = null;
            if (this.heldDirections != 0) this.MoveByInput(location);
            this.LastHeldMovement = this.heldDirections != 0;
            this.LastDisplacementPx = Vector2.Distance(before, this.Position);
            this.repathMs -= time.ElapsedGameTime.TotalMilliseconds;
            if (this.controller is not null)
            {
                this.travelMs += time.ElapsedGameTime.TotalMilliseconds;
                if (this.controller.update(time) || this.travelMs > 30000)
                {
                    this.controller = null;
                    this.Halt();
                    if (this.TilePoint != this.destination)
                    {
                        this.following = false;
                        this.approaching = false;
                        this.report("failed", "path-blocked");
                    }
                    else if (this.approaching)
                    {
                        this.approaching = false;
                        this.report("completed", "arrived");
                    }
                }
            }
            if (this.following && this.currentLocation == Game1.currentLocation && this.repathMs <= 0
                && Vector2.Distance(this.Tile, Game1.player.Tile) > 3)
            {
                this.repathMs = 1000;
                if (!this.WalkNearPlayer())
                {
                    this.following = false;
                    this.report("failed", "path-blocked");
                }
            }
        }
        this.avatar.Position = this.AvatarPosition;
        this.avatar.currentLocation = location;
        if (before != this.Position)
        {
            var direction = MovementDirection(before, this.Position, this.FacingDirection);
            this.FacingDirection = direction;
            if (this.avatarMovementDirection != direction)
            {
                this.avatar.Halt();
                SetFarmerMoving(this.avatar, direction);
                this.avatarMovementDirection = direction;
            }
            this.avatar.updateMovementAnimation(time);
        }
        else
        {
            this.StopAvatarMovement();
        }
    }

    public override void draw(SpriteBatch batch, float alpha = 1f)
    {
        this.avatar.Position = this.AvatarPosition;
        this.avatar.currentLocation = this.currentLocation;
        this.avatar.draw(batch);
    }

    /// <summary>
    /// One tick of held movement, axis by axis, with the engine's collision.
    /// When an axis is blocked the body slides toward the tile centre the way
    /// a farmer's body slips around a corner instead of sticking to it.
    /// </summary>
    private void MoveByInput(GameLocation location)
    {
        var dx = ((this.heldDirections & 2) != 0 ? 1 : 0) - ((this.heldDirections & 8) != 0 ? 1 : 0);
        var dy = ((this.heldDirections & 4) != 0 ? 1 : 0) - ((this.heldDirections & 1) != 0 ? 1 : 0);
        if (dx != 0) this.FacingDirection = dx > 0 ? 1 : 3;
        else if (dy != 0) this.FacingDirection = dy > 0 ? 2 : 0;
        if (dx != 0 && !this.TryStep(location, dx * InputWalkPxPerTick, 0)) this.Slide(location, horizontal: true);
        if (dy != 0 && !this.TryStep(location, 0, dy * InputWalkPxPerTick)) this.Slide(location, horizontal: false);
    }

    private bool TryStep(GameLocation location, float mx, float my)
    {
        var box = this.GetBoundingBox();
        box.Offset((int)mx, (int)my);
        this.LastAttemptedBox = box;
        if (!this.noClip && this.CollidesAsFarmer(location, box)) return false;
        this.Position += new Vector2(mx, my);
        return true;
    }

    /// <summary>
    /// The engine's collision for a farmer's body at <paramref name="box"/>.
    /// The engine treats any NPC as a villager (NPCBarrier tiles fence the
    /// farm exits and mine levels), so the check runs as the body's own
    /// farmer avatar; the companion is passable to it, as one's own body is.
    /// </summary>
    public bool CollidesAsFarmer(GameLocation location, Rectangle box)
    {
        this.avatar.currentLocation = location;
        this.avatar.Position = this.AvatarPosition;
        var passes = this.farmerPassesThrough;
        this.farmerPassesThrough = true;
        try
        {
            return location.isCollidingPosition(box, Game1.viewport, true, 0, false, this.avatar);
        }
        finally
        {
            this.farmerPassesThrough = passes;
        }
    }

    private void Slide(GameLocation location, bool horizontal)
    {
        var box = this.GetBoundingBox();
        var center = box.Center;
        var offset = horizontal
            ? (this.TilePoint.Y * 64 + 32) - center.Y
            : (this.TilePoint.X * 64 + 32) - center.X;
        if (Math.Abs(offset) < 1) return;
        var nudge = Math.Sign(offset) * Math.Min(Math.Abs(offset), InputWalkPxPerTick);
        if (horizontal) this.TryStep(location, 0, nudge);
        else this.TryStep(location, nudge, 0);
    }

    public bool PlaceNearPlayer()
    {
        var location = Game1.currentLocation;
        foreach (var tile in NearbyTiles(Game1.player.TilePoint, 2, 5))
        {
            if (!this.IsOpen(location, tile)) continue;
            return this.PlaceAt(location, tile);
        }
        return false;
    }

    public bool Command(string command)
    {
        if (command is not ("come" or "follow" or "stay")) return false;
        this.heldDirections = 0;
        this.controller = null;
        this.Halt();
        this.following = command == "follow";
        this.approaching = command != "stay";
        if (command == "stay") { this.report("completed", "stopped"); return true; }
        // A location transition uses the engine's actor membership, never a screen overlay.
        // Cross-map summon is explicit; ordinary walking always uses PathFindController.
        if (this.currentLocation != Game1.currentLocation && !this.PlaceNearPlayer()) return false;
        this.report("started", command);
        if (!this.WalkNearPlayer()) { this.following = false; this.approaching = false; return false; }
        return true;
    }

    private bool WalkNearPlayer()
    {
        foreach (var tile in NearbyTiles(Game1.player.TilePoint, 1, 2))
        {
            if (!this.IsOpen(this.currentLocation, tile)) continue;
            if (tile == this.TilePoint)
            {
                this.controller = null;
                if (this.approaching) this.report("completed", "arrived");
                this.approaching = false;
                return true;
            }
            var path = PathFindController.findPath(this.TilePoint, tile, PathFindController.isAtEndPoint, this.currentLocation, this, 2000);
            if (path is null || path.Count == 0) continue;
            this.destination = tile;
            this.travelMs = 0;
            this.controller = new PathFindController(path, this.currentLocation, this, tile) { nonDestructivePathing = true };
            return true;
        }
        return false;
    }

    private bool IsOpen(GameLocation location, Point tile)
    {
        if (tile.X < 0 || tile.Y < 0 || tile.X >= location.Map.Layers[0].LayerWidth || tile.Y >= location.Map.Layers[0].LayerHeight) return false;
        if (tile == Game1.player.TilePoint && location == Game1.currentLocation) return false;
        return !location.isCollidingPosition(new Rectangle(tile.X * 64 + 8, tile.Y * 64 + 16, 48, 32), Game1.viewport, false, 0, false, this, pathfinding: true);
    }

    private void StopAvatarMovement()
    {
        if (this.avatarMovementDirection is not null)
        {
            this.avatar.Halt();
            this.avatarMovementDirection = null;
        }
        if (this.avatar.FacingDirection != this.FacingDirection)
        {
            this.avatar.faceDirection(this.FacingDirection);
        }
    }

    private static int MovementDirection(Vector2 before, Vector2 after, int fallback)
    {
        var delta = after - before;
        if (Math.Abs(delta.X) > Math.Abs(delta.Y)) return delta.X > 0 ? 1 : 3;
        if (Math.Abs(delta.Y) > 0) return delta.Y > 0 ? 2 : 0;
        return fallback;
    }

    private static void SetFarmerMoving(Farmer farmer, int direction)
    {
        switch (direction)
        {
            case 0: farmer.SetMovingUp(true); break;
            case 1: farmer.SetMovingRight(true); break;
            case 2: farmer.SetMovingDown(true); break;
            case 3: farmer.SetMovingLeft(true); break;
        }
    }

    private static System.Collections.Generic.IEnumerable<Point> NearbyTiles(Point center, int min, int max)
    {
        for (var radius = min; radius <= max; radius++)
            for (var y = -radius; y <= radius; y++)
                for (var x = -radius; x <= radius; x++)
                    if (Math.Max(Math.Abs(x), Math.Abs(y)) == radius) yield return new Point(center.X + x, center.Y + y);
    }
}
