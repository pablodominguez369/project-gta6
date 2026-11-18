import { describe, expect, it } from "vitest";

import { scriptDraftSchema } from "../script";
import {
  buildAss,
  buildCaptions,
  buildStoryboard,
  CAPTION_MAX_CHARS_PER_LINE,
  CAPTION_MAX_LINES,
  estimateVoiceMs,
  buildEndCard,
  findOverflowingText,
  INDEPENDENCE_NOTICE,
  wrapText,
} from "../storyboard";

const draft = scriptDraftSchema.parse({
  lines: [
    {
      kind: "hook",
      voice: "Por fin hay noticias del juego",
      on_screen: "¡Noticias!",
      pause_ms: 300,
    },
    {
      kind: "body",
      voice:
        "El estudio ha anunciado hoy la fecha de lanzamiento oficial en un comunicado publicado en su web",
      on_screen: "",
    },
  ],
  cta: "",
});

describe("buildStoryboard", () => {
  it("lays lines end to end with their pauses", () => {
    const board = buildStoryboard(draft, [2000, 5000], ["asset-1"]);
    expect(board.scenes.map((s) => [s.startMs, s.voiceMs, s.endMs])).toEqual([
      [0, 2000, 2300],
      [2300, 5000, 7300],
    ]);
    expect(board.totalMs).toBe(7300);
    expect(board.scenes.map((s) => s.backgroundAssetId)).toEqual(["asset-1", null]);
  });

  it("estimates narration with the script QA speaking rate", () => {
    expect(
      estimateVoiceMs("una dos tres cuatro cinco seis siete ocho nueve diez once doce trece"),
    ).toBe(5000);
    expect(estimateVoiceMs("")).toBe(500);
  });
});

describe("wrapText", () => {
  it("never exceeds the limit, even with a very long word", () => {
    const lines = wrapText("hola supercalifragilisticoespialidoso mundo", 10);
    expect(lines.every((line) => line.length <= 10)).toBe(true);
    expect(lines.join("").replace(/ /g, "")).toBe("holasupercalifragilisticoespialidosomundo");
  });
});

describe("buildCaptions", () => {
  const board = buildStoryboard(draft, [2000, 5000], []);
  const cues = buildCaptions(board);

  it("keeps every cue within two lines that fit the safe area", () => {
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(CAPTION_MAX_LINES);
      for (const line of cue.lines)
        expect(line.length).toBeLessThanOrEqual(CAPTION_MAX_CHARS_PER_LINE);
    }
  });

  it("covers each line's narration exactly, in order, without overlaps", () => {
    const body = cues.filter((cue) => cue.startMs >= 2300);
    expect(body[0]?.startMs).toBe(2300);
    expect(body.at(-1)?.endMs).toBe(7300);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]?.startMs).toBeGreaterThanOrEqual(cues[i - 1]?.endMs ?? 0);
    }
    const words = cues.flatMap((cue) => cue.lines.join(" ").split(" "));
    expect(words.join(" ")).toBe(draft.lines.map((line) => line.voice).join(" "));
  });
});

describe("findOverflowingText", () => {
  it("flags headlines that need more than three lines", () => {
    const long = scriptDraftSchema.parse({
      lines: [
        {
          kind: "hook",
          voice: "Hola",
          on_screen:
            "Un titular larguísimo que no cabe en tres líneas de texto en la pantalla del móvil",
        },
        { kind: "body", voice: "Adiós", on_screen: "Corto" },
      ],
    });
    expect(findOverflowingText(buildStoryboard(long, [1000, 1000], []))).toEqual([0]);
  });
});

describe("buildAss", () => {
  it("writes captions, headlines, brand and disclosure, escaping override braces", () => {
    const tricky = scriptDraftSchema.parse({
      lines: [
        { kind: "hook", voice: "Texto {\\b1}inyectado", on_screen: "Titular" },
        { kind: "body", voice: "Fin", on_screen: "" },
      ],
    });
    const ass = buildAss(buildStoryboard(tricky, [1500, 1000], []), {
      font: "DejaVu Sans",
      disclosure: "Voz generada con IA",
      brand: "Canal",
    });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Small,,0,0,0,,Canal · Voz generada con IA");
    expect(ass).toContain("Headline,,0,0,0,,Titular");
    expect(ass).toContain("Caption,,0,0,0,,Texto \\\\b1inyectado");
    expect(ass).not.toContain("{\\b1}");
    expect(ass).toContain("Dialogue: 2,0:00:00.00,0:00:05.00");
    expect(ass).toContain(
      `Dialogue: 1,0:00:02.50,0:00:05.00,Card,,0,0,0,,${INDEPENDENCE_NOTICE.slice(0, 10)}`,
    );
  });
});

describe("buildEndCard", () => {
  it("always carries the independence notice and lists each attribution once", () => {
    expect(buildEndCard([])).toEqual(buildEndCard([" ", ""]));
    const card = buildEndCard(["Foto: Banco X", "Foto: Banco X", "Música: Y"]);
    expect(card.join(" ")).toContain("independiente");
    expect(card.filter((line) => line === "Foto: Banco X")).toHaveLength(1);
    expect(card).toContain("Música: Y");
  });
});
