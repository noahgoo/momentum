/**
 * Design tokens ported from the Mindful Miya reference app
 * (mindful-miya/src/app/globals.css). Reference only — that repo is not
 * modified. RN has no CSS custom properties, so these are plain JS values.
 *
 * Do not hand-roll hex/rgba literals in screens — import from here.
 */

export const colors = {
  cream: "#F6F4F0",
  creamDeep: "#E8E0D7",

  blue: "#A8C4D8",
  blueDeep: "#7AAAC4",

  ink: "#1C1C1C",
  ink70: "rgba(28,28,28,0.72)",
  ink50: "rgba(28,28,28,0.5)",
  ink30: "rgba(28,28,28,0.3)",
  ink15: "rgba(28,28,28,0.15)",
  ink08: "rgba(28,28,28,0.08)",

  paper: "#FBF8F4",
  line: "#D9CFC4",
  line2: "#C6BBAE",

  ok: "#7FA98B",
  okBg: "rgba(127,169,139,0.16)",
  okLine: "rgba(127,169,139,0.36)",

  bad: "#C97A6D",
  badBg: "rgba(201,122,109,0.16)",
  badLine: "rgba(201,122,109,0.34)",

  warn: "#C8924E",

  surface: "#FFFFFF",
  surfaceSoft: "rgba(255,255,255,0.72)",
} as const;

export const radii = {
  card: 24,
  control: 14,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.06,
    shadowRadius: 36,
    elevation: 6,
  },
  cardSubtle: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.045,
    shadowRadius: 24,
    elevation: 3,
  },
} as const;

/**
 * Both display faces are ITALIC. Italic glyphs lean past their advance width,
 * but React Native measures a Text box from advance widths alone, so the ink
 * on the final glyph gets clipped at the right edge — worst on round terminals
 * (3, 6, 9) at large sizes. Negative `letterSpacing` makes it worse: RN applies
 * it after the last glyph too, shrinking the box further.
 *
 * Any large display text needs `italicOverhang(fontSize)` as paddingRight.
 * See GoalsStreakRow / progress/index for the pattern.
 */
export const fonts = {
  display: "Fraunces_600SemiBold_Italic",
  displayRegular: "Fraunces_400Regular_Italic",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
} as const;

/**
 * Right padding that keeps an italic display glyph from being clipped.
 * ~8% of the type size covers Fraunces' lean with a little slack; it is
 * padding, not margin, so it never shifts a centred layout off-centre.
 */
export function italicOverhang(fontSize: number): number {
  return Math.ceil(fontSize * 0.08);
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const theme = {
  colors,
  radii,
  shadows,
  fonts,
  spacing,
} as const;

export type Theme = typeof theme;
