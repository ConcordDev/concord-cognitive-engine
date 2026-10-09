/**
 * Quote of the day for the splash homepage.
 *
 * Curated for the themes the homepage speaks to: opportunity, community,
 * building, people and knowledge. Every entry is a sourced quotation with
 * a defensible attribution; the commonly misattributed "internet quotes"
 * (most Einstein / Gandhi / Lincoln / Twain lines) are deliberately absent.
 * The `source` field records where each one comes from so the next person
 * editing this list can check it rather than trust it. Where the popular
 * wording drifts from the documented one, the documented wording is used
 * (e.g. Mandela 2003, Anne Frank "Give!", Saint-Exupéry in Galantière's
 * translation).
 *
 * Selection is deterministic by UTC day number, so every visitor sees the
 * same quote on a given day and the server render can never disagree with
 * itself. The splash renders it in a Server Component, so there is nothing
 * for the client to recompute and no hydration mismatch.
 */

export interface DailyQuote {
  text: string;
  author: string;
  source: string;
}

export const DAILY_QUOTES: readonly DailyQuote[] = [
  {
    text: 'Talent is equally distributed; opportunity is not.',
    author: 'Leila Janah',
    source: 'Founder of Samasource (Sama); her recurring framing of its mission',
  },
  {
    text: 'Alone we can do so little; together we can do so much.',
    author: 'Helen Keller',
    source: 'Vaudeville-circuit speech, early 1920s (Lash, "Helen and Teacher", 1980)',
  },
  {
    text: 'If I have seen further it is by standing on the shoulders of giants.',
    author: 'Isaac Newton',
    source: 'Letter to Robert Hooke, 5 February 1675/76',
  },
  {
    text: 'There is no power for change greater than a community discovering what it cares about.',
    author: 'Margaret J. Wheatley',
    source: '"Turning to One Another", 2002',
  },
  {
    text: 'He who receives an idea from me, receives instruction himself without lessening mine; as he who lights his taper at mine, receives light without darkening me.',
    author: 'Thomas Jefferson',
    source: 'Letter to Isaac McPherson, 13 August 1813',
  },
  {
    text: 'The best way to predict the future is to invent it.',
    author: 'Alan Kay',
    source: 'Xerox PARC, 1971',
  },
  {
    text: 'We are caught in an inescapable network of mutuality, tied in a single garment of destiny.',
    author: 'Martin Luther King Jr.',
    source: '"Letter from Birmingham Jail", 16 April 1963',
  },
  {
    text: 'We can only see a short distance ahead, but we can see plenty there that needs to be done.',
    author: 'Alan Turing',
    source: '"Computing Machinery and Intelligence", Mind, 1950',
  },
  {
    text: 'The good we secure for ourselves is precarious and uncertain, is floating in mid-air, until it is secured for all of us and incorporated into our common life.',
    author: 'Jane Addams',
    source: '"The Subjective Necessity for Social Settlements", 1892 (pub. 1893)',
  },
  {
    text: 'Talk is cheap. Show me the code.',
    author: 'Linus Torvalds',
    source: 'Linux kernel mailing list, 25 August 2000',
  },
  {
    text: 'Where, after all, do universal human rights begin? In small places, close to home.',
    author: 'Eleanor Roosevelt',
    source: '"In Your Hands", United Nations, 27 March 1958',
  },
  {
    text: 'Knowledge will forever govern ignorance; and a people who mean to be their own governors must arm themselves with the power which knowledge gives.',
    author: 'James Madison',
    source: 'Letter to W. T. Barry, 4 August 1822',
  },
  {
    text: 'I am, because we are; and since we are, therefore I am.',
    author: 'John S. Mbiti',
    source: '"African Religions and Philosophy", 1969',
  },
  {
    text: 'Far and away the best prize that life offers is the chance to work hard at work worth doing.',
    author: 'Theodore Roosevelt',
    source: 'Labor Day address, Syracuse, 7 September 1903',
  },
  {
    text: 'The future is already here — it’s just not very evenly distributed.',
    author: 'William Gibson',
    source: 'NPR "Talk of the Nation", 30 November 1999',
  },
  {
    text: 'How wonderful it is that no one has to wait, but can start right now to gradually change the world.',
    author: 'Anne Frank',
    source: '"Give!", 26 March 1944 (Anne Frank House translation)',
  },
  {
    text: 'The good life is one inspired by love and guided by knowledge.',
    author: 'Bertrand Russell',
    source: '"What I Believe", 1925',
  },
  {
    text: 'Given enough eyeballs, all bugs are shallow.',
    author: 'Eric S. Raymond',
    source: '"The Cathedral and the Bazaar", 1997/1999',
  },
  {
    text: 'No man is an island, entire of itself; every man is a piece of the continent, a part of the main.',
    author: 'John Donne',
    source: '"Devotions upon Emergent Occasions", Meditation XVII, 1624',
  },
  {
    text: 'Education is the most powerful weapon we can use to change the world.',
    author: 'Nelson Mandela',
    source: 'Launch of Mindset Network, Johannesburg, 16 July 2003',
  },
  {
    text: 'Perfection is finally attained not when there is no longer anything to add, but when there is no longer anything to take away.',
    author: 'Antoine de Saint-Exupéry',
    source: '"Wind, Sand and Stars", 1939 (tr. Lewis Galantière)',
  },
  {
    text: 'Not everything that is faced can be changed, but nothing can be changed until it is faced.',
    author: 'James Baldwin',
    source: '"As Much Truth As One Can Bear", New York Times Book Review, 14 January 1962',
  },
  {
    text: 'Unless someone like you cares a whole awful lot, nothing is going to get better. It’s not.',
    author: 'Dr. Seuss',
    source: '"The Lorax", 1971',
  },
  {
    text: 'The test of our progress is not whether we add more to the abundance of those who have much; it is whether we provide enough for those who have too little.',
    author: 'Franklin D. Roosevelt',
    source: 'Second inaugural address, 20 January 1937',
  },
  {
    text: 'Where there is no vision, the people perish.',
    author: 'Proverbs 29:18',
    source: 'King James Version',
  },
  {
    text: 'We are here to help each other get through this thing, whatever it is.',
    author: 'Mark Vonnegut',
    source: 'Quoted by Kurt Vonnegut, "Cold Turkey", In These Times, 2004',
  },
  {
    text: 'If there is no struggle, there is no progress.',
    author: 'Frederick Douglass',
    source: 'West India Emancipation speech, Canandaigua, 3 August 1857',
  },
  {
    text: 'When we try to pick out anything by itself, we find it hitched to everything else in the universe.',
    author: 'John Muir',
    source: '"My First Summer in the Sierra", 1911',
  },
  {
    text: 'The most valuable of all capital is that invested in human beings.',
    author: 'Alfred Marshall',
    source: '"Principles of Economics", 1890',
  },
  {
    text: 'Real artists ship.',
    author: 'Steve Jobs',
    source: 'Macintosh team, January 1984 (Andy Hertzfeld, folklore.org)',
  },
  {
    text: 'Only connect!',
    author: 'E. M. Forster',
    source: '"Howards End", 1910',
  },
  {
    text: 'Ask not what your country can do for you — ask what you can do for your country.',
    author: 'John F. Kennedy',
    source: 'Inaugural address, 20 January 1961',
  },
];

const MS_PER_DAY = 86_400_000;

/** Days since the Unix epoch, in UTC. Same value for every visitor all day. */
export function utcDayNumber(date: Date = new Date()): number {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

/** The quote for the UTC day containing `date`. */
export function quoteForDate(date: Date = new Date()): DailyQuote {
  const n = DAILY_QUOTES.length;
  const idx = ((utcDayNumber(date) % n) + n) % n;
  return DAILY_QUOTES[idx];
}
