#!/usr/bin/env node
/**
 * 用 GitHub 的 git data API 推送提交。
 *
 * 背景：本机到 github.com 的 git 协议通道被代理挡掉（CONNECT 502 / SSL EOF），
 * 但 api.github.com 走同一个代理是通的。GitHub 的 git data 接口
 * （blobs / trees / commits / refs）完全能表达一次推送，所以改走这条路。
 *
 * 一个坑：GitHub 会把 author/committer 的时区归一化成 +0000，
 * 而本地提交是 +0800，同一个提交算出来的 sha 就不同。所以这里先在本地
 * 用 UTC 时间重建一份提交（内容、树、消息完全一致，只是时区表示变了），
 * 让本地 sha 与 GitHub 算出来的 sha 一致，再更新本地引用 ——
 * 这样以后的 git push 仍然是快进，不会出现「本地与远端分叉」。
 *
 * 用法：node tools/_push-via-api.mjs [<commit> ...]
 *        不带参数则推送 origin/main..HEAD 的所有提交。
 */
import { execFileSync } from 'node:child_process';

const REPO = 'flulwh/folio';
const API = `https://api.github.com/repos/${REPO}`;

const gh = (...args) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const token = gh('auth', 'token').trim();

async function api(path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'folio-push-script',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const gitRaw = (...args) =>
  execFileSync('git', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });

/** 上传一个 blob，返回它的 sha（并校验内容一致） */
async function uploadBlob(sha) {
  const type = git('cat-file', '-t', sha);
  if (type !== 'blob') throw new Error(`${sha} 不是 blob`);
  const raw = gitRaw('cat-file', 'blob', sha);
  const out = await api('/git/blobs', 'POST', {
    content: Buffer.from(raw).toString('base64'),
    encoding: 'base64',
  });
  if (out.sha !== sha) {
    throw new Error(`blob sha 不一致：本地 ${sha} / 远端 ${out.sha}`);
  }
  return out.sha;
}

/** 收集一个提交相对父提交的所有文件变更 */
function changedFiles(commit) {
  const parent = git('rev-parse', `${commit}^`);
  const raw = git('diff-tree', '-r', '--name-status', '-M', parent, commit);
  const files = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0];
    if (status.startsWith('R')) {
      const [, oldPath, newPath] = parts;
      files.push({ path: oldPath, action: 'D' });
      files.push({ path: newPath, action: 'M' });
    } else if (status === 'D') {
      files.push({ path: parts[1], action: 'D' });
    } else {
      files.push({ path: parts[1], action: 'M' });
    }
  }
  return { parent, files };
}

/**
 * 把一个提交重建成「UTC 时区」版本，返回新的 sha。
 * 树、消息、作者时间戳（epoch 秒）都保持不变，只把时区表示归一成 +0000，
 * 这样 GitHub 算出来的 sha 与本地一致。
 */
function rebuildInUtc(commit, utcParentSha) {
  const raw = gitRaw('cat-file', 'commit', commit).toString('utf8');
  const split = raw.indexOf('\n\n');
  const header = raw.slice(0, split);
  const message = raw.slice(split + 2);

  const lines = header.split('\n');
  const out = [];
  let epoch = 0;
  for (const line of lines) {
    const m = line.match(/^(author|committer) (.*) (\d+) ([+-]\d{4})$/);
    if (m) {
      epoch = Number(m[3]);
      out.push(`${m[1]} ${m[2]} ${m[3]} +0000`);
    } else if (line.startsWith('parent ')) {
      out.push(`parent ${utcParentSha}`);
    } else {
      out.push(line);
    }
  }
  const body = `${out.join('\n')}\n\n${message}`;
  const bytes = Buffer.from(body, 'utf8');
  const sha = execFileSync(
    'git',
    ['hash-object', '-t', 'commit', '-w', '--stdin'],
    { input: bytes, encoding: 'utf8' }
  ).trim();
  return { sha, message, epoch };
}

/** epoch → GitHub 接受的 ISO 串（秒精度，Z 结尾） */
const isoOf = (epoch) =>
  new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function pushCommit(commit, utcParent) {
  const { parent, files } = changedFiles(commit);

  // 本地先重建出 UTC 版本，后面的 parent 链要用它的 sha
  const local = rebuildInUtc(commit, utcParent);
  const utcParentSha = utcParent;

  // 上传所有内容有变的 blob，并按 UTC 版本重建树
  const treeEntries = [];
  for (const file of files) {
    if (file.action === 'D') {
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blobSha = git('rev-parse', `${commit}:${file.path}`);
    const mode = git('ls-tree', `${commit}`, '--', file.path).split(/\s+/)[0] || '100644';
    await uploadBlob(blobSha);
    treeEntries.push({ path: file.path, mode, type: 'blob', sha: blobSha });
  }

  const baseTree = git('rev-parse', `${utcParentSha}^{tree}`);
  const tree = await api('/git/trees', 'POST', {
    base_tree: baseTree,
    tree: treeEntries,
  });
  const localTree = git('rev-parse', `${local.sha}^{tree}`);
  if (tree.sha !== localTree) {
    throw new Error(`tree sha 不一致：本地 ${localTree} / 远端 ${tree.sha}`);
  }

  const who = git('log', '-1', '--format=%an%n%ae', commit).split('\n');
  const created = await api('/git/commits', 'POST', {
    message: local.message,
    tree: tree.sha,
    parents: [utcParentSha],
    author: { name: who[0], email: who[1], date: isoOf(local.epoch) },
    committer: { name: who[0], email: who[1], date: isoOf(local.epoch) },
  });
  if (created.sha !== local.sha) {
    throw new Error(`commit sha 不一致：本地 ${local.sha} / 远端 ${created.sha}`);
  }
  console.log(`  ${commit.slice(0, 8)} → ${created.sha.slice(0, 8)}`);
  return created.sha;
}

async function main() {
  let commits = process.argv.slice(2);
  if (!commits.length) {
    commits = git('rev-list', '--reverse', 'origin/main..HEAD')
      .split('\n')
      .filter(Boolean);
  }
  if (!commits.length) {
    console.log('没有待推送的提交');
    // 仍可能需要打标签（例如只发版不推代码）
    const tag = process.env.FOLIO_TAG;
    if (tag) {
      const head = git('rev-parse', 'HEAD');
      await api('/git/refs', 'POST', { ref: `refs/tags/${tag}`, sha: head });
      console.log(`远端标签 ${tag} → ${head}`);
    }
    return;
  }
  console.log(`待推送 ${commits.length} 个提交：`);
  for (const c of commits) console.log(`  ${git('log', '-1', '--format=%h %s', c)}`);

  let head = null;
  // 第一个提交的父提交在远端已经存在，直接用远端的 sha
  let utcParent = git('rev-parse', `${commits[0]}^`);
  for (const c of commits) {
    console.log(`推送 ${git('log', '-1', '--format=%h %s', c)}`);
    head = await pushCommit(c, utcParent);
    utcParent = head;
  }

  // 更新远端 main
  const ref = await api('/git/refs/heads/main', 'PATCH', {
    sha: head,
    force: false,
  });
  console.log(`远端 main → ${ref.object.sha}`);

  // 同步本地引用，让本地与远端一致（否则以后 git push 会分叉）
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'HEAD') {
    git('update-ref', `refs/heads/${branch}`, head);
    git('update-ref', `refs/remotes/origin/${branch}`, head);
    console.log(`本地 ${branch} → ${head}`);
  }

  // 标签同样走 API：git 协议推不动，但 refs 接口可以
  const tag = process.env.FOLIO_TAG;
  if (tag) {
    await api(`/git/refs`, 'POST', {
      ref: `refs/tags/${tag}`,
      sha: head,
    });
    console.log(`远端标签 ${tag} → ${head}`);
  }
}

main().catch((err) => {
  console.error('推送失败：', err.message);
  process.exit(1);
});
