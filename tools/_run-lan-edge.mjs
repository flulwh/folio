/**
 * 一条命令跑完局域网接口边界自查：起夹具（脏数据 + 大书 + 漫画全开）→ 跑 `_qa-lan-edge.mjs` → 收摊。
 *
 * 存在的理由：`_qa-lan-edge.mjs` 有三套断言各自依赖夹具的不同开关 ——
 * 「清单脏数据」要 `--dirty`、「上限」要 `--big`、「漫画」要 `--comic`。
 * 而夹具默认一个都不带（带了会污染 `_lan-sync-check.mjs` 的 117 项书目断言）。
 * 以前得手工起夹具、手工注入脏数据才能跑全绿 ——
 * 这种「记得手动做一步」的验证等于没有验证，CI 里只会看到一片红。
 *
 * 用法：npm run check:lan-edge
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-edge-'));
let fixture = null;
let child = null;
let stderrTail = '';

/** 夹具在 stdout 打一行 JSON 才算起好了；失败信息走 stderr。 */
function startFixture() {
  fixture = spawn(
    process.execPath,
    [path.join(here, '_lan-fixture.mjs'), dataDir, '0', '--dirty', '--big', '--comic'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error(`夹具 20s 内没起来\n${stderrTail}`)), 20_000);

    fixture.stdout.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((item) => item.trim().startsWith('{'));
      if (!line) return;
      try {
        const info = JSON.parse(line);
        if (!info?.ok) return;
        clearTimeout(timer);
        resolve(info);
      } catch {
        /* 还没收全，等下一块 */
      }
    });
    fixture.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000);
    });
    fixture.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`夹具提前退出（code=${code}）\n${stderrTail}`));
    });
  });
}

function runEdge(info) {
  const base = `http://127.0.0.1:${info.port}`;
  process.stdout.write(`夹具已就绪：${base}（数据目录 ${dataDir}，--dirty --big --comic）\n\n`);

  child = spawn(process.execPath, [path.join(here, '_qa-lan-edge.mjs'), base, info.token], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

async function main() {
  const info = await startFixture();
  const code = await runEdge(info);
  return code;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  process.stderr.write(`\n[check:lan-edge] ${error.message}\n`);
  exitCode = 1;
} finally {
  try {
    child?.kill();
  } catch {
    /* ignore */
  }
  try {
    fixture?.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  // 夹具收到 SIGTERM 会走优雅退出；给它一点时间再删目录，删不掉也无所谓（在临时目录里）
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);
