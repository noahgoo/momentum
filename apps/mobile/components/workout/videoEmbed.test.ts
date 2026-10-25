import { describe, expect, it } from "vitest";
import { videoFileHtml, videoSource } from "./videoEmbed";

const yt = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1`;

describe("videoSource", () => {
  it("maps every common YouTube link shape to the embed player", () => {
    const id = "dQw4w9WgXcQ";
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
    ]) {
      expect(videoSource(link), link).toEqual({ kind: "embed", url: yt(id), host: "www.youtube-nocookie.com" });
    }
  });

  it("maps Vimeo page and player links", () => {
    expect(videoSource("https://vimeo.com/123456789")).toMatchObject({
      kind: "embed",
      url: "https://player.vimeo.com/video/123456789?playsinline=1",
    });
    expect(videoSource("https://player.vimeo.com/video/123456789")).toMatchObject({ kind: "embed" });
  });

  it("plays direct https files with a video tag", () => {
    expect(videoSource("https://cdn.example.com/clips/row.mp4")).toEqual({
      kind: "file",
      url: "https://cdn.example.com/clips/row.mp4",
    });
    expect(videoSource("http://cdn.example.com/row.mp4")).toBeNull();
  });

  it("returns null for anything it should not load in-app", () => {
    expect(videoSource(null)).toBeNull();
    expect(videoSource("")).toBeNull();
    expect(videoSource("not a url")).toBeNull();
    expect(videoSource("javascript:alert(1)")).toBeNull();
    expect(videoSource("https://example.com/some-page")).toBeNull();
    // A lookalike host must not pass as YouTube.
    expect(videoSource("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    // A malformed id is not trusted into the embed path.
    expect(videoSource("https://www.youtube.com/watch?v=../../x")).toBeNull();
  });
});

describe("videoFileHtml", () => {
  it("escapes the URL so it cannot break out of the attribute", () => {
    const html = videoFileHtml('https://x.test/a.mp4"><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;");
  });
});
