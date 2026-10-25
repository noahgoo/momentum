/**
 * How to play an exercise's `video_url` inside the app.
 *
 * Coaches paste ordinary share links (a YouTube watch URL, a youtu.be link, a
 * Vimeo page), none of which can be loaded in a player as-is — they are web
 * pages. This maps them to their embeddable player URL, or to a direct file
 * the page can play with a <video> tag. Anything else returns null and the
 * caller falls back to opening the link externally, so an unrecognised host
 * is never loaded into the in-app browser.
 */

export type VideoSource =
  | { kind: "embed"; url: string; host: string }
  | { kind: "file"; url: string };

const FILE_EXTENSIONS = /\.(mp4|m4v|mov|webm)$/i;
const YOUTUBE_ID = /^[\w-]{11}$/;
const VIMEO_ID = /^\d+$/;

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live") id = second ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

function vimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  // vimeo.com/123456789, vimeo.com/channels/x/123456789, player.vimeo.com/video/123456789
  const id = url.pathname.split("/").filter(Boolean).reverse().find((part) => VIMEO_ID.test(part));
  return id ?? null;
}

/** The in-app playback source for a stored video link, or null to open it externally instead. */
export function videoSource(raw: string | null | undefined): VideoSource | null {
  if (!raw) return null;
  const url = parseUrl(raw);
  if (!url) return null;

  const yt = youtubeId(url);
  if (yt) {
    return {
      kind: "embed",
      url: `https://www.youtube-nocookie.com/embed/${yt}?playsinline=1&rel=0&modestbranding=1`,
      host: "www.youtube-nocookie.com",
    };
  }

  const vimeo = vimeoId(url);
  if (vimeo) {
    return { kind: "embed", url: `https://player.vimeo.com/video/${vimeo}?playsinline=1`, host: "player.vimeo.com" };
  }

  if (url.protocol === "https:" && FILE_EXTENSIONS.test(url.pathname)) {
    return { kind: "file", url: url.toString() };
  }

  return null;
}

/** A minimal page that plays one direct video file full-width. The URL is attribute-escaped. */
export function videoFileHtml(fileUrl: string): string {
  const safe = fileUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain}</style></head>
<body><video src="${safe}" controls playsinline autoplay></video></body></html>`;
}
