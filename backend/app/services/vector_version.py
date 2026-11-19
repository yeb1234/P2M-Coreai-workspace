"""向量版本契约。

版本号统一为三段式 `<major>.<minor>.<patch>`，测试候选在末尾加 `b`/`c`
（例如 `1.1.1b`）。版本号只描述“会改变检索结果的方法与参数”，
不把批次大小、并发数、扫描间隔这类纯运行参数算进版本。

分级规则：

- major：换了向量方法本身。例如换 embedding 模型、维度、存储类型、
  或完全不同的分块/检索架构。`2.0.0` 不是 `1.x` 的参数调整。
- minor：同一套架构下，改变会改变文本或向量的处理逻辑，例如清洗策略、
  分块策略、是否拼标题/上下文。
- patch：同一套逻辑下只改参数，例如 chunk 目标长度、最大长度、重叠长度；
  这些会让同一段字幕切出不同块，必须升 patch。
- `b`/`c`：还在对比验证的候选版本，不能作为生产默认版本；验证通过后
  去掉字母，写入正式版本。

当前生产版本是 1.1.0：在 1.0.0 的 bge-m3 / halfvec / chunk-v1 基础上，
把进入向量库的文本从旧清洗换成 `light-v1` 的 `vector_safe`。
"""

from __future__ import annotations

import re
from typing import Any

# 生产默认版本。所有新写入的 chunk 必须带这个版本。
VECTOR_VERSION = "1.1.0"

# 没有版本字段之前已经入库的存量。新代码不能把它当作当前版本。
VECTOR_VERSION_LEGACY = "1.0.0"

# 三段式 + 可选的小写测试后缀 b/c。不允许 v 前缀、空格、斜杠。
VERSION_PATTERN = re.compile(r"^(?P<major>[1-9]\d*)\.(?P<minor>\d+)\.(?P<patch>\d+)(?P<label>[bc])?$")

# 版本清单是审计依据，不只是注释。每次升版本都要同步改这里。
VECTOR_VERSION_MANIFEST: dict[str, dict[str, Any]] = {
    "1.0.0": {
        "status": "legacy",
        "embedding_model": "bge-m3",
        "embedding_dim": 1024,
        "storage": "halfvec",
        "chunker": "chunk-v1",
        "chunk_params": {
            "target_chars": 400,
            "max_chars": 600,
            "min_chars": 150,
            "overlap_chars": 60,
        },
        "cleaning": "legacy/no vector_safe",
    },
    "1.1.0": {
        "status": "production",
        "embedding_model": "bge-m3",
        "embedding_dim": 1024,
        "storage": "halfvec",
        "chunker": "chunk-v1",
        "chunk_params": {
            "target_chars": 400,
            "max_chars": 600,
            "min_chars": 150,
            "overlap_chars": 60,
        },
        "cleaning": "light-v1/vector_safe",
    },
}


def parse_version(version: str) -> dict[str, Any]:
    """解析并校验版本号；非法版本直接抛 ValueError，避免脏版本静默入库。"""
    match = VERSION_PATTERN.match((version or "").strip())
    if not match:
        raise ValueError(f"非法向量版本号: {version!r}，要求 major.minor.patch，可选 b/c 后缀")
    return {
        "major": int(match.group("major")),
        "minor": int(match.group("minor")),
        "patch": int(match.group("patch")),
        "label": match.group("label") or "",
        "version": version,
        "is_prerelease": bool(match.group("label")),
    }


def version_manifest(version: str = VECTOR_VERSION) -> dict[str, Any]:
    """返回某个版本的完整定义。未登记的版本视为配置错误。"""
    parse_version(version)
    if version not in VECTOR_VERSION_MANIFEST:
        raise ValueError(f"向量版本未登记: {version}")
    return VECTOR_VERSION_MANIFEST[version]


def version_components_text(version: str = VECTOR_VERSION) -> str:
    info = version_manifest(version)
    return (
        f"{version} | model={info['embedding_model']} dim={info['embedding_dim']} "
        f"storage={info['storage']} chunker={info['chunker']} cleaning={info['cleaning']}"
    )


# 模块导入时自检：当前默认版本必须在清单里，且必须是正式版本。
parse_version(VECTOR_VERSION)
if VECTOR_VERSION not in VECTOR_VERSION_MANIFEST:
    raise RuntimeError(f"VECTOR_VERSION={VECTOR_VERSION} 未登记在 VECTOR_VERSION_MANIFEST")
if VECTOR_VERSION_MANIFEST[VECTOR_VERSION].get("status") != "production":
    raise RuntimeError(f"VECTOR_VERSION={VECTOR_VERSION} 不是 production，不能作为默认版本")
