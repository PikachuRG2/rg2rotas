import { describe, it, expect } from "vitest";
import { parseCoords } from "./coords";

describe("parseCoords", () => {
  it("lê coordenadas coladas", () => expect(parseCoords("-23.55052, -46.633308")).toEqual({ lat: -23.55052, lng: -46.633308 }));
  it("lê link do Google Maps", () => expect(parseCoords("https://www.google.com/maps/place/x/@-23.5,-46.6,17z")).toEqual({ lat: -23.5, lng: -46.6 }));
  it("ignora endereço com número", () => expect(parseCoords("Rua Augusta 1500")).toBeNull());
});
