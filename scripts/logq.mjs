#!/usr/bin/env node
/**
 * 日志查询：直接读 ./logs/*.jsonl，不依赖应用进程。
 *
 *   node scripts/logq.mjs errors [--since 1h] [--limit 50]
 *   node scripts/logq.mjs tail 30
 *   node scripts/logq.mjs req 8f3a2c1d
 *   node scripts/logq.mjs grep 转写失败
 *   node scripts/logq.mjs path /api/notes
 *   node scripts/logq.mjs stats --since 24h
 *   node scripts/logq.mjs files
 *
 * 为什么不用 ELK/Loki：单机单人部署，一套 ES 要吃 1-2GB 内存，
 * 而这里的数据量是「一天几万行」。grep 一个轮转文件足够，
 * 还能直接用 jq / less 二次处理。
 *
 * 什么时候该换：多台机器、需要跨服务关联、需要留存 30 天以上、
 * 或者有第二个人同时查。那时上 Loki + Promtail，应用侧不用改
 * （JSON 单行本来就是为此准备的）。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LEVEL_ORDER = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, CRITICAL: 50 };
const RESET = "\x1b[0m";
const COLOR = {
  DEBUG: "\x1b[90m",
  INFO: "\x1b[36m",
  WARNING: "\x1b[33m",
  ERROR: "\x1b[31m",
  CRITICAL: "\x1b[35m",
};

function parseArgs(argv) {
  const args = { cmd: argv[0] || "tail", positional: [], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function parseDuration(text) {
  const m = /^(\d+)\s*([smhd])$/.exec(String(text || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]];
  return n * unit;
}

/** 收集某个服务的日志文件：按时间从旧到新（.N ... .1, base） */
function logFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const groups = new Map();
  for (const name of entries) {
    const m = /^(.*)\.jsonl(?:\.(\d+))?$/.exec(name);
    if (!m) continue;
    const svc = m[1];
    const idx = m[2] === undefined ? 0 : Number(m[2]);
    if (!groups.has(svc)) groups.set(svc, []);
    groups.get(svc).push({ path: join(dir, name), idx });
  }
  const out = [];
  for (const [, files] of groups) {
    // idx 越大越旧：base(0) 最新，.1 次之……
    files.sort((a, b) => b.idx - a.idx);
    out.push(...files);
  }
  return out;
}

function readRecords(dir) {
  const records = [];
  let bad = 0;
  for (const file of logFiles(dir)) {
    let text;
    try {
      text = readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        bad++;
      }
    }
  }
  return { records, bad };
}

function fmt(rec) {
  const level = rec.level || "INFO";
  const color = COLOR[level] || "";
  const ts = (rec.ts || "").replace("T", " ");
  const svc = (rec.svc || "?").padEnd(8);
  const rid = rec.request_id && rec.request_id !== "-" ? ` ${rec.request_id}` : "";
  const extra = [];
  for (const key of ["path", "status", "ms", "method", "kind", "target_id"]) {
    if (rec[key] !== undefined && rec[key] !== null) extra.push(`${key}=${rec[key]}`);
  }
  let line = `${ts} ${color}${level.padEnd(8)}${RESET} ${svc}${rid} ${rec.msg || ""}`;
  if (extra.length) line += `  \x1b[90m(${extra.join(" ")})${RESET}`;
  if (rec.exc) {
    const first = String(rec.exc).split("\n").filter(Boolean).pop();
    line += `\n    \x1b[31m${first}${RESET}`;
  }
  return line;
}

function applySince(records, flags) {
  const ms = parseDuration(flags.since);
  if (!ms) return records;
  const cutoff = Date.now() - ms;
  return records.filter((r) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) ? t >= cutoff : true;
  });
}

function sortByTs(records) {
  return records.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
}

function limitFromEnd(records, flags, fallback) {
  const n = Number(flags.limit || flags.n || fallback);
  return Number.isFinite(n) && n > 0 ? records.slice(-n) : records;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.flags.dir || "logs";
  const { records, bad } = readRecords(dir);

  if (args.cmd === "files") {
    const files = logFiles(dir);
    if (!files.length) {
      console.log(`没有找到日志文件（目录：${dir}）`);
      console.log("提示：LOG_DIR 未配置时只输出到 stdout，历史不会落盘。");
      return 0;
    }
    for (const f of files) {
      const size = statSync(f.path).size;
      console.log(`${(size / 1024).toFixed(1).padStart(9)} KB  ${f.path}`);
    }
    return 0;
  }

  if (!records.length) {
    console.log(`没有可读日志（目录：${dir}）`);
    return 1;
  }

  let picked = sortByTs(applySince(records, args.flags));
  let title = "";

  switch (args.cmd) {
    case "errors": {
      const min = LEVEL_ORDER[String(args.flags.level || "ERROR").toUpperCase()] || 40;
      picked = picked.filter((r) => (LEVEL_ORDER[r.level] || 0) >= min);
      title = `级别 >= ${args.flags.level || "ERROR"}`;
      break;
    }
    case "req": {
      const id = args.positional[0];
      if (!id) {
        console.error("用法：logq.mjs req <request_id>");
        return 2;
      }
      picked = picked.filter((r) => String(r.request_id || "").includes(id));
      title = `request_id 包含 ${id}`;
      break;
    }
    case "grep": {
      const needle = args.positional.join(" ");
      if (!needle) {
        console.error("用法：logq.mjs grep <关键词>");
        return 2;
      }
      picked = picked.filter((r) => JSON.stringify(r).includes(needle));
      title = `包含「${needle}」`;
      break;
    }
    case "path": {
      const p = args.positional[0];
      if (!p) {
        console.error("用法：logq.mjs path /api/xxx");
        return 2;
      }
      picked = picked.filter((r) => String(r.path || "").startsWith(p));
      title = `path 以 ${p} 开头`;
      break;
    }
    case "stats": {
      const byLevel = {};
      const byLogger = {};
      const byStatus = {};
      for (const r of picked) {
        byLevel[r.level || "?"] = (byLevel[r.level || "?"] || 0) + 1;
        byLogger[r.logger || "?"] = (byLogger[r.logger || "?"] || 0) + 1;
        if (r.status) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      }
      const range = args.flags.since ? `最近 ${args.flags.since}` : "全部";
      console.log(`记录数 ${picked.length}（${range}）${bad ? `，跳过 ${bad} 行非法 JSON` : ""}\n`);
      const dump = (label, obj, top = 10) => {
        console.log(`${label}:`);
        Object.entries(obj)
          .sort((a, b) => b[1] - a[1])
          .slice(0, top)
          .forEach(([k, v]) => console.log(`  ${String(v).padStart(7)}  ${k}`));
        console.log("");
      };
      dump("按级别", byLevel);
      dump("按 logger", byLogger);
      if (Object.keys(byStatus).length) dump("按 HTTP 状态", byStatus);
      return 0;
    }
    case "tail":
    default:
      title = "最近";
      break;
  }

  picked = limitFromEnd(picked, args.flags, args.cmd === "tail" ? 30 : 200);

  if (args.flags.json) {
    picked.forEach((r) => console.log(JSON.stringify(r)));
    return 0;
  }

  if (title) console.log(`\x1b[90m— ${title}，${picked.length} 条 —\x1b[0m`);
  picked.forEach((r) => console.log(fmt(r)));
  return 0;
}

process.exitCode = main();
