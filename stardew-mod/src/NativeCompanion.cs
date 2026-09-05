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
    }

    public bool Following => this.following;
    public string MovementState => this.controller is not null ? "walking" : this.following ? "following" : "standing";
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
        location.characters.Add(this);
        return true;
    }

    public override bool shouldCollideWithBuildingLayer(GameLocation location) => true;
    public override bool canPassThroughActionTiles() => false;
    public override bool checkAction(Farmer who, GameLocation location) => false;
    public override void dayUpdate(int dayOfMonth)
    {
        this.controller = null;
        this.following = false;
        this.approaching = false;
        this.Halt();
    }

    // The location invokes this, including correct pause/menu behavior. No second mod tick moves the actor.
    public override void update(GameTime time, GameLocation location)
    {
        this.currentLocation = location;
        var before = this.Position;
        if (Game1.activeClickableMenu is null && !Game1.eventUp && Game1.shouldTimePass())
        {
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
        this.avatar.Position = this.Position;
        this.avatar.currentLocation = location;
        this.avatar.faceDirection(this.FacingDirection);
        if (before != this.Position)
        {
            var animation = this.FacingDirection switch { 0 => FarmerSprite.walkUp, 1 => FarmerSprite.walkRight, 3 => FarmerSprite.walkLeft, _ => FarmerSprite.walkDown };
            this.avatar.FarmerSprite.animate(animation, time);
        }
        else this.avatar.FarmerSprite.StopAnimation();
    }

    public override void draw(SpriteBatch batch, float alpha = 1f)
    {
        this.avatar.Position = this.Position;
        this.avatar.currentLocation = this.currentLocation;
        this.avatar.draw(batch);
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

    private static System.Collections.Generic.IEnumerable<Point> NearbyTiles(Point center, int min, int max)
    {
        for (var radius = min; radius <= max; radius++)
            for (var y = -radius; y <= radius; y++)
                for (var x = -radius; x <= radius; x++)
                    if (Math.Max(Math.Abs(x), Math.Abs(y)) == radius) yield return new Point(center.X + x, center.Y + y);
    }
}
