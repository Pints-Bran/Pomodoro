export interface Quote {
  text: string;
  author: string;
}

// Only quotes with a source someone can check: most "motivation quotes" in
// circulation are misattributed. Add to these lists, never paraphrase them.
export const FOCUS_QUOTES = [
  // The Writing Life (1989)
  {
    text: "How we spend our days is, of course, how we spend our lives.",
    author: "Annie Dillard",
  },
  // Letter to Joë Bousquet, 13 April 1942
  {
    text: "Attention is the rarest and purest form of generosity.",
    author: "Simone Weil",
  },
  // Upstream: Selected Essays (2016)
  { text: "Attention is the beginning of devotion.", author: "Mary Oliver" },
  // Letter to H. G. O. Blake, 16 November 1857
  {
    text: "It is not enough to be industrious; so are the ants. What are you industrious about?",
    author: "Henry David Thoreau",
  },
  // Walden (1854), "Where I Lived, and What I Lived For"
  {
    text: "Our life is frittered away by detail. Simplify, simplify.",
    author: "Henry David Thoreau",
  },
  // Moral Letters to Lucilius 1, trans. Gummere
  {
    text: "Lay hold of today's task, and you will not need to depend so much upon tomorrow's.",
    author: "Seneca",
  },
  // On the Shortness of Life 1, trans. Basore
  {
    text: "It is not that we have a short space of time, but that we waste much of it.",
    author: "Seneca",
  },
  // Meditations 4.24, trans. Hays
  {
    text: "If you seek tranquility, do less. Or (more accurately) do what's essential.",
    author: "Marcus Aurelius",
  },
  // Discourses 1.15
  { text: "No great thing is created suddenly.", author: "Epictetus" },
  // Epistles 1.2
  {
    text: "He who has begun has half done. Dare to be wise; begin!",
    author: "Horace",
  },
  // Tao Te Ching 64
  {
    text: "A journey of a thousand miles begins with a single step.",
    author: "Laozi",
  },
  // The Principles of Psychology (1890), ch. XI
  {
    text: "My experience is what I agree to attend to.",
    author: "William James",
  },
  // Quoted in Samuel Smiles, Self-Help (1859)
  {
    text: "The shortest way to do many things is to do only one thing at once.",
    author: "Richard Cecil",
  },
  // Poor Richard's Almanack (1748)
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  // Interview, quoted widely since 2002
  {
    text: "Inspiration is for amateurs — the rest of us just show up and get to work.",
    author: "Chuck Close",
  },
] as const satisfies readonly Quote[];

export const REST_QUOTES = [
  // The Use of Life (1894)
  {
    text: "Rest is not idleness, and to lie sometimes on the grass under trees on a summer's day, listening to the murmur of the water, or watching the clouds float across the sky, is by no means a waste of time.",
    author: "John Lubbock",
  },
  // Ars Amatoria II
  {
    text: "Take rest; a field that has rested gives a bountiful crop.",
    author: "Ovid",
  },
  // "12 truths I learned from life and writing", TED (2017)
  {
    text: "Almost everything will work again if you unplug it for a few minutes, including you.",
    author: "Anne Lamott",
  },
  // An Interrupted Life, diaries 1941–1943
  {
    text: "Sometimes the most important thing in a whole day is the rest we take between two deep breaths.",
    author: "Etty Hillesum",
  },
  // Peace Is Every Step (1991)
  {
    text: "Walk as if you are kissing the Earth with your feet.",
    author: "Thich Nhat Hanh",
  },
  // Stepping into Freedom (1997)
  {
    text: "Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.",
    author: "Thich Nhat Hanh",
  },
  // Meditations 4.3, trans. Hays
  {
    text: "Nowhere you can go is more peaceful — more free of interruptions — than your own soul.",
    author: "Marcus Aurelius",
  },
  // Letter to Henriette Lund, 1847
  {
    text: "Every day I walk myself into a state of well-being and walk away from every illness.",
    author: "Søren Kierkegaard",
  },
  // Pensées 139, trans. Trotter
  {
    text: "All the unhappiness of men arises from one single fact, that they cannot stay quietly in their own chamber.",
    author: "Blaise Pascal",
  },
  // On Tranquillity of Mind 17
  {
    text: "Minds should be given relaxation; they will rise up better and keener after resting.",
    author: "Seneca",
  },
  // Siddhartha (1922), trans. Rosner
  {
    text: "Within you there is a stillness and a sanctuary to which you can retreat at any time and be yourself.",
    author: "Hermann Hesse",
  },
  // Tao Te Ching 15, trans. Mitchell
  {
    text: "Do you have the patience to wait till your mud settles and the water is clear?",
    author: "Laozi",
  },
  // Song of Myself (1855)
  { text: "I loafe and invite my soul.", author: "Walt Whitman" },
  // Wouldn't Take Nothing for My Journey Now (1993)
  {
    text: "Every person needs to take one day away.",
    author: "Maya Angelou",
  },
] as const satisfies readonly Quote[];

/** Any quote from the list but the one just shown, so no two in a row repeat. */
export function pickQuote(list: readonly Quote[], previous?: Quote): Quote {
  const pool = list.filter((quote) => quote !== previous);
  const options = pool.length > 0 ? pool : list;
  return (
    options[Math.floor(Math.random() * options.length)] ??
    list[0] ?? { text: "", author: "" }
  );
}
