import type { Actor, Availability, Item } from "@ruverse/taste";

export function bytes(count: number | undefined): string {
  if (count === undefined) return "";
  if (count < 1024) return `${count} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = count / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

export function date(value: string | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
}

export function actorLabel(actor: Actor | undefined): string {
  if (!actor) return "";
  if (actor.type === "agent") return actor.name ? capitalize(actor.name) : "An agent";
  return "You";
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** `director` → `Director`, `release_date` → `Release date`. */
export function fieldLabel(key: string): string {
  return capitalize(key.replaceAll(/[_-]+/g, " "));
}

const SERVICES: Record<string, string> = {
  netflix: "Netflix",
  prime: "Prime Video",
  "prime-video": "Prime Video",
  disney: "Disney+",
  "disney-plus": "Disney+",
  apple: "Apple TV+",
  "apple-tv": "Apple TV+",
  max: "Max",
  hbo: "HBO",
  hulu: "Hulu",
  mubi: "MUBI",
  spotify: "Spotify",
  "apple-music": "Apple Music",
  youtube: "YouTube",
  "youtube-music": "YouTube Music",
  tidal: "Tidal",
  deezer: "Deezer",
  bandcamp: "Bandcamp",
  soundcloud: "SoundCloud",
  steam: "Steam",
  gog: "GOG",
  "epic-games": "Epic Games",
  "nintendo-eshop": "Nintendo eShop",
  "playstation-store": "PlayStation Store",
  xbox: "Xbox",
  kindle: "Kindle",
};

/** Service ids with known names, offered when someone adds where to find an item. */
export const KNOWN_SERVICES = Object.keys(SERVICES);

export function serviceName(service: string): string {
  return SERVICES[service] ?? fieldLabel(service);
}

export function offerLabel(offer: Availability): string {
  const parts = [];
  if (offer.type) parts.push(capitalize(offer.type));
  if (offer.region) parts.push(offer.region);
  return parts.join(" · ");
}

const ID_NAMES: Record<string, string> = {
  tmdb: "TMDB",
  imdb: "IMDb",
  tvdb: "TVDB",
  musicbrainz: "MusicBrainz",
  spotify: "Spotify",
  isrc: "ISRC",
  upc: "UPC",
  igdb: "IGDB",
  steam: "Steam",
  isbn: "ISBN",
  openlibrary: "Open Library",
  youtube: "YouTube",
  vimeo: "Vimeo",
  doi: "DOI",
  osm: "OpenStreetMap",
  apple: "Apple",
};

export function idName(catalog: string): string {
  return ID_NAMES[catalog] ?? fieldLabel(catalog);
}

/** A web page for an external id, when the catalog has a predictable address. */
export function idUrl(catalog: string, value: string | number, item: Item): string | undefined {
  const id = encodeURIComponent(String(value));
  switch (catalog) {
    case "tmdb":
      if (item.kind === "movie") return `https://www.themoviedb.org/movie/${id}`;
      if (item.kind === "tv") return `https://www.themoviedb.org/tv/${id}`;
      return undefined;
    case "imdb":
      return `https://www.imdb.com/title/${id}/`;
    case "musicbrainz":
      if (item.kind === "music.album") return `https://musicbrainz.org/release-group/${id}`;
      if (item.kind === "music.track") return `https://musicbrainz.org/recording/${id}`;
      return undefined;
    case "spotify": {
      const type = item.kind === "music.album" ? "album" : item.kind === "music.track" ? "track" : item.kind === "podcast.episode" ? "episode" : undefined;
      return type ? `https://open.spotify.com/${type}/${id}` : undefined;
    }
    case "steam":
      return `https://store.steampowered.com/app/${id}/`;
    case "isbn":
      return `https://openlibrary.org/isbn/${id}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${id}`;
    case "doi":
      return `https://doi.org/${String(value)}`;
    default:
      return undefined;
  }
}

/** Only follow links that are plainly web addresses. */
export function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const BYLINE_FIELDS = [
  "artists",
  "artist",
  "director",
  "creators",
  "developers",
  "authors",
  "author",
  "channel",
  "show",
  "site",
];

/** Who made it, from the usual `meta` fields: `Sofia Coppola`, `Radiohead`. */
export function byline(item: Item): string {
  const meta = item.meta ?? {};
  for (const field of BYLINE_FIELDS) {
    const value = meta[field];
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value)) {
      const names = value.filter((part): part is string => typeof part === "string");
      if (names.length) return names.join(", ");
    }
  }
  return "";
}
