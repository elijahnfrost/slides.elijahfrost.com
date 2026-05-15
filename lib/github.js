/**
 * lib/github.js — atomic multi-file commit via the GitHub Git Data API.
 *
 * Uses git/refs + git/trees + git/commits so a single upload can write
 * the piece's index.html, its og-image.png, and the regenerated
 * catalog.json in one commit. Atomic per ref update.
 *
 * Requires GITHUB_PAT (fine-grained PAT, contents:write on the repo).
 */
import { Octokit } from '@octokit/rest';

const OWNER = process.env.GITHUB_OWNER || 'elijahnfrost';
const REPO = process.env.GITHUB_REPO || 'slides.elijahfrost.com';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

function client() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error('GITHUB_PAT env var is not set');
  return new Octokit({ auth: token });
}

/**
 * Read a single file from the repo. Returns { content: string, sha: string }
 * or null if the file doesn't exist.
 */
export async function getFile(path, ref = BRANCH) {
  const gh = client();
  try {
    const res = await gh.repos.getContent({ owner: OWNER, repo: REPO, path, ref });
    if (Array.isArray(res.data)) throw new Error(`${path} is a directory`);
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    return { content, sha: res.data.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * List the immediate subdirectories of the repo root that look like piece
 * directories (kebab-case slug). Used by build-catalog to enumerate decks.
 */
export async function listPieceSlugs(ref = BRANCH) {
  const gh = client();
  const res = await gh.repos.getContent({ owner: OWNER, repo: REPO, path: '', ref });
  if (!Array.isArray(res.data)) return [];
  return res.data
    .filter(e => e.type === 'dir' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.name) && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map(e => e.name);
}

/**
 * @typedef {{ path: string; content: string | Buffer; encoding?: 'utf-8' | 'base64' }} FileWrite
 */

/**
 * Commit multiple files atomically. Returns { commit_sha, ref }.
 *
 * @param {FileWrite[]} files
 * @param {string} message
 * @param {{ branch?: string }} [opts]
 */
export async function commitFiles(files, message, opts = {}) {
  const gh = client();
  const branch = opts.branch || BRANCH;

  // 1) Resolve current HEAD
  const ref = await gh.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${branch}` });
  const parentSha = ref.data.object.sha;

  // 2) Resolve the tree the HEAD points at
  const parentCommit = await gh.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: parentSha });
  const baseTreeSha = parentCommit.data.tree.sha;

  // 3) Create a blob for each file
  const treeEntries = [];
  for (const f of files) {
    const content = Buffer.isBuffer(f.content)
      ? f.content.toString('base64')
      : (f.encoding === 'base64' ? f.content : Buffer.from(f.content, 'utf8').toString('base64'));
    const blob = await gh.git.createBlob({
      owner: OWNER, repo: REPO,
      content,
      encoding: 'base64',
    });
    treeEntries.push({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: blob.data.sha,
    });
  }

  // 4) Create a new tree on top of the base tree
  const tree = await gh.git.createTree({
    owner: OWNER, repo: REPO,
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  // 5) Create a commit pointing at the new tree
  const commit = await gh.git.createCommit({
    owner: OWNER, repo: REPO,
    message,
    tree: tree.data.sha,
    parents: [parentSha],
  });

  // 6) Fast-forward the branch ref to the new commit
  await gh.git.updateRef({
    owner: OWNER, repo: REPO,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
    force: false,
  });

  return { commit_sha: commit.data.sha, branch };
}
