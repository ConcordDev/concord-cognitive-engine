import Image from 'next/image';
import Link from 'next/link';
import type { DailyQuote } from '@/lib/splash/daily-quotes';
import { splashQuoteFont, splashWordmarkFont } from './fonts';
import styles from './SplashHome.module.css';

/**
 * Where "Enter" goes: the public "look around first" showcase that the
 * previous marketing homepage used as its no-account entry CTA. It is in
 * middleware PUBLIC_PATHS, so a logged-out visitor lands there directly.
 */
export const SPLASH_ENTER_HREF = '/explore';

interface SplashHomeProps {
  quote: DailyQuote;
}

/**
 * Minimal splash homepage for logged-out visitors: the crystal-orb logo as
 * a backdrop, the CONC◉RD wordmark, the quote of the day and the tagline.
 *
 * Server Component on purpose: the quote is chosen by the caller on the
 * server, so the markup is final HTML with nothing for the client to
 * recompute (no hydration mismatch, no flash on load).
 */
export function SplashHome({ quote }: SplashHomeProps) {
  return (
    <div className={styles.root}>
      <div className={styles.stars} aria-hidden="true" />
      <div className={styles.glow} aria-hidden="true" />
      <Image
        src="/brand/orb.png"
        alt=""
        aria-hidden="true"
        width={550}
        height={510}
        priority
        sizes="(max-width: 700px) 440px, 62.5vw"
        className={styles.orb}
      />

      <nav className={styles.nav} aria-label="Site">
        <span className={styles.domain}>concord-os.org</span>
        <Link href={SPLASH_ENTER_HREF} className={styles.enter}>
          Enter <span aria-hidden="true">→</span>
        </Link>
      </nav>

      <div className={styles.center}>
        <h1 className={`${splashWordmarkFont.className} ${styles.wordmark}`} aria-label="Concord">
          <span className={styles.chrome} aria-hidden="true">
            CONC
          </span>
          <Image
            src="/brand/orb-o.png"
            alt=""
            aria-hidden="true"
            width={106}
            height={102}
            priority
            className={styles.orbO}
          />
          <span className={`${styles.chrome} ${styles.chromeLast}`} aria-hidden="true">
            RD
          </span>
        </h1>

        <figure className={styles.quoteBlock}>
          <blockquote className={`${splashQuoteFont.className} ${styles.quote}`}>
            <p>“{quote.text}”</p>
          </blockquote>
          <figcaption className={styles.author}>{quote.author}</figcaption>
        </figure>
      </div>

      <p className={styles.tagline}>
        A system <span className={styles.for}>for</span> the people
      </p>
    </div>
  );
}
