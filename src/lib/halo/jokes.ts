// ════════════════════════════════════════════════════════════════════════
//  HALO JOKE BANK · curated, trader-friendly humour for voice engagement
//
//  Deterministic and fully offline — no external feed, nothing invented
//  about the market or the account. Jokes are clearly entertainment, never
//  mixed into data answers. Rotation avoids repeating the last joke so
//  "another one" always lands fresh.
// ════════════════════════════════════════════════════════════════════════

export type JokeStyle = "trading" | "tech" | "motivation";

export interface Joke {
  style: JokeStyle;
  text: string; // ≤ 30 words — TTS friendly
}

export const JOKES: Joke[] = [
  // ── trading ──
  { style: "trading", text: "A trader's wife says, 'Go to the store and buy a loaf of bread. If they have eggs, buy a dozen.' He came back with twelve loaves of bread." },
  { style: "trading", text: "Why did the technical analyst break up with the fundamental analyst? Too many mixed signals." },
  { style: "trading", text: "My risk manager told me to cut my losses. So I fired him. Best trade I never closed." },
  { style: "trading", text: "The market closed green today. My account, however, prefers to stay contrary — it's a contrarian indicator." },
  { style: "trading", text: "How do you make a small fortune in trading? Start with a large fortune and average down." },
  { style: "trading", text: "A bull and a bear walk into a bar. The bartender says, 'What'll it be?' They both say, 'Whatever the third candle says.'" },
  { style: "trading", text: "I told my stop-loss a joke. It still left me at the worst possible moment." },
  { style: "trading", text: "Gold walked into a support zone and bounced. Even the metal knows a good floor when it tests one." },
  // ── tech / robot ──
  { style: "tech", text: "Why did the robot go back to school? Its skills were getting a bit rusty." },
  { style: "tech", text: "There are two hard things in computing: cache invalidation, naming things, and off-by-one errors." },
  { style: "tech", text: "A programmer's spouse says, 'Buy milk on the way home.' The programmer returns with twelve crates — just in case the shop ran out again." },
  { style: "tech", text: "I would tell you a UDP joke, but you might not get it." },
  { style: "tech", text: "Why do programmers prefer dark mode? Because light attracts bugs." },
  // ── motivation ──
  { style: "motivation", text: "Flat is a position too. Sometimes the smartest trade of the day is the one you never placed — patience is edge." },
  { style: "motivation", text: "Every professional was once a beginner who refused to quit. Your job today is simply to stay disciplined one more session." },
  { style: "motivation", text: "The market rewards process over prediction. Trust the levels, respect the stop, and let the edge do the heavy lifting." },
  { style: "motivation", text: "A losing trade with a respected stop is tuition, not failure. The winners pay for the class." },
];

/** Pick a joke, avoiding an immediate repeat when the caller remembers the last one. */
export function pickJoke(style: JokeStyle | undefined, avoid?: string): Joke {
  const pool = style ? JOKES.filter((j) => j.style === style) : JOKES;
  const source = pool.length > 0 ? pool : JOKES;
  const fresh = source.filter((j) => j.text !== avoid);
  const list = fresh.length > 0 ? fresh : source;
  return list[Math.floor(Math.random() * list.length)];
}
