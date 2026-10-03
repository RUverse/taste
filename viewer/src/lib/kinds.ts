/** How each kind of item is labelled and drawn. Unknown kinds fall back to their parent kind. */

export interface KindStyle {
  label: string;
  plural: string;
  icon: string;
  /** Width / height of the card artwork when the item has no image with a known size. */
  aspect: number;
}

const KINDS: Record<string, KindStyle> = {
  movie: { label: "Movie", plural: "Movies", icon: "film", aspect: 2 / 3 },
  tv: { label: "Series", plural: "Series", icon: "tv", aspect: 2 / 3 },
  "tv.episode": { label: "Episode", plural: "Episodes", icon: "tv", aspect: 16 / 9 },
  music: { label: "Music", plural: "Music", icon: "music", aspect: 1 },
  "music.track": { label: "Track", plural: "Tracks", icon: "music", aspect: 1 },
  "music.album": { label: "Album", plural: "Albums", icon: "disc", aspect: 1 },
  podcast: { label: "Podcast", plural: "Podcasts", icon: "mic", aspect: 1 },
  "podcast.episode": { label: "Podcast", plural: "Podcasts", icon: "mic", aspect: 1 },
  video: { label: "Video", plural: "Videos", icon: "play", aspect: 16 / 9 },
  game: { label: "Game", plural: "Games", icon: "gamepad", aspect: 3 / 4 },
  book: { label: "Book", plural: "Books", icon: "book", aspect: 2 / 3 },
  article: { label: "Article", plural: "Articles", icon: "article", aspect: 4 / 3 },
  image: { label: "Image", plural: "Images", icon: "image", aspect: 4 / 3 },
  place: { label: "Place", plural: "Places", icon: "pin", aspect: 4 / 3 },
  note: { label: "Note", plural: "Notes", icon: "note", aspect: 4 / 3 },
};

export function kindStyle(kind: string): KindStyle {
  let key = kind;
  while (key) {
    const style = KINDS[key];
    if (style) return style;
    key = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
  }
  const label = kind.split(".").pop() ?? kind;
  const name = label.charAt(0).toUpperCase() + label.slice(1).replaceAll("-", " ");
  return { label: name, plural: name, icon: "box", aspect: 1 };
}
