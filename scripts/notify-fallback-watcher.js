#!/usr/bin/env node

import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

function getArg(name, def) {
  const i = args.indexOf(name);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return def;
}

function hasFlag(name) {
  return args.includes(name);
}

const once = hasFlag('--once');
const cwd = getArg('--cwd', process.cwd());
const notifyScript = getArg('--notify-script');
const pollMs = Number(getArg('--poll-ms', '100'));

const today = new Date().toISOString().split('T')[0];
const logPath = join(cwd, '.omx', 'logs', `turns-${today}.jsonl`);

async function eventLog(obj) {
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify(obj) + '\n', { flag: 'a' });
}

function todaySessionDir(baseHome) {
  const now = new Date();
  return join(
    baseHome,
    '.codex',
    'sessions',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0')
  );
}

function buildPayload(threadId, turnId, lastMessage) {
  return {
    'thread-id': threadId,
    'turn-id': turnId,
    'input-messages': ['[notify-fallback] synthesized from rollout task_complete'],
    'last-assistant-message': lastMessage || '',
    source: 'notify-fallback-watcher',
  };
}

async function invokeNotifyHook(payload, filePath) {
  spawnSync(process.execPath, [notifyScript, JSON.stringify(payload)], {
    cwd,
    encoding: 'utf-8',
  });
  await eventLog({
    thread_id: payload['thread-id'],
    turn_id: payload['turn-id'],
    file: filePath,
  });
}

async function getRolloutFile(sessionDir) {
  try {
    const files = await readdir(sessionDir);
    const jsonl = files.filter(f => f.endsWith('.jsonl'));
    if (!jsonl.length) return null;
    return join(sessionDir, jsonl[0]);
  } catch {
    return null;
  }
}

async function extractThreadId(filePath) {
  const content = await readFile(filePath, 'utf-8').catch(() => '');
  const lines = content.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'session_meta') {
        return parsed.payload?.id;
      }
    } catch {}
  }
  return undefined;
}

async function processFileOnce(filePath) {
  const startTime = Date.now();
  const content = await readFile(filePath, 'utf-8').catch(() => '');
  const lines = content.split('\n').filter(Boolean);

  let threadId;

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
