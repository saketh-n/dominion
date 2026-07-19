import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

/**
 * Synchronized player state (tile coordinates; client interpolates pixels).
 *
 * NOTE: fields use `declare` + constructor assignment (NOT class-field
 * initializers). defineTypes installs accessors on the prototype; class-field
 * initializers compile to Object.defineProperty under modern targets, which
 * would shadow those accessors and break change tracking. Plain constructor
 * assignments always go through the setters, under every transpiler
 * (tsx/esbuild on the server, Vite on the client).
 */
export class PlayerState extends Schema {
  declare name: string;
  declare x: number;
  declare y: number;
  declare dir: number;
  declare skin: number;
  declare houseId: number;
  /** "world" or "interior" — players in interiors are hidden from the overworld. */
  declare place: string;
  declare inBattle: boolean;

  constructor() {
    super();
    this.name = "";
    this.x = 0;
    this.y = 0;
    this.dir = 0;
    this.skin = 0;
    this.houseId = -1;
    this.place = "world";
    this.inBattle = false;
  }
}

defineTypes(PlayerState, {
  name: "string",
  x: "uint16",
  y: "uint16",
  dir: "uint8",
  skin: "uint8",
  houseId: "int16",
  place: "string",
  inBattle: "boolean",
});

export class WorldState extends Schema {
  declare players: MapSchema<PlayerState>;

  constructor() {
    super();
    this.players = new MapSchema<PlayerState>();
  }
}

defineTypes(WorldState, {
  players: { map: PlayerState },
});
