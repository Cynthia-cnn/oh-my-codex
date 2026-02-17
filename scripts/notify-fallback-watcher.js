#!/usr/bin/env node

import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);

const once = argv.includes('--once');
const cwd = getArg('--cwd', process.cwd());
const notifyScript = getArg('--notify-script');
const pollMs = Number(getArg('--poll-ms', '100'));

function getArg(name, def) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}

const today = new Date().toISOString().split('T')[0];
const turnLog = join(cwd, '.omx', 'logs', `turns-${today}.jsonl`);

async function appendTurn(threadId, turnId, file) {
  await mkdir(dirname(turnLog), { recursive: true });
  await writeFile(
    turnLog,
    JSON.stringify({ thread_id: threadId, turn_id: turnId, file }) + '\n',
    { flag: 'a' }
  );
}

function sessionDir(home) {
  const d = new Date();
  return join(
    home,
    '.codex',
    'sessions',
    String(d.getUTCFullYear()),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0')
  );
}

async function findRollout(dir) {
  try {
    const files = await readdir(dir);
    const f = files.find(x => x.endsWith('.jsonl'));
    return f ? join(dir, f) : null;
  } catch {
    return null;
  }
}

async function parseLines(file) {
  const txt = await readFile(file, 'utf-8').catch(() => '');
  return txt.split('\n').filter(Boolean);
}

function isTaskComplete(j) {
  return j?.type === 'event_msg' && j?.payload?.type === 'task_complete';
}

async function runOnce(file) {
  const start = Date.now();
  const lines = await parseLines(file);

  let threadId;

  for (const line of lines) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }

    if (j.type === 'session_meta') {
      threadId = j.payload?.id;
      continue;
    }

    if (!isTaskComplete(j)) continue;

    const ts = new Date(j.timestamp).getTime();
    if (ts < start) continue;

    const turnId = j.payload?.turn_id;
    if (!threadId || !turnId) continue;

    if (notifyScript) {
      spawnSync(process.execPath, [notifyScript, '{}'], { cwd });
    }

    await appendTurn(threadId, turnId, file);
  }
}

async function extractThreadId(file) {
  const lines = await parseLines(file);
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      if (j.type === 'session_meta') return j.payload?.id;
    } catch {}
  }
  return undefined;
}

async function runStream(file) {
  const threadId = await extractThreadId(file);
  if (!threadId) return;

  let offset = 0;
  try {
    const s = await stat(file);
    offset = s.size;
  } catch {}

  const timer = setInterval(async () => {
    let s;
    try { s = await stat(file); } catch { return; }

    if (s.size <= offset) return;

    const rs = createReadStream(file, {
      start: offset,
      end: s.size,
      encoding: 'utf-8'
    });

    let buf = '';
    for await (const chunk of rs) buf += chunk;

    offset = s.size;

    const lines = buf.split('\n').filter(Boolean);

    for (const line of lines) {
      let j;
      try { j = JSON.parse(line); } catch { continue; }

      if (!isTaskComplete(j)) continue;

      const turnId = j.payload?.turn_id;
      if (!turnId) continue;

      if (notifyScript) {
        spawnSync(process.execPath, [notifyScript, '{}'], { cwd });
      }

      await appendTurn(threadId, turnId, file);
    }
  }, pollMs);

  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

async function main() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const dir = sessionDir(home);
  const file = await findRollout(dir);
  if (!file) return;

  if (once) {
    await runOnce(file);
  } else {
    await runStream(file);
  }
}

main().catch(() => process.exit(1));    if (ts < start) continue;

    const turnId = j.payload?.turn_id;
    if (!threadId || !turnId) continue;

    const payload = {
      'thread-id': threadId,
      'turn-id': turnId,
      'input-messages': ['[notify-fallback] synthesized from rollout task_complete'],
      'last-assistant-message': j.payload?.last_agent_message || '',
      source: 'notify-fallback-watcher'
    };

    await invokeNotify(payload);
    await logTurn(threadId, turnId, file);
  }
}

async function runStream(file) {
  const threadId = await extractThreadId(file);
  if (!threadId) return;

  let offset = 0;
  try {
    const s = await stat(file);
    offset = s.size;
  } catch {
    offset = 0;
  }

  const timer = setInterval(async () => {
    let s;
    try {
      s = await stat(file);
    } catch {
      return;
    }

    if (s.size <= offset) return;

    const rs = createReadStream(file, {
      start: offset,
      end: s.size,
      encoding: 'utf-8'
    });

    let buf = '';
    for await (const chunk of rs) {
      buf += chunk;
    }

    offset = s.size;

    const lines = buf.split('\n').filter(Boolean);

    for (const line of lines) {
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }

      if (!isTaskComplete(j)) continue;

      const turnId = j.payload?.turn_id;
      if (!turnId) continue;

      const payload = {
        'thread-id': threadId,
        'turn-id': turnId,
        'input-messages': ['[notify-fallback] synthesized from rollout task_complete'],
        'last-assistant-message': j.payload?.last_agent_message || '',
        source: 'notify-fallback-watcher'
      };

      await invokeNotify(payload);
      await logTurn(threadId, turnId, file);
    }
  }, pollMs);

  process.on('SIGTERM', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

async function main() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const dir = sessionDir(home);
  const file = await findRolloutFile(dir);
  if (!file) return;

  if (once) {
    await runOnce(file);
  } else {
    await runStream(file);
  }
}

main().catch(() => process.exit(1));

    if (parsed.type !== 'event_msg') continue;
    if (parsed.payload?.type !== 'task_complete') continue;

    const ts = new Date(parsed.timestamp).getTime();
    if (ts < startTime) continue;

    const turnId = parsed.payload?.turn_id;
    const lastMessage = parsed.payload?.last_agent_message;

    if (!threadId || !turnId) continue;

    const payload = buildPayload(threadId, turnId, lastMessage);
    await invokeNotifyHook(payload, filePath);
  }
}

async function streamFile(filePath) {
  const threadId = await extractThreadId(filePath);
  if (!threadId) return;

  let offset = 0;
  try {
    const s = await stat(filePath);
    offset = s.size;
  } catch {
    offset = 0;
  }

  const interval = setInterval(async () => {
    let s;
    try {
      s = await stat(filePath);
    } catch {
      return;
    }

    if (s.size <= offset) return;

    const stream = createReadStream(filePath, {
      start: offset,
      end: s.size,
      encoding: 'utf-8',
    });

    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk;
    }

    offset = s.size;

    const lines = buffer.split('\n').filter(Boolean);

    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed.type !== 'event_msg') continue;
      if (parsed.payload?.type !== 'task_complete') continue;

      const turnId = parsed.payload?.turn_id;
      const lastMessage = parsed.payload?.last_agent_message;
      if (!turnId) continue;

      const payload = buildPayload(threadId, turnId, lastMessage);
      await invokeNotifyHook(payload, filePath);
    }
  }, pollMs);

  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

async function main() {
  const baseHome = process.env.HOME || process.env.USERPROFILE;
  const sessionDir = todaySessionDir(baseHome);
  const filePath = await getRolloutFile(sessionDir);
  if (!filePath) return;

  if (once) {
    await processFileOnce(filePath);
  } else {
    await streamFile(filePath);
  }
}

main().catch(async () => {
  process.exit(1);
});    const s = await stat(filePath);
    offset = s.size;
  } catch {
    offset = 0;
  }

  const interval = setInterval(async () => {
    let s;
    try {
      s = await stat(filePath);
    } catch {
      return;
    }

    if (s.size <= offset) return;

    const stream = createReadStream(filePath, {
      start: offset,
      end: s.size,
      encoding: 'utf-8',
    });

    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk;
    }

    offset = s.size;

    const lines = buffer.split('\n').filter(Boolean);

    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed.type === 'session_meta') {
        threadId = parsed.payload?.id;
        continue;
      }

      if (parsed.type !== 'event_msg') continue;
      if (parsed.payload?.type !== 'task_complete') continue;

      const turnId = parsed.payload?.turn_id;
      const lastMessage = parsed.payload?.last_agent_message;

      if (!threadId || !turnId) continue;

      const payload = buildPayload(threadId, turnId, lastMessage);
      await invokeNotifyHook(payload, filePath);
    }
  }, pollMs);

  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

async function main() {
  const baseHome = process.env.HOME || process.env.USERPROFILE;
  const sessionDir = todaySessionDir(baseHome);

  const files = await readFileDir(sessionDir);
  if (!files.length) return;

  const filePath = join(sessionDir, files[0]);

  if (once) {
    await processFileOnce(filePath);
  } else {
    await streamFile(filePath);
  }
}

async function readFileDir(dir) {
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    return files.filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
}

main().catch(async (err) => {
  await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
  await eventLog({
    type: 'watcher_error',
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
