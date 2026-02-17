#!/usr/bin/env node

import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
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

function todaySessionDir(home) {
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

async function getRolloutFile(dir) {
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

function buildPayload(threadId, turnId, lastMessage) {
  return {
    'thread-id': threadId,
    'turn-id': turnId,
    'input-messages': ['[notify-fallback] synthesized from rollout task_complete'],
    'last-assistant-message': lastMessage || '',
    source: 'notify-fallback-watcher'
  };
}

async function invokeNotifyHook(payload, filePath) {
  if (!notifyScript) return;

  spawnSync(process.execPath, [notifyScript, JSON.stringify(payload)], {
    cwd,
    encoding: 'utf-8'
  });
}

async function appendTurn(threadId, turnId, file) {
  const logPath = join(cwd, '.omx', 'logs', 'turns.jsonl');
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(
    logPath,
    JSON.stringify({ thread_id: threadId, turn_id: turnId, file }) + '\n',
    { flag: 'a' }
  );
}

async function processFileOnce(filePath) {
  const startTime = Date.now();
  const lines = await parseLines(filePath);

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

    if (!isTaskComplete(parsed)) continue;

    const ts = new Date(parsed.timestamp).getTime();
    if (ts < startTime) continue;

    const turnId = parsed.payload?.turn_id;
    const lastMessage = parsed.payload?.last_agent_message;

    if (!threadId || !turnId) continue;

    const payload = buildPayload(threadId, turnId, lastMessage);

    await invokeNotifyHook(payload, filePath);
    await appendTurn(threadId, turnId, filePath);
  }
}

async function streamFile(filePath) {
  let threadId;
  const lines = await parseLines(filePath);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'session_meta') {
        threadId = parsed.payload?.id;
        break;
      }
    } catch {}
  }

  if (!threadId) return;

  let offset = 0;
  try {
    const s = await stat(filePath);
    offset = s.size;
  } catch {}

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
      encoding: 'utf-8'
    });

    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk;
    }

    offset = s.size;

    const newLines = buffer.split('\n').filter(Boolean);

    for (const line of newLines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (!isTaskComplete(parsed)) continue;

      const turnId = parsed.payload?.turn_id;
      const lastMessage = parsed.payload?.last_agent_message;
      if (!turnId) continue;

      const payload = buildPayload(threadId, turnId, lastMessage);

      await invokeNotifyHook(payload, filePath);
      await appendTurn(threadId, turnId, filePath);
    }
  }, pollMs);

  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

async function main() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const sessionDir = todaySessionDir(home);
  const filePath = await getRolloutFile(sessionDir);
  if (!filePath) return;

  if (once) {
    await processFileOnce(filePath);
  } else {
    await streamFile(filePath);
  }
}

main().catch(() => process.exit(1));
