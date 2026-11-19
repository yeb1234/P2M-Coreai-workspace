"""P2 视频流水线监控服务。

用法：
  python monitor_server.py           # 启动 0.0.0.0:12702（本机与局域网可访问）
  python monitor_server.py --once    # 打印当前快照 JSON，供 HTML 内嵌

数据源：Docker 内的 Postgres / Redis、nvidia-smi、Windows CPU/内存 API、WAV 缓存目录、笔记本 LM Studio。
只读，不修改任何流水线状态。
"""
from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
import ctypes
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
HTML_FILE = ROOT / "监控面板.html"
ASSETS = ROOT / "assets"
DOCKER = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
NVIDIA = r"C:\Windows\System32\nvidia-smi.exe"
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
AUDIO_CACHE = REPO_ROOT / "data" / "audio-cache"
LAPTOP_API = "http://192.168.3.250:1234/api/v1/models"
HOST = "0.0.0.0"
PORT = 12702
CACHE_TTL = 1
DOCKER_PROBE_TTL = 10.0
DOCKER_FAIL_BACKOFF = 60.0
UAC_BACKOFF = 600.0
_cache: dict | None = None
_cache_at = 0.0
_docker_lock = threading.Lock()
_docker_block_until = 0.0
_run_cache: dict[tuple[str, ...], tuple[float, str]] = {}
_consent_checked_at = 0.0
_consent_count = 0
_last_block_log = 0.0
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

# CPU / 内存采样状态。CPU 用 GetSystemTimes 的两次差值，内存用 GlobalMemoryStatusEx。
_cpu_prev: tuple[int, int, int] | None = None
_cpu_lock = threading.Lock()
_cpu_model_cache: str | None = None
_cpu_temp_cache: float | None = None
_cpu_temp_at = 0.0
_cpu_temp_source = "unavailable"


class _FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_ulong), ("dwHighDateTime", ctypes.c_ulong)]


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def _filetime_value(value: _FILETIME) -> int:
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


def _system_times() -> tuple[int, int, int] | None:
    if os.name != "nt":
        return None
    try:
        idle = _FILETIME()
        kernel = _FILETIME()
        user = _FILETIME()
        if not ctypes.windll.kernel32.GetSystemTimes(
            ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
        ):
            return None
        return _filetime_value(idle), _filetime_value(kernel), _filetime_value(user)
    except Exception:
        return None


def _cpu_util() -> float | None:
    global _cpu_prev
    times = _system_times()
    if times is None:
        return None
    with _cpu_lock:
        if _cpu_prev is None:
            _cpu_prev = times
            time.sleep(0.05)
            times = _system_times()
            if times is None:
                return None
        prev_idle, prev_kernel, prev_user = _cpu_prev
        idle, kernel, user = times
        total = (kernel - prev_kernel) + (user - prev_user)
        busy = total - (idle - prev_idle)
        _cpu_prev = times
        if total <= 0:
            return None
        return max(0.0, min(1.0, busy / total))


def _memory_metrics() -> dict:
    if os.name != "nt":
        return {"used_gb": None, "total_gb": None, "percent": None}
    try:
        mem = _MEMORYSTATUSEX()
        mem.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(mem)):
            raise OSError("GlobalMemoryStatusEx failed")
        total = float(mem.ullTotalPhys)
        used = float(mem.ullTotalPhys - mem.ullAvailPhys)
        return {
            "used_gb": round(used / (1024 ** 3), 1),
            "total_gb": round(total / (1024 ** 3), 1),
            "percent": used / total if total else None,
        }
    except Exception:
        return {"used_gb": None, "total_gb": None, "percent": None}


def _cpu_model() -> str:
    global _cpu_model_cache
    if _cpu_model_cache:
        return _cpu_model_cache
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            ) as key:
                name = str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
                if name:
                    _cpu_model_cache = name
                    return name
        except Exception:
            pass
    _cpu_model_cache = "CPU"
    return _cpu_model_cache


def _cpu_temp() -> tuple[float | None, str]:
    """ACPI 热区是 Windows 默认能读到的温度；它不是 CPU 核心封装温度。

    优先取 Win32_PerfFormattedData_Counters_ThermalZoneInformation 的 Kelvin 值，
    30 秒缓存一次。若机器没有 ACPI 热区，返回 None，页面明确显示“未接入”。
    """
    global _cpu_temp_cache, _cpu_temp_at, _cpu_temp_source
    now = time.monotonic()
    if now - _cpu_temp_at < 30.0:
        return _cpu_temp_cache, _cpu_temp_source
    _cpu_temp_at = now
    _cpu_temp_cache = None
    _cpu_temp_source = "unavailable"
    if os.name != "nt":
        return None, "unavailable"
    command = (
        "(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation "
        "| Select-Object -First 1 -ExpandProperty Temperature)"
    )
    try:
        out = subprocess.run(
            [POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=8, check=False, creationflags=_CREATE_NO_WINDOW,
        )
        lines = [line.strip() for line in (out.stdout or "").splitlines() if line.strip()]
        if lines:
            kelvin = float(lines[-1].replace(",", "."))
            if 250.0 <= kelvin <= 400.0:
                _cpu_temp_cache = round(kelvin - 273.15, 1)
                _cpu_temp_source = "ACPI thermal zone"
    except Exception:
        pass
    return _cpu_temp_cache, _cpu_temp_source


def _cpu_metrics() -> dict:
    mem = _memory_metrics()
    temp, source = _cpu_temp()
    return {
        "model": _cpu_model(),
        "util": _cpu_util(),
        "temp_c": temp,
        "temp_source": source,
        "mem_used_gb": mem["used_gb"],
        "mem_total_gb": mem["total_gb"],
        "mem_percent": mem["percent"],
    }


def _log(message: str) -> None:
    print(f"{datetime.now().strftime('%H:%M:%S')} {message}", flush=True)


def _uac_prompt_count() -> int:
    """Count live consent.exe prompts, cached briefly to keep probes cheap."""
    global _consent_checked_at, _consent_count
    now = time.monotonic()
    if now - _consent_checked_at < 5.0:
        return _consent_count
    _consent_checked_at = now
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq consent.exe", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=3, check=False, creationflags=_CREATE_NO_WINDOW,
        )
        _consent_count = (out.stdout or "").lower().count("consent.exe")
    except Exception:
        _consent_count = 0
    return _consent_count


def _docker_gate() -> bool:
    """Never hammer Docker when UAC is active or the engine is failing."""
    global _docker_block_until, _last_block_log
    now = time.monotonic()
    if _uac_prompt_count() > 0:
        if now < _docker_block_until:
            return False
        _docker_block_until = now + UAC_BACKOFF
        if now - _last_block_log > 60:
            _log(f"UAC prompt detected; Docker probes paused for {int(UAC_BACKOFF)}s")
            _last_block_log = now
        return False
    return now >= _docker_block_until


def run(cmd: list[str], timeout: int = 15, cache_ttl: float = 0.0) -> str:
    global _docker_block_until
    key = tuple(cmd)
    now = time.monotonic()
    if cache_ttl and key in _run_cache:
        cached_at, cached_value = _run_cache[key]
        if now - cached_at < cache_ttl:
            return cached_value
    is_docker = bool(cmd) and cmd[0] == DOCKER
    if is_docker and not _docker_gate():
        return ""
    try:
        if is_docker and not _docker_lock.acquire(timeout=5):
            return ""
        try:
            out = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=timeout, check=False, creationflags=_CREATE_NO_WINDOW,
            )
        finally:
            if is_docker:
                _docker_lock.release()
        text = (out.stdout or "").strip()
        if is_docker:
            if out.returncode != 0:
                _docker_block_until = max(_docker_block_until, time.monotonic() + DOCKER_FAIL_BACKOFF)
                _log(f"Docker probe failed rc={out.returncode}; probes paused {int(DOCKER_FAIL_BACKOFF)}s")
            elif _uac_prompt_count() > 0:
                _docker_block_until = max(_docker_block_until, time.monotonic() + UAC_BACKOFF)
        if cache_ttl:
            _run_cache[key] = (time.monotonic(), text)
        return text
    except Exception:
        if is_docker:
            _docker_block_until = max(_docker_block_until, time.monotonic() + DOCKER_FAIL_BACKOFF)
        return ""


def psql(sql: str) -> list[list[str]]:
    raw = run([
        DOCKER, "exec", "p2-siteyeb-postgres-1", "psql",
        "-U", "p2user", "-d", "p2learning", "-t", "-A", "-F", "|", "-c", sql,
    ], cache_ttl=DOCKER_PROBE_TTL)

    rows = []
    for line in raw.splitlines():
        line = line.strip()
        if line:
            rows.append(line.split("|"))
    return rows


def num(value: str | None, default: float = 0) -> float:
    try:
        return float(value or 0)
    except Exception:
        return default


def intnum(value: str | None, default: int = 0) -> int:
    try:
        return int(float(value or 0))
    except Exception:
        return default


def compact_text(value: str | None, limit: int = 96) -> str:
    """Keep log rows one line; never leak a full traceback into the page."""
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def iso_time(value: str | None) -> str:
    try:
        return datetime.fromisoformat(str(value)).astimezone().isoformat(timespec="seconds")
    except Exception:
        return str(value or "")


def median_rate(values: list[float]) -> float:
    """Median of the recent throughput windows; ignores empty windows."""
    clean = [float(v) for v in values if v and v > 0]
    return float(statistics.median(clean)) if clean else 0.0


def eta_bounds(remaining: float, rates: list[float], unit: float) -> tuple[float | None, float | None]:
    """Use the slowest/fastest recent window as the ETA upper/lower bound.

    180 分钟窗口可能包含刚启动或降速前的吞吐，先按中位数把明显偏离的窗口
    剔除，避免一个陈旧窗口把 ETA 区间拉成三倍。
    """
    clean = [float(v) for v in rates if v and v > 0]
    if remaining <= 0 or not clean:
        return None, None
    if len(clean) >= 3:
        center = statistics.median(clean)
        kept = [v for v in clean if center * 0.6 <= v <= center * 1.6]
        if kept:
            clean = kept
    return remaining / max(clean) * unit, remaining / min(clean) * unit


def eta_confidence(low: float | None, high: float | None, samples: int) -> str:
    if not samples or not low or not high or low <= 0 or high <= 0:
        return "low"
    spread = high / low
    if samples >= 3 and spread <= 1.25:
        return "high"
    if samples >= 2 and spread <= 1.6:
        return "medium"
    return "low"


def collect_status() -> dict:
    sql = """
select 'transcribe',
  count(*) filter (where j.status='queued'),
  count(*) filter (where j.status='running'),
  count(*) filter (where j.status='completed'),
  count(*) filter (where j.status='failed'),
  coalesce(sum(case when j.status in ('queued','running') then v.duration else 0 end),0)/3600.0,
  coalesce(sum(case when j.status='completed' and j.updated_at >= now()-interval '15 minutes' then v.duration else 0 end),0)/3600.0,
  count(*) filter (where j.status='completed' and j.updated_at >= now()-interval '15 minutes'),
  coalesce(sum(case when j.status='completed' and j.updated_at >= now()-interval '30 minutes' then v.duration else 0 end),0)/3600.0,
  count(*) filter (where j.status='completed' and j.updated_at >= now()-interval '30 minutes'),
  coalesce(sum(case when j.status='completed' and j.updated_at >= now()-interval '60 minutes' then v.duration else 0 end),0)/3600.0,
  count(*) filter (where j.status='completed' and j.updated_at >= now()-interval '60 minutes'),
  coalesce(sum(case when j.status='completed' and j.updated_at >= now()-interval '180 minutes' then v.duration else 0 end),0)/3600.0,
  count(*) filter (where j.status='completed' and j.updated_at >= now()-interval '180 minutes')
from ai_jobs j join videos v on v.id=j.video_id
where j.summary_only=false;

select 'summary',
  count(*) filter (where j.status='queued'),
  count(*) filter (where j.status='running'),
  count(*) filter (where j.status='completed'),
  count(*) filter (where j.status='failed'),
  count(*) filter (where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '15 minutes'),
  count(*) filter (where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '30 minutes'),
  count(*) filter (where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '60 minutes'),
  count(*) filter (where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '180 minutes')
from ai_jobs j join videos v on v.id=j.video_id
where j.summary_only;

select 'summary_chars',
  coalesce(sum(length(coalesce(nullif(v.transcription,''), nullif(v.transcript_segments,''), ''))) filter (
    where j.status in ('queued','running')
  ),0),
  coalesce(sum(length(coalesce(nullif(v.transcription,''), nullif(v.transcript_segments,''), ''))) filter (
    where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '15 minutes'
  ),0),
  coalesce(sum(length(coalesce(nullif(v.transcription,''), nullif(v.transcript_segments,''), ''))) filter (
    where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '30 minutes'
  ),0),
  coalesce(sum(length(coalesce(nullif(v.transcription,''), nullif(v.transcript_segments,''), ''))) filter (
    where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '60 minutes'
  ),0),
  coalesce(sum(length(coalesce(nullif(v.transcription,''), nullif(v.transcript_segments,''), ''))) filter (
    where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '180 minutes'
  ),0)
from ai_jobs j join videos v on v.id=j.video_id
where j.summary_only;

select 'summary_activity', coalesce(min(j.updated_at) filter (
  where j.status='completed' and v.summary is not null and btrim(v.summary) <> '' and j.updated_at >= now()-interval '180 minutes'
)::text, '')
from ai_jobs j join videos v on v.id=j.video_id
where j.summary_only;

select 'vector',
  count(*) filter (where status='queued'),
  count(*) filter (where status='running'),
  count(*) filter (where status='done'),
  count(*) filter (where status='failed'),
  count(*) filter (where status='done' and finished_at >= now()-interval '15 minutes'),
  count(*) filter (where status='done' and finished_at >= now()-interval '30 minutes'),
  count(*) filter (where status='done' and finished_at >= now()-interval '60 minutes'),
  count(*) filter (where status='done' and finished_at >= now()-interval '180 minutes')
from background_tasks where kind='chunk_index';

select 'chunks', count(*), count(*) filter (where embedding is null), count(distinct video_id)
from content_chunks;

select 'videos', count(*),
  count(*) filter (where coalesce(v.subtitle_path,'') <> '' or coalesce(v.transcript_segments,'') <> ''),
  count(*) filter (where coalesce(v.summary,'') <> ''),
  count(*) filter (where (coalesce(v.subtitle_path,'') <> '' or coalesce(v.transcript_segments,'') <> '')
    and coalesce(v.summary,'') <> '' and c.has_vectors),
  count(*) filter (where (coalesce(v.subtitle_path,'') <> '' or coalesce(v.transcript_segments,'') <> '')
    and coalesce(v.summary,'') = ''),
  count(*) filter (where (coalesce(v.subtitle_path,'') <> '' or coalesce(v.transcript_segments,'') <> '')
    and coalesce(v.summary,'') <> '' and not c.has_vectors)
from videos v
left join (
  select video_id, bool_or(embedding is not null) as has_vectors
  from content_chunks
  group by video_id
) c on c.video_id = v.id;

select 'weighted',
  coalesce(sum(coalesce(v.duration,0) * (
    0.55 * case when coalesce(v.transcript_segments,'') <> '' or coalesce(v.transcription,'') <> '' then 1 else 0 end
    + 0.30 * case when coalesce(v.summary,'') <> '' then 1 else 0 end
    + 0.15 * coalesce(c.vector_ratio, 0)
  )),0) / nullif(sum(coalesce(v.duration,0)),0)
from videos v
left join (
  select video_id,
    count(*) as chunks,
    count(*) filter (where embedding is not null)::float / nullif(count(*),0) as vector_ratio
  from content_chunks
  group by video_id
) c on c.video_id = v.id;

select 'worker_stats',
  count(*) filter (where status='completed'),
  count(*) filter (where status='failed')
from (
  select status from ai_jobs
  where status in ('completed','failed') and updated_at >= now() - interval '15 minutes'
  union all
  select case when status='done' then 'completed' else 'failed' end
  from background_tasks
  where kind='chunk_index' and status in ('done','failed')
    and coalesce(finished_at, created_at) >= now() - interval '15 minutes'
) e;

select 'worker_event',
  source, id, pool, status, message, error, ts, target
from (
  select 'ai' as source, id,
    case when summary_only then 'summary' else 'transcribe' end as pool,
    status, coalesce(message,'') as message, coalesce(error,'') as error,
    updated_at as ts, video_id::text as target
  from ai_jobs
  where status in ('completed','failed') and updated_at >= now() - interval '15 minutes'
  union all
  select 'bg', id, 'vector',
    case when status='done' then 'completed' else 'failed' end,
    kind, coalesce(error,''), coalesce(finished_at, created_at), target_id
  from background_tasks
  where kind='chunk_index' and status in ('done','failed')
    and coalesce(finished_at, created_at) >= now() - interval '15 minutes'
) e
order by ts desc
limit 8;

select 'worker_last_failure', source, id, pool, status, message, error, ts, target
from (
  select 'ai' as source, id,
    case when summary_only then 'summary' else 'transcribe' end as pool,
    status, coalesce(message,'') as message, coalesce(error,'') as error,
    updated_at as ts, video_id::text as target
  from ai_jobs
  where status='failed'
  union all
  select 'bg', id, 'vector', 'failed',
    kind, coalesce(error,''), coalesce(finished_at, created_at), target_id
  from background_tasks
  where kind='chunk_index' and status='failed'
) e
order by ts desc
limit 1;
"""
    raw_rows = psql(sql)
    worker_event_rows = [row[1:] for row in raw_rows if row[0] == "worker_event" and len(row) >= 9]
    rows = {row[0]: row[1:] for row in raw_rows if len(row) >= 2}

    def worker_log_item(row: list[str]) -> dict:
        source, job_id, pool, status, message, error, ts, target = row[:8]
        return {
            "source": source,
            "job_id": job_id,
            "pool": pool,
            "status": "completed" if status == "completed" else "failed",
            "target": target,
            "message": compact_text(message, 72),
            "error": compact_text(error, 72) if status == "failed" else "",
            "at": iso_time(ts),
        }

    ws = rows.get("worker_stats", ["0", "0"])
    worker_events = [worker_log_item(row) for row in worker_event_rows]
    last_failure_row = rows.get("worker_last_failure")
    worker_ok = intnum(ws[0]) if ws else 0
    worker_failed = intnum(ws[1]) if len(ws) > 1 else 0
    last_failure = worker_log_item(last_failure_row) if last_failure_row and len(last_failure_row) >= 8 else None

    tr = rows.get("transcribe", ["0"] * 13)
    queued, running, completed, failed = map(intnum, tr[0:4])
    remaining_audio = num(tr[4])
    remaining_transcribe = queued + running
    transcribe_windows = [
        ("15m", num(tr[5]), intnum(tr[6]), 15.0),
        ("30m", num(tr[7]), intnum(tr[8]), 30.0),
        ("60m", num(tr[9]), intnum(tr[10]), 60.0),
        ("180m", num(tr[11]), intnum(tr[12]), 180.0),
    ]
    last60_hours, last60_count = next(
        ((hours, count) for label, hours, count, minutes in transcribe_windows if label == "60m"),
        (0.0, 0),
    )
    last30_hours, last30_count = next(
        ((hours, count) for label, hours, count, minutes in transcribe_windows if label == "30m"),
        (0.0, 0),
    )
    transcribe_audio_rates = [
        hours / (minutes / 60.0)
        for _label, hours, count, minutes in transcribe_windows
        if count > 0 and hours > 0
    ]
    transcribe_file_rates = [
        count / (minutes / 60.0)
        for _label, _hours, count, minutes in transcribe_windows
        if count > 0
    ]
    rate_audio = median_rate(transcribe_audio_rates)
    rate_files = median_rate(transcribe_file_rates)
    transcribe_eta_audio = (remaining_audio / rate_audio * 3600) if rate_audio > 0 else None
    transcribe_eta_files = (remaining_transcribe / rate_files * 3600) if rate_files > 0 else None
    # 音频时长是主口径；文件数只用于交叉校验，避免把长视频当成短视频。
    transcribe_eta = transcribe_eta_audio if transcribe_eta_audio is not None else transcribe_eta_files
    transcribe_eta_low, transcribe_eta_high = eta_bounds(remaining_audio, transcribe_audio_rates, 3600)
    transcribe_confidence = eta_confidence(
        transcribe_eta_low, transcribe_eta_high, len(transcribe_audio_rates)
    )
    transcribe_basis = (
        f"近15/30/60/180分钟音频吞吐中位数 {rate_audio:.1f} 音频h/h"
        if rate_audio > 0 else "转写窗口样本不足"
    )
    transcribe_note = "" if rate_audio > 0 else "最近窗口没有足够完成样本，ETA 为粗估"

    sm = rows.get("summary", ["0"] * 8)
    s_queued, s_running, s_completed, s_failed = map(intnum, sm[0:4])
    s15, s30, s60, s180 = map(intnum, sm[4:8])
    sc = rows.get("summary_chars", ["0"] * 5)
    pending_chars, c15, c30, c60, c180 = map(intnum, sc[0:5])
    summary_activity = rows.get("summary_activity", [""])
    summary_started = None
    if summary_activity and summary_activity[0]:
        try:
            summary_started = datetime.fromisoformat(summary_activity[0])
        except ValueError:
            summary_started = None
    # 刚起一批任务时，15/30/60/180 分钟窗口的数据其实只覆盖了最近几分钟。
    # 用完整窗口做分母会把 1.5 分钟跑 17 个算成 0.4 个/分钟，ETA 直接虚高几十倍。
    elapsed_min = None
    if summary_started is not None:
        elapsed_min = max(0.5, (datetime.now() - summary_started).total_seconds() / 60)
    summary_rates = []
    for count, minutes in ((s15, 15.0), (s30, 30.0), (s60, 60.0), (s180, 180.0)):
        if count <= 0:
            continue
        effective_minutes = min(minutes, elapsed_min) if elapsed_min else minutes
        summary_rates.append(count / effective_minutes)
    summary_rate = median_rate(summary_rates)
    summary_remaining = s_queued + s_running

    # 字符口径：总结成本主要由转录文本长度决定，单纯按“条数”会把
    # 长课程和短视频当成一样重。字符样本不足时再退回任务数口径。
    summary_char_rates = []
    for chars, minutes in ((c15, 15.0), (c30, 30.0), (c60, 60.0), (c180, 180.0)):
        if chars <= 0:
            continue
        effective_minutes = min(minutes, elapsed_min) if elapsed_min else minutes
        summary_char_rates.append(chars / effective_minutes)
    summary_char_rate = median_rate(summary_char_rates)
    summary_eta_jobs = (summary_remaining / summary_rate * 60) if summary_rate > 0 else None
    summary_eta_jobs_low, summary_eta_jobs_high = eta_bounds(
        summary_remaining, summary_rates, 60
    )
    summary_eta_chars = (
        (pending_chars / summary_char_rate * 60)
        if summary_char_rate > 0 and pending_chars > 0 else None
    )
    summary_eta_chars_low, summary_eta_chars_high = eta_bounds(
        pending_chars, summary_char_rates, 60
    )
    if summary_eta_jobs is not None and summary_eta_chars is not None:
        # 两个口径都成立时取较大值：任务数约束 LLM 调用次数，字符量约束
        # 长转录的生成时间，单看任何一个都会在长短视频混合时偏乐观。
        summary_eta = max(summary_eta_jobs, summary_eta_chars)
        low_values = [
            v for v in (summary_eta_jobs_low, summary_eta_chars_low) if v is not None
        ]
        high_values = [
            v for v in (summary_eta_jobs_high, summary_eta_chars_high) if v is not None
        ]
        summary_eta_low = min(low_values) if low_values else None
        summary_eta_high = max(high_values) if high_values else None
        summary_confidence = "medium" if len(summary_char_rates) >= 2 else "low"
        summary_basis = (
            f"任务 {summary_rate:.1f} 个/分、字符 {summary_char_rate:.0f} 字/分"
            "，两种口径取较大值"
        )
        summary_note = ""
    elif summary_eta_chars is not None:
        summary_eta = summary_eta_chars
        summary_eta_low, summary_eta_high = summary_eta_chars_low, summary_eta_chars_high
        summary_confidence = eta_confidence(
            summary_eta_low, summary_eta_high, len(summary_char_rates)
        )
        summary_basis = (
            f"近15/30/60/180分钟字符吞吐中位数 {summary_char_rate:.0f} 字/分"
        )
        summary_note = ""
    else:
        summary_eta = summary_eta_jobs
        summary_eta_low, summary_eta_high = summary_eta_jobs_low, summary_eta_jobs_high
        summary_confidence = eta_confidence(
            summary_eta_low, summary_eta_high, len(summary_rates)
        )
        summary_basis = (
            f"近15/30/60/180分钟任务吞吐中位数 {summary_rate:.1f} 个/分"
            if summary_rate > 0 else "总结窗口样本不足"
        )
        summary_note = "" if summary_rate > 0 else "最近窗口没有足够完成样本，ETA 为粗估"

    vc = rows.get("vector", ["0"] * 8)
    v_queued, v_running, v_done, v_failed = map(intnum, vc[0:4])
    v15, v30, v60, v180 = map(intnum, vc[4:8])
    vector_rates = [
        count / minutes
        for count, minutes in ((v15, 15.0), (v30, 30.0), (v60, 60.0), (v180, 180.0))
        if count > 0
    ]
    vector_rate = median_rate(vector_rates)
    chunks = rows.get("chunks", ["0", "0", "0"])
    total_chunks, missing_chunks, chunk_videos = map(intnum, chunks[0:3])
    avg_chunks_per_task = (total_chunks / v_done) if v_done else 1
    vector_tasks_left = max(v_queued + v_running, missing_chunks / max(avg_chunks_per_task, 1))
    vector_eta = (vector_tasks_left / vector_rate * 60) if vector_rate > 0 else None
    vector_eta_low, vector_eta_high = eta_bounds(
        vector_tasks_left, vector_rates, 60
    )
    vector_confidence = eta_confidence(vector_eta_low, vector_eta_high, len(vector_rates))
    if missing_chunks <= 0:
        vector_note = "向量已覆盖"
    elif vector_rate <= 0:
        vector_note = "向量 worker 未运行或最近无完成样本，ETA 待启动后重算"
    else:
        vector_note = ""

    vids = rows.get("videos", ["0", "0", "0", "0", "0", "0"])
    total_videos, transcribed_videos, summarized_videos, full_completed = map(intnum, vids[0:4])
    summary_backlog = intnum(vids[4]) if len(vids) > 4 else max(0, transcribed_videos - summarized_videos)
    missing_vectors = intnum(vids[5]) if len(vids) > 5 else 0
    summary_coverage = summarized_videos / max(total_videos, 1)
    not_started = max(0, total_videos - transcribed_videos)
    partial = max(0, transcribed_videos - full_completed)
    full_progress = full_completed / max(total_videos, 1)

    # 按视频时长加权：0.55 字幕 + 0.30 总结 + 0.15 向量（向量按 chunk 覆盖率折算）。
    # 这样 2 小时课程不会被当成长度 10 分钟的短视频，也不会因为一条短视频
    # 三件套齐全就把整体进度抬高。严格三件套仍单独保留为 full_progress。
    weighted_row = rows.get("weighted", ["0"])
    weighted_progress = max(0.0, min(1.0, num(weighted_row[0]) if weighted_row else 0.0))

    # 主链 ETA：转写清空后 GPU 接向量；总结走旁路，最多取两者较大值。
    overall_eta = None
    overall_eta_low = None
    overall_eta_high = None
    overall_confidence = "low"
    overall_note = ""
    if transcribe_eta is not None:
        vector_part = vector_eta or 0
        overall_eta = transcribe_eta + vector_part
        overall_eta_low = (transcribe_eta_low or transcribe_eta) + (vector_eta_low or vector_part)
        overall_eta_high = (transcribe_eta_high or transcribe_eta) + (vector_eta_high or vector_part)
        overall_confidence = transcribe_confidence
        if missing_chunks > 0 and vector_eta is None:
            overall_note = "向量阶段未启动，主链 ETA 未含向量"
            overall_confidence = "low"
    elif vector_eta is not None:
        overall_eta = vector_eta
        overall_eta_low, overall_eta_high = vector_eta_low, vector_eta_high
        overall_confidence = vector_confidence
    elif summary_eta is not None:
        overall_eta = summary_eta
        overall_eta_low, overall_eta_high = summary_eta_low, summary_eta_high
        overall_confidence = summary_confidence

    if summary_eta is not None:
        if overall_eta is None or summary_eta > overall_eta:
            overall_eta = summary_eta
            overall_eta_low = summary_eta_low
            overall_eta_high = summary_eta_high
            overall_confidence = summary_confidence
        elif overall_eta_high is not None and summary_eta_high is not None:
            overall_eta_high = max(overall_eta_high, summary_eta_high)

    if overall_note == "" and overall_eta is not None and rate_audio <= 0:
        overall_note = transcribe_note

    if queued + running > 0:
        phase = "wait_transcription"
    elif v_queued + v_running > 0 or missing_chunks > 0:
        phase = "wait_vectors"
    elif s_queued + s_running > 0:
        phase = "summarizing"
    else:
        phase = "done"

    # WAV 缓存
    wavs = list(AUDIO_CACHE.glob("*.wav")) if AUDIO_CACHE.exists() else []
    cache_bytes = sum(p.stat().st_size for p in wavs if p.exists())
    cache_gb = cache_bytes / (1024 ** 3)

    # GPU
    gpu_raw = run([NVIDIA, "--query-gpu=utilization.gpu,memory.used,memory.total,"
                   "temperature.gpu,power.draw", "--format=csv,noheader,nounits"], timeout=5)
    gpu = None
    if gpu_raw:
        parts = [p.strip() for p in gpu_raw.split(",")]
        if len(parts) >= 5:
            gpu = {
                "util": num(parts[0]), "mem_used": num(parts[1]),
                "mem_total": num(parts[2]), "temp": num(parts[3]), "power": num(parts[4]),
            }

    cpu = _cpu_metrics()

    # 容器状态
    workers_raw = run([DOCKER, "ps", "--format", "{{.Names}}|{{.Status}}"], timeout=8, cache_ttl=DOCKER_PROBE_TTL)
    workers = []
    for line in workers_raw.splitlines():
        if "|" in line:
            name, state = line.split("|", 1)
            workers.append({"name": name, "status": state})
    running_names = {w["name"] for w in workers}
    vector_worker_running = "p2-siteyeb-vector-worker-1" in running_names
    audio_prep_running = "p2-siteyeb-audio-prep-1" in running_names

    # Redis 队列（只作旁证，DB 才是状态源）
    redis = {}
    for q in ("ai_jobs", "summary_jobs", "background"):
        redis[q] = intnum(run([
            DOCKER, "exec", "p2-siteyeb-redis-1", "redis-cli", "--raw",
            "LLEN", f"rq:queue:{q}",
        ], timeout=5, cache_ttl=DOCKER_PROBE_TTL))

    # 笔记本 LM Studio（失败不影响主面板）
    laptop = None
    try:
        with urllib.request.urlopen(LAPTOP_API, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models = data.get("models", [])
        target = next(
            (
                m for m in models
                if m.get("key") in ("qwen/qwen3-4b-2507", "qwen/qwen3-4b")
            ),
            None,
        )
        if target:
            instances = target.get("loaded_instances") or []
            ctx = None
            if instances:
                ctx = instances[0].get("config", {}).get("context_length")
            laptop = {"loaded": bool(instances), "context_length": ctx,
                      "max_context_length": target.get("max_context_length")}
    except Exception:
        laptop = None

    # 主链进度：转写阶段看转写完成率，转写清空后看向量覆盖率，
    # 两者都清空后才用总结完成率表示收尾进度。
    if queued + running > 0:
        overall_progress = completed / max(completed + queued + running + failed, 1)
    elif missing_chunks > 0:
        overall_progress = (total_chunks - missing_chunks) / max(total_chunks, 1)
    else:
        overall_progress = s_completed / max(s_completed + s_queued + s_running + s_failed, 1)

    now = datetime.now().astimezone()

    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_at_ms": int(now.timestamp() * 1000),
        "phase": phase,
        "transcribe": {
            "queued": queued, "running": running, "completed": completed, "failed": failed,
            "total": completed + queued + running + failed,
            "progress": completed / max(completed + queued + running + failed, 1),
            "remaining_audio_hours": remaining_audio,
            "last15_audio_hours": num(tr[5]), "last15_count": intnum(tr[6]),
            "last30_audio_hours": last30_hours, "last30_count": last30_count,
            "last60_audio_hours": last60_hours, "last60_count": last60_count,
            "last180_audio_hours": num(tr[11]), "last180_count": intnum(tr[12]),
            "rate_audio_hours_per_hour": rate_audio,
            "rate_files_per_hour": rate_files,
            "eta_file_count_seconds": transcribe_eta_files,
            "eta_seconds": transcribe_eta,
            "eta_low_seconds": transcribe_eta_low,
            "eta_high_seconds": transcribe_eta_high,
            "eta_confidence": transcribe_confidence,
            "eta_basis": transcribe_basis,
            "eta_note": transcribe_note,
        },
        "summary": {
            "queued": s_queued, "running": s_running, "completed": s_completed,
            "failed": s_failed, "total": s_completed + s_queued + s_running + s_failed,
            "progress": s_completed / max(s_completed + s_queued + s_running + s_failed, 1),
            "last15": s15, "last30": s30, "last60": s60, "last180": s180,
            "rate_per_min": summary_rate,
            "rate_chars_per_min": summary_char_rate,
            "pending_chars": pending_chars,
            "remaining": summary_remaining, "eta_seconds": summary_eta,
            "eta_seconds_job": summary_eta_jobs,
            "eta_seconds_chars": summary_eta_chars,
            "eta_low_seconds": summary_eta_low,
            "eta_high_seconds": summary_eta_high,
            "eta_confidence": summary_confidence,
            "eta_basis": summary_basis,
            "eta_note": summary_note,
        },
        "vector": {
            "queued": v_queued, "running": v_running, "done": v_done, "failed": v_failed,
            "last15": v15, "last30": v30, "last60": v60, "last180": v180,
            "total_chunks": total_chunks, "missing_chunks": missing_chunks,
            "chunk_videos": chunk_videos,
            "coverage": (total_chunks - missing_chunks) / max(total_chunks, 1),
            "rate_tasks_per_min": vector_rate,
            "eta_seconds": vector_eta,
            "eta_low_seconds": vector_eta_low,
            "eta_high_seconds": vector_eta_high,
            "eta_confidence": vector_confidence,
            "eta_basis": (
                f"近15/30/60/180分钟任务吞吐中位数 {vector_rate:.1f} 任务/分"
                if vector_rate > 0 else "最近 180 分钟没有向量完成样本"
            ),
            "eta_note": vector_note,
        },
        "audio": {
            "cache_wavs": len(wavs), "cache_bytes": cache_bytes, "cache_gb": cache_gb,
            "running": audio_prep_running,
        },
        "cpu": cpu,
        "gpu": gpu,
        "workers": workers,
        "worker_log": {
            "window_minutes": 15,
            "ok": worker_ok,
            "failed": worker_failed,
            "events": worker_events,
            "last_failure": last_failure,
        },
        "vector_worker_running": vector_worker_running,
        "redis": redis,
        "laptop": laptop,
        "videos": {
            "total": total_videos, "transcribed": transcribed_videos,
            "summarized": summarized_videos, "full_completed": full_completed,
            "partial": partial, "not_started": not_started,
            "missing_vectors": missing_vectors,
            "full_progress": full_progress,
            "summary_coverage": summary_coverage,
            "summary_backlog": summary_backlog,
        },
        "overall": {
            "progress": weighted_progress,
            "main_progress": overall_progress,
            "weighted_progress": weighted_progress,
            "full_progress": full_progress,
            "strict_progress": full_progress,
            "progress_formula": "按视频时长加权：0.55 字幕 + 0.30 总结 + 0.15 向量覆盖率；严格三件套另列",
            "eta_seconds": overall_eta,
            "eta_low_seconds": overall_eta_low,
            "eta_high_seconds": overall_eta_high,
            "eta_confidence": overall_confidence,
            "eta_basis": (
                f"转写 {transcribe_basis} + 向量；总结 {summary_basis}"
                if transcribe_eta is not None else summary_basis
            ),
            "eta_note": overall_note,
        },
    }


def get_status(force: bool = False) -> dict:
    global _cache, _cache_at
    now = time.time()
    if not force and _cache is not None and now - _cache_at < CACHE_TTL:
        return _cache
    _cache = collect_status()
    _cache_at = now
    return _cache


class Handler(BaseHTTPRequestHandler):
    def _send(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send(b"", "text/plain")

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/api/status", "/status.json"):
            body = json.dumps(get_status(), ensure_ascii=False).encode("utf-8")
            self._send(body, "application/json; charset=utf-8")
            return
        if path.startswith("/assets/"):
            name = Path(path).name
            asset = ASSETS / name
            if name and asset.is_file():
                types = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".svg": "image/svg+xml",
                    ".webp": "image/webp",
                }
                self._send(asset.read_bytes(), types.get(asset.suffix.lower(), "application/octet-stream"))
            else:
                self._send(b"not found", "text/plain; charset=utf-8", 404)
            return
        if path in ("/", "/index.html", "/monitor.html", "/监控面板.html"):
            if HTML_FILE.exists():
                self._send(HTML_FILE.read_bytes(), "text/html; charset=utf-8")
            else:
                self._send(b"monitor html missing", "text/plain; charset=utf-8", 404)
            return
        self._send(b"not found", "text/plain; charset=utf-8", 404)

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    if "--once" in sys.argv:
        print(json.dumps(get_status(force=True), ensure_ascii=False, indent=2))
        return
    if "--snapshot" in sys.argv:
        snap = get_status(force=True)
        (ROOT / "snapshot.json").write_text(
            json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"snapshot written: {ROOT / 'snapshot.json'}")
        return
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"monitor listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
