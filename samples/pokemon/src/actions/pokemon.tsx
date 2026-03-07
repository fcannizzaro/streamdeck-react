import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { defineAction, useKeyDown, Image, tw } from "@fcannizzaro/streamdeck-react";

// ── Helpers ─────────────────────────────────────────────────────────

const MAX_POKEMON_ID = 1025;

function randomPokemonId(): number {
  return Math.floor(Math.random() * MAX_POKEMON_ID) + 1;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function padId(id: number): string {
  return `#${String(id).padStart(3, "0")}`;
}

async function bufferToDataUri(
  response: Response,
  mime: string,
): Promise<string> {
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${mime};base64,${base64}`;
}

// ── Query Function ──────────────────────────────────────────────────

interface PokemonData {
  id: number;
  name: string;
  spriteDataUri: string;
}

async function fetchPokemon(
  id: number,
  signal: AbortSignal,
): Promise<PokemonData> {
  // 1. Fetch Pokemon data
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, {
    signal,
  });

  if (!res.ok) {
    throw new Error(`PokeAPI returned ${res.status}`);
  }

  const json = (await res.json()) as {
    name: string;
    sprites: {
      front_default: string | null;
      other?: {
        "official-artwork"?: { front_default: string | null };
      };
    };
  };

  const name = json.name;

  // 2. Pick sprite URL (front_default with official-artwork fallback)
  const spriteUrl =
    json.sprites.front_default ??
    json.sprites.other?.["official-artwork"]?.front_default ??
    null;

  if (!spriteUrl) {
    throw new Error(`No sprite available for Pokemon ${id}`);
  }

  // 3. Fetch the sprite image and convert to data URI
  const spriteRes = await fetch(spriteUrl, { signal });

  if (!spriteRes.ok) {
    throw new Error(`Sprite fetch returned ${spriteRes.status}`);
  }

  const spriteDataUri = await bufferToDataUri(spriteRes, "image/png");

  return { id, name, spriteDataUri };
}

// ── Component ───────────────────────────────────────────────────────

function PokemonKey() {
  const [pokemonId, setPokemonId] = useState(() => randomPokemonId());

  useKeyDown(() => {
    setPokemonId(randomPokemonId());
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pokemon", pokemonId],
    queryFn: ({ signal }) => fetchPokemon(pokemonId, signal),
  });

  if (isLoading) {
    return (
      <div
        className={tw(
          "flex h-full w-full flex-col items-center justify-center",
          "bg-linear-to-br from-[#1a1a2e] to-[#16213e]",
        )}
      >
        <span className="text-[14px] font-bold text-white/80">
          Loading...
        </span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        className={tw(
          "flex h-full w-full flex-col items-center justify-center gap-1",
          "bg-linear-to-br from-[#4a0000] to-[#1a0000]",
        )}
      >
        <span className="text-[12px] font-bold text-[#ff6b6b]">Error</span>
        <span className="text-[10px] text-white/50">{padId(pokemonId)}</span>
      </div>
    );
  }

  return (
    <div
      className={tw(
        "relative h-full w-full overflow-hidden",
        "bg-linear-to-br from-[#0f3460] to-[#533483]",
      )}
    >
      <div className={tw("absolute inset-0 flex items-center justify-center")}>
        <Image src={data.spriteDataUri} width={144} height={144} fit="contain" />
      </div>
      <div
        className={tw(
          "relative z-10 flex h-full w-full items-end justify-center px-2 pb-2",
        )}
      >
        <span
          className="text-[16px] font-bold text-white"
          style={{ textShadow: "0 3px 8px rgba(0, 0, 0, 0.9)" }}
        >
          {capitalize(data.name)}
        </span>
      </div>
    </div>
  );
}

// ── Action Definition ───────────────────────────────────────────────

export const pokemonAction = defineAction({
  uuid: "com.example.react-pokemon.pokemon",
  key: PokemonKey,
});
