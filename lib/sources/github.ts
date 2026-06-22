// GitHub source: repo metadata + releases. Uses built-in fetch. A GITHUB_TOKEN
// (optional) raises the API rate limit from 60/h to 5000/h.

export interface GithubRepoMeta {
  owner: string;
  repo: string;
  name: string;
  description: string | null;
  homepage: string | null;
  htmlUrl: string;
  developer: string;
  avatarUrl: string | null;
  stars: number;
}

export interface GithubAsset {
  name: string;
  url: string;
  size: number;
}

export interface GithubRelease {
  tag: string;
  body: string | null;
  publishedAt: string | null;
  assets: GithubAsset[];
}

export function parseRepo(input: string): { owner: string; repo: string } {
  const s = input.trim();
  // Accept "owner/repo" or any github URL.
  const url = s.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (url) return { owner: url[1], repo: url[2].replace(/\.git$/, "") };
  const slug = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (slug) return { owner: slug[1], repo: slug[2].replace(/\.git$/, "") };
  throw new Error("Enter a GitHub repo as owner/repo or a github.com URL");
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "elite-v2-appstore",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghGet(url: string): Promise<Response> {
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) throw new Error("GitHub repo or release not found");
  if (res.status === 403) throw new Error("GitHub rate limit hit (set GITHUB_TOKEN)");
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res;
}

export async function fetchRepoMeta(
  owner: string,
  repo: string
): Promise<GithubRepoMeta> {
  const res = await ghGet(`https://api.github.com/repos/${owner}/${repo}`);
  const j = (await res.json()) as Record<string, unknown>;
  return {
    owner,
    repo,
    name: (j.name as string) || repo,
    description: (j.description as string) || null,
    homepage: (j.homepage as string) || null,
    htmlUrl: (j.html_url as string) || `https://github.com/${owner}/${repo}`,
    developer: ((j.owner as { login?: string })?.login as string) || owner,
    avatarUrl: ((j.owner as { avatar_url?: string })?.avatar_url as string) || null,
    stars: (j.stargazers_count as number) || 0,
  };
}

export async function fetchLatestRelease(
  owner: string,
  repo: string
): Promise<GithubRelease | null> {
  let res: Response;
  try {
    res = await ghGet(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
  } catch {
    return null;
  }
  const j = (await res.json()) as Record<string, unknown>;
  const assets = ((j.assets as Record<string, unknown>[]) || []).map((a) => ({
    name: a.name as string,
    url: a.browser_download_url as string,
    size: (a.size as number) || 0,
  }));
  return {
    tag: (j.tag_name as string) || "",
    body: (j.body as string) || null,
    publishedAt: (j.published_at as string) || null,
    assets,
  };
}

// Choose the APK asset: prefer arm64/universal, else the first .apk.
export function pickApkAsset(release: GithubRelease): GithubAsset | null {
  const apks = release.assets.filter((a) => /\.apk$/i.test(a.name));
  if (apks.length === 0) return null;
  const arm64 = apks.find((a) => /arm64|aarch64|universal/i.test(a.name));
  return arm64 || apks[0];
}
