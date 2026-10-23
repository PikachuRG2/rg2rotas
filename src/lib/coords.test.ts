import { describe, it, expect } from "vitest";
import { parseCoords } from "./coords";

describe("parseCoords", () => {
  it("lê coordenadas coladas", () => expect(parseCoords("-23.55052, -46.633308")).toEqual({ lat: -23.55052, lng: -46.633308 }));
  it("lê link do Google Maps", () => expect(parseCoords("https://www.google.com/maps/place/x/@-23.5,-46.6,17z")).toEqual({ lat: -23.5, lng: -46.6 }));
  it("ignora endereço com número", () => expect(parseCoords("Rua Augusta 1500")).toBeNull());
});

it("link de rota usa o destino, não a origem", () =>
  expect(parseCoords("https://www.google.com/maps/dir/-10.19,-48.88/R.+55/data=!3d-10.1921354!4d-48.8892659")).toEqual({ lat: -10.1921354, lng: -48.8892659 }));
