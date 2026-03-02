import githubCSS from './github.css?raw';
import hackernewsCSS from './hackernews.css?raw';
import redditCSS from './reddit.css?raw';

const overrides: Record<string, string> = {
  'github.com': githubCSS,
  'www.reddit.com': redditCSS,
  'news.ycombinator.com': hackernewsCSS,
};

export function hasOverride(domain: string): boolean {
  return domain in overrides;
}

export function getOverrideCSS(domain: string): string | null {
  return overrides[domain] ?? null;
}
