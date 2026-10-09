import type { MetadataRoute } from 'next';

const LENS_SLUGS = [
  'accounting', 'admin', 'affect', 'agents', 'agriculture', 'all', 'alliance',
  'analytics', 'animation', 'anon', 'app-maker', 'ar', 'art', 'artistry',
  'astronomy', 'atlas', 'attention', 'audit', 'automotive', 'aviation',
  'billing', 'bio', 'board', 'bridge', 'calendar', 'carpentry', 'chat',
  'chem', 'code', 'collab', 'command-center', 'commonsense', 'construction',
  'consulting', 'cooking', 'council', 'creative', 'creative-writing', 'cri',
  'crypto', 'custom', 'daily', 'database', 'debate', 'debug', 'defense',
  'desert', 'diy', 'docs', 'dtus', 'eco', 'education', 'electrical',
  'emergency-services', 'energy', 'engineering', 'entity', 'environment',
  'ethics', 'events', 'experience', 'export', 'fashion', 'feed',
  'film-studios', 'finance', 'fitness', 'food', 'forestry', 'fork', 'forum',
  'fractal', 'game', 'game-design', 'geology', 'global', 'goals',
  'government', 'graph', 'grounding', 'healthcare', 'history',
  'home-improvement', 'household', 'hr', 'hvac', 'hypothesis', 'import',
  'inference', 'ingest', 'insurance', 'integrations', 'invariant', 'lab',
  'landscaping', 'law', 'law-enforcement', 'legacy', 'legal', 'linguistics',
  'lock', 'logistics', 'manufacturing', 'market', 'marketing', 'marketplace',
  'masonry', 'materials', 'math', 'mental-health', 'mentorship', 'meta',
  'metacognition', 'metalearning', 'mining', 'ml', 'music', 'neuro', 'news',
  'nonprofit', 'ocean', 'offline', 'organ', 'paper', 'parenting', 'pets',
  'pharmacy', 'philosophy', 'photography', 'physics', 'platform', 'plumbing',
  'podcast', 'poetry', 'projects', 'quantum', 'questmarket', 'queue',
  'realestate', 'reasoning', 'reflection', 'repos', 'research', 'resonance',
  'retail', 'robotics', 'schema', 'science', 'security', 'services', 'sim',
  'space', 'sports', 'srs', 'studio', 'suffering', 'supplychain',
  'telecommunications', 'temporal', 'thread', 'tick', 'timeline', 'trades',
  'transfer', 'travel', 'urban-planning', 'veterinary', 'voice', 'vote',
  'wallet', 'welding', 'whiteboard', 'world',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://concord-os.org';

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/register`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/login`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/legal/terms`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/legal/privacy`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/legal/dmca`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
  ];

  const lensPages: MetadataRoute.Sitemap = LENS_SLUGS.map((slug) => ({
    url: `${baseUrl}/lenses/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...lensPages];
}
