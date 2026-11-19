"""配置资产版本库：PostgreSQL-native Git。

设计边界：
- 只管理 configs/manifest.yaml 里列出的文本资产，避免页面误改代码或 .env；
- 提交图是单/双父的有向图，支持分支、标签、diff、合并、回滚；
- 发布是把指定提交的树原子写回 configs/ 工作区，并刷新运行时缓存；
- 所有写操作落 asset_audit_events，便于追责和对比 6.0 / 7.0 行为。

不引入外部 Git 服务，也不把 API Key / DSN 写进版本库。
"""

from __future__ import annotations

import difflib
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import yaml
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.models import (
    AssetAuditEvent,
    AssetBlob,
    AssetBranch,
    AssetCommit,
    AssetEntry,
    AssetPublication,
    AssetRepository,
    AssetTag,
)
from app.services.runtime_config import configs_root, reload_runtime_config

logger = logging.getLogger(__name__)

_DEFAULT_REPO = {
    "slug": "siteyeb-config",
    "name": "SiteYeb 运行时配置",
    "default_branch": "main",
    "description": "提示词、检索、向量、LLM 路由、数据库与工具治理的统一版本库",
}
_MAX_BLOB_BYTES = 2 * 1024 * 1024
_BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$")
_TAG_RE = re.compile(r"^v?[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


class AssetRegistryError(Exception):
    """版本库业务错误，router 统一转换成 4xx。"""

    def __init__(self, message: str, status_code: int = 400, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


@lru_cache(maxsize=1)
def _load_manifest() -> dict[str, Any]:
    path = configs_root() / "manifest.yaml"
    if not path.exists():
        raise AssetRegistryError(f"资产清单不存在: {path}", 500)
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise AssetRegistryError("manifest.yaml 顶层必须是对象", 500)
    return data


def reload_manifest() -> None:
    _load_manifest.cache_clear()


def manifest_repo() -> dict[str, Any]:
    repo = _load_manifest().get("repo") or {}
    return {**_DEFAULT_REPO, **repo}


def manifest_assets() -> list[dict[str, Any]]:
    assets = _load_manifest().get("assets") or []
    if not isinstance(assets, list):
        raise AssetRegistryError("manifest.yaml assets 必须是列表", 500)
    result = []
    for item in assets:
        if not isinstance(item, dict) or not item.get("path"):
            continue
        result.append(
            {
                "path": _clean_path(str(item["path"]))[0],
                "category": str(item.get("category") or "other"),
                "title": str(item.get("title") or item["path"]),
                "editable": bool(item.get("editable", True)),
            }
        )
    return result


def _clean_path(path: str) -> tuple[str, Path]:
    """只做路径合法性/越界校验，不查 manifest 白名单。"""
    raw = (path or "").replace("\\", "/").strip()
    if not raw:
        raise AssetRegistryError("资产路径不能为空")
    pure = PurePosixPath(raw)
    if pure.is_absolute() or ".." in pure.parts or raw.startswith("/"):
        raise AssetRegistryError(f"非法资产路径: {path}", 400)
    normalized = str(pure)
    root = configs_root().resolve()
    target = (root / normalized).resolve()
    if root != target and root not in target.parents:
        raise AssetRegistryError(f"资产越界: {normalized}", 400)
    return normalized, target


def _normalize_path(path: str, *, allow_new: bool = False) -> tuple[str, Path]:
    normalized, target = _clean_path(path)
    allowed = {item["path"] for item in manifest_assets()}
    if normalized not in allowed and not allow_new:
        raise AssetRegistryError(f"资产不在 manifest 白名单: {normalized}", 403)
    return normalized, target


def _read_disk_asset(path: str) -> str:
    _, target = _normalize_path(path)
    if not target.exists():
        raise AssetRegistryError(f"工作区文件不存在: {path}", 404)
    try:
        return target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise AssetRegistryError(f"资产必须是 UTF-8 文本: {path}", 400) from exc


def _hash_content(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _canonical_tree(entries: dict[str, dict[str, Any]]) -> str:
    lines = [
        f"{path}\0{entry['blob_hash']}\0{entry.get('mode', '100644')}"
        for path, entry in sorted(entries.items())
    ]
    return _hash_content("\n".join(lines))


def _tree_hash_from_db(db: Session, commit_hash: str) -> str:
    commit = db.query(AssetCommit).filter(AssetCommit.hash == commit_hash).first()
    if commit:
        return commit.tree_hash
    raise AssetRegistryError("提交不存在", 404)


def _tree_snapshot(db: Session, commit_hash: str | None) -> dict[str, dict[str, Any]]:
    if not commit_hash:
        return {}
    rows = db.query(AssetEntry).filter(AssetEntry.commit_hash == commit_hash).all()
    return {
        row.path: {"blob_hash": row.blob_hash, "size": row.size, "mode": row.mode}
        for row in rows
    }


def _blob_content(db: Session, blob_hash: str) -> str:
    blob = db.query(AssetBlob).filter(AssetBlob.hash == blob_hash).first()
    return blob.content if blob else ""


def _tree_contents(db: Session, commit_hash: str | None) -> dict[str, str]:
    snapshot = _tree_snapshot(db, commit_hash)
    return {path: _blob_content(db, entry["blob_hash"]) for path, entry in snapshot.items()}


def _put_blob(db: Session, content: str) -> tuple[str, int]:
    if len(content.encode("utf-8")) > _MAX_BLOB_BYTES:
        raise AssetRegistryError(f"单个资产超过 {_MAX_BLOB_BYTES // 1024}KB 上限", 413)
    digest = _hash_content(content)
    size = len(content.encode("utf-8"))
    existing = db.query(AssetBlob).filter(AssetBlob.hash == digest).first()
    if existing:
        return digest, existing.size
    db.add(AssetBlob(hash=digest, size=size, content=content))
    db.flush()
    return digest, size


def _get_repo(db: Session, slug: str) -> AssetRepository:
    repo = db.query(AssetRepository).filter(AssetRepository.slug == slug).first()
    if not repo:
        raise AssetRegistryError(f"版本库不存在: {slug}", 404)
    return repo


def _get_branch(db: Session, repo: AssetRepository, name: str) -> AssetBranch:
    branch = (
        db.query(AssetBranch)
        .filter(AssetBranch.repo_id == repo.id, AssetBranch.name == name)
        .first()
    )
    if not branch:
        raise AssetRegistryError(f"分支不存在: {name}", 404)
    return branch


def resolve_ref(db: Session, repo: AssetRepository, ref: str) -> str:
    """把 ref 解析成 commit hash：分支 → 标签 → 前缀 hash。"""
    ref = (ref or "").strip()
    if not ref:
        raise AssetRegistryError("ref 不能为空")
    branch = (
        db.query(AssetBranch)
        .filter(AssetBranch.repo_id == repo.id, AssetBranch.name == ref)
        .first()
    )
    if branch and branch.head_hash:
        return branch.head_hash
    tag = (
        db.query(AssetTag)
        .filter(AssetTag.repo_id == repo.id, AssetTag.name == ref)
        .first()
    )
    if tag:
        return tag.commit_hash
    commit = (
        db.query(AssetCommit)
        .filter(
            AssetCommit.repo_id == repo.id,
            or_(AssetCommit.hash == ref, AssetCommit.hash.startswith(ref)),
        )
        .order_by(AssetCommit.created_at.desc())
        .first()
    )
    if commit:
        return commit.hash
    raise AssetRegistryError(f"无法解析 ref: {ref}", 404)


def _new_commit_hash(
    repo: AssetRepository,
    parent_hash: str | None,
    tree_hash: str,
    message: str,
    author_name: str,
    created_at: datetime,
) -> str:
    payload = "\0".join(
        [
            repo.slug,
            parent_hash or "",
            tree_hash,
            message,
            author_name,
            created_at.isoformat(),
            uuid.uuid4().hex,
        ]
    )
    return _hash_content(payload)


def _insert_commit(
    db: Session,
    repo: AssetRepository,
    *,
    parent_hash: str | None,
    parent2_hash: str | None,
    tree: dict[str, dict[str, Any]],
    message: str,
    actor_id: int | None,
    actor_name: str,
    kind: str,
) -> AssetCommit:
    tree_hash = _canonical_tree(tree)
    created_at = datetime.now()
    commit_hash = _new_commit_hash(repo, parent_hash, tree_hash, message, actor_name, created_at)
    commit = AssetCommit(
        hash=commit_hash,
        repo_id=repo.id,
        parent_hash=parent_hash,
        parent2_hash=parent2_hash,
        tree_hash=tree_hash,
        message=message,
        author_id=actor_id,
        author_name=actor_name,
        kind=kind,
        created_at=created_at,
    )
    db.add(commit)
    db.flush()
    for path, entry in sorted(tree.items()):
        db.add(
            AssetEntry(
                commit_hash=commit_hash,
                path=path,
                blob_hash=entry["blob_hash"],
                mode=entry.get("mode", "100644"),
                size=int(entry.get("size") or 0),
            )
        )
    return commit


def _audit(
    db: Session,
    repo: AssetRepository,
    action: str,
    actor: Any | None,
    detail: dict[str, Any] | None = None,
) -> None:
    db.add(
        AssetAuditEvent(
            repo_id=repo.id,
            action=action,
            actor_id=getattr(actor, "id", None),
            actor_name=getattr(actor, "username", None) or "system",
            detail=detail or {},
        )
    )


def ensure_repository(db: Session, actor: Any | None = None) -> AssetRepository:
    """首次访问时按 manifest 与工作区文件建立基线提交。"""
    meta = manifest_repo()
    repo = db.query(AssetRepository).filter(AssetRepository.slug == meta["slug"]).first()
    if repo:
        return repo

    repo = AssetRepository(
        slug=meta["slug"],
        name=meta["name"],
        description=meta.get("description", ""),
        default_branch=meta.get("default_branch", "main"),
    )
    db.add(repo)
    db.flush()

    tree: dict[str, dict[str, Any]] = {}
    for asset in manifest_assets():
        try:
            content = _read_disk_asset(asset["path"])
        except AssetRegistryError:
            logger.warning("基线资产缺失，跳过: %s", asset["path"])
            continue
        digest, size = _put_blob(db, content)
        tree[asset["path"]] = {"blob_hash": digest, "size": size, "mode": "100644"}

    commit = _insert_commit(
        db,
        repo,
        parent_hash=None,
        parent2_hash=None,
        tree=tree,
        message="chore(config): 建立 7.0 配置基线",
        actor_id=getattr(actor, "id", None),
        actor_name=getattr(actor, "username", "system") if actor else "system",
        kind="seed",
    )
    db.add(
        AssetBranch(
            repo_id=repo.id,
            name=repo.default_branch,
            head_hash=commit.hash,
            is_default=True,
            protected=True,
        )
    )
    _audit(db, repo, "seed", actor, {"commit": commit.hash, "files": len(tree)})
    db.commit()
    db.refresh(repo)
    return repo


def repo_summary(db: Session, repo: AssetRepository) -> dict[str, Any]:
    branches = (
        db.query(AssetBranch)
        .filter(AssetBranch.repo_id == repo.id)
        .order_by(desc(AssetBranch.is_default), AssetBranch.name)
        .all()
    )
    tags = (
        db.query(AssetTag)
        .filter(AssetTag.repo_id == repo.id)
        .order_by(desc(AssetTag.created_at))
        .limit(20)
        .all()
    )
    latest = (
        db.query(AssetCommit)
        .filter(AssetCommit.repo_id == repo.id)
        .order_by(desc(AssetCommit.created_at))
        .first()
    )
    return {
        "slug": repo.slug,
        "name": repo.name,
        "description": repo.description,
        "default_branch": repo.default_branch,
        "branches": [
            {
                "name": b.name,
                "head": b.head_hash,
                "is_default": b.is_default,
                "protected": b.protected,
                "updated_at": b.updated_at.isoformat() if b.updated_at else None,
            }
            for b in branches
        ],
        "tags": [
            {
                "name": t.name,
                "commit": t.commit_hash,
                "message": t.message,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tags
        ],
        "latest_commit": commit_dict(latest) if latest else None,
        "assets_count": len(manifest_assets()),
    }


def commit_dict(commit: AssetCommit | None) -> dict[str, Any] | None:
    if not commit:
        return None
    return {
        "hash": commit.hash,
        "short_hash": commit.hash[:10],
        "parent": commit.parent_hash,
        "parent2": commit.parent2_hash,
        "tree": commit.tree_hash,
        "message": commit.message,
        "author": commit.author_name,
        "kind": commit.kind,
        "created_at": commit.created_at.isoformat() if commit.created_at else None,
    }


def list_commits(db: Session, repo: AssetRepository, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        db.query(AssetCommit)
        .filter(AssetCommit.repo_id == repo.id)
        .order_by(desc(AssetCommit.created_at))
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [commit_dict(row) for row in rows if row]


def tree_view(db: Session, repo: AssetRepository, ref: str) -> list[dict[str, Any]]:
    commit_hash = resolve_ref(db, repo, ref)
    snapshot = _tree_snapshot(db, commit_hash)
    manifest_map = {item["path"]: item for item in manifest_assets()}
    rows = []
    for path, entry in sorted(snapshot.items()):
        meta = manifest_map.get(path, {"category": "other", "title": path, "editable": False})
        rows.append(
            {
                "path": path,
                "category": meta["category"],
                "title": meta["title"],
                "editable": meta["editable"],
                "blob": entry["blob_hash"],
                "size": entry["size"],
                "mode": entry["mode"],
            }
        )
    return rows


def file_view(
    db: Session, repo: AssetRepository, path: str, ref: str
) -> dict[str, Any]:
    normalized, _ = _normalize_path(path)
    commit_hash = resolve_ref(db, repo, ref)
    entry = (
        db.query(AssetEntry)
        .filter(AssetEntry.commit_hash == commit_hash, AssetEntry.path == normalized)
        .first()
    )
    if not entry:
        raise AssetRegistryError(f"该提交中没有资产: {normalized}", 404)
    return {
        "path": normalized,
        "ref": ref,
        "commit": commit_hash,
        "blob": entry.blob_hash,
        "size": entry.size,
        "content": _blob_content(db, entry.blob_hash),
    }


def create_commit(
    db: Session,
    repo: AssetRepository,
    *,
    branch_name: str,
    message: str,
    changes: Iterable[dict[str, Any]],
    actor: Any,
    base_commit: str | None = None,
    kind: str = "commit",
    parent2_hash: str | None = None,
    allow_empty: bool = False,
    commit_tree_override: dict[str, dict[str, Any]] | None = None,
) -> AssetCommit:
    branch = _get_branch(db, repo, branch_name)
    parent_hash = branch.head_hash
    if base_commit:
        resolved_base = resolve_ref(db, repo, base_commit)
        if resolved_base != parent_hash:
            raise AssetRegistryError(
                "分支头已变化，请刷新后再提交，避免覆盖别人的修改", 409,
                {"current_head": parent_hash, "base": resolved_base},
            )

    if commit_tree_override is not None:
        tree = commit_tree_override
    else:
        tree = _tree_snapshot(db, parent_hash)
        changed_paths: list[str] = []
        for change in changes:
            path, _ = _normalize_path(str(change.get("path") or ""))
            if change.get("deleted"):
                tree.pop(path, None)
                changed_paths.append(path)
                continue
            content = str(change.get("content") or "")
            digest, size = _put_blob(db, content)
            previous = tree.get(path)
            if previous and previous["blob_hash"] == digest:
                continue
            tree[path] = {"blob_hash": digest, "size": size, "mode": "100644"}
            changed_paths.append(path)
        if not changed_paths and not allow_empty:
            raise AssetRegistryError("没有变更，未创建提交", 400)

    if not message.strip():
        raise AssetRegistryError("提交说明不能为空")
    commit = _insert_commit(
        db,
        repo,
        parent_hash=parent_hash,
        parent2_hash=parent2_hash,
        tree=tree,
        message=message.strip()[:2000],
        actor_id=getattr(actor, "id", None),
        actor_name=getattr(actor, "username", "unknown"),
        kind=kind,
    )
    branch.head_hash = commit.hash
    branch.updated_at = datetime.now()
    _audit(
        db,
        repo,
        "commit",
        actor,
        {"branch": branch_name, "commit": commit.hash, "message": commit.message},
    )
    db.commit()
    return commit


def create_branch(
    db: Session, repo: AssetRepository, name: str, from_ref: str, actor: Any
) -> AssetBranch:
    if not _BRANCH_RE.match(name or ""):
        raise AssetRegistryError("分支名不合法")
    existing = (
        db.query(AssetBranch)
        .filter(AssetBranch.repo_id == repo.id, AssetBranch.name == name)
        .first()
    )
    if existing:
        raise AssetRegistryError("分支已存在", 409)
    commit_hash = resolve_ref(db, repo, from_ref)
    branch = AssetBranch(repo_id=repo.id, name=name, head_hash=commit_hash)
    db.add(branch)
    _audit(db, repo, "branch", actor, {"name": name, "from": commit_hash})
    db.commit()
    return branch


def create_tag(
    db: Session, repo: AssetRepository, name: str, ref: str, message: str, actor: Any
) -> AssetTag:
    if not _TAG_RE.match(name or ""):
        raise AssetRegistryError("标签名不合法")
    existing = (
        db.query(AssetTag)
        .filter(AssetTag.repo_id == repo.id, AssetTag.name == name)
        .first()
    )
    if existing:
        raise AssetRegistryError("标签已存在", 409)
    commit_hash = resolve_ref(db, repo, ref)
    tag = AssetTag(
        repo_id=repo.id,
        name=name,
        commit_hash=commit_hash,
        message=message or None,
        created_by=getattr(actor, "id", None),
    )
    db.add(tag)
    _audit(db, repo, "tag", actor, {"name": name, "commit": commit_hash})
    db.commit()
    return tag


def diff_commits(
    db: Session, repo: AssetRepository, from_ref: str, to_ref: str
) -> dict[str, Any]:
    left_hash = resolve_ref(db, repo, from_ref)
    right_hash = resolve_ref(db, repo, to_ref)
    left = _tree_contents(db, left_hash)
    right = _tree_contents(db, right_hash)
    paths = sorted(set(left) | set(right))
    entries = []
    total_additions = 0
    total_deletions = 0
    for path in paths:
        old = left.get(path)
        new = right.get(path)
        if old == new:
            continue
        entry_additions = 0
        entry_deletions = 0
        if old is None:
            status = "added"
            patch = "".join(
                difflib.unified_diff(
                    [], new.splitlines(keepends=True), fromfile="/dev/null", tofile=f"b/{path}"
                )
            )
            entry_additions = len(new.splitlines())
        elif new is None:
            status = "deleted"
            patch = "".join(
                difflib.unified_diff(
                    old.splitlines(keepends=True), [], fromfile=f"a/{path}", tofile="/dev/null"
                )
            )
            entry_deletions = len(old.splitlines())
        else:
            status = "modified"
            patch = "".join(
                difflib.unified_diff(
                    old.splitlines(keepends=True),
                    new.splitlines(keepends=True),
                    fromfile=f"a/{path}",
                    tofile=f"b/{path}",
                )
            )
            entry_additions = sum(
                1 for line in patch.splitlines() if line.startswith("+") and not line.startswith("+++")
            )
            entry_deletions = sum(
                1 for line in patch.splitlines() if line.startswith("-") and not line.startswith("---")
            )
        total_additions += entry_additions
        total_deletions += entry_deletions
        entries.append(
            {
                "path": path,
                "status": status,
                "additions": entry_additions,
                "deletions": entry_deletions,
                # 前端只渲染文本 diff；超过 400 行截断，避免一个提交撑爆页面。
                "patch": "\n".join(patch.splitlines()[:400]),
                "truncated": len(patch.splitlines()) > 400,
            }
        )
    return {
        "from": {"ref": from_ref, "commit": left_hash},
        "to": {"ref": to_ref, "commit": right_hash},
        "entries": entries,
        "stats": {"files": len(entries), "additions": total_additions, "deletions": total_deletions},
    }


def _ancestors(db: Session, repo: AssetRepository, start: str | None) -> set[str]:
    seen: set[str] = set()
    stack = [start] if start else []
    while stack:
        current = stack.pop()
        if not current or current in seen:
            continue
        seen.add(current)
        commit = (
            db.query(AssetCommit)
            .filter(AssetCommit.repo_id == repo.id, AssetCommit.hash == current)
            .first()
        )
        if not commit:
            continue
        if commit.parent_hash:
            stack.append(commit.parent_hash)
        if commit.parent2_hash:
            stack.append(commit.parent2_hash)
    return seen


def merge_branches(
    db: Session,
    repo: AssetRepository,
    *,
    source: str,
    target: str,
    message: str,
    actor: Any,
) -> dict[str, Any]:
    source_branch = _get_branch(db, repo, source)
    target_branch = _get_branch(db, repo, target)
    source_hash = source_branch.head_hash
    target_hash = target_branch.head_hash
    if not source_hash or not target_hash:
        raise AssetRegistryError("分支还没有提交", 400)
    if source_hash == target_hash:
        return {"status": "already_up_to_date", "commit": target_hash}

    source_ancestors = _ancestors(db, repo, source_hash)
    target_ancestors = _ancestors(db, repo, target_hash)
    common = source_ancestors & target_ancestors
    if not common:
        raise AssetRegistryError("两个分支没有共同祖先，拒绝合并", 409)
    # 取目标侧最近的公共祖先
    base_hash = next(
        (
            c.hash
            for c in db.query(AssetCommit)
            .filter(AssetCommit.repo_id == repo.id, AssetCommit.hash.in_(common))
            .order_by(desc(AssetCommit.created_at))
            .all()
        ),
        None,
    )

    base = _tree_contents(db, base_hash)
    ours = _tree_contents(db, target_hash)
    theirs = _tree_contents(db, source_hash)
    resolved: dict[str, str | None] = {}
    conflicts: list[str] = []
    for path in sorted(set(base) | set(ours) | set(theirs)):
        base_v, ours_v, theirs_v = base.get(path), ours.get(path), theirs.get(path)
        if ours_v == theirs_v:
            resolved[path] = ours_v
        elif base_v == ours_v:
            resolved[path] = theirs_v
        elif base_v == theirs_v:
            resolved[path] = ours_v
        else:
            conflicts.append(path)
    if conflicts:
        raise AssetRegistryError(
            "存在冲突，未执行合并。请先人工解决冲突路径",
            409,
            {"conflicts": conflicts, "base": base_hash},
        )

    tree: dict[str, dict[str, Any]] = {}
    for path, content in resolved.items():
        if content is None:
            continue
        digest, size = _put_blob(db, content)
        tree[path] = {"blob_hash": digest, "size": size, "mode": "100644"}
    commit = create_commit(
        db,
        repo,
        branch_name=target,
        message=message or f"merge {source} into {target}",
        changes=[],
        actor=actor,
        kind="merge",
        parent2_hash=source_hash,
        allow_empty=True,
        commit_tree_override=tree,
    )
    return {
        "status": "merged",
        "commit": commit.hash,
        "parents": [target_hash, source_hash],
        "base": base_hash,
    }


def rollback_branch(
    db: Session,
    repo: AssetRepository,
    *,
    branch_name: str,
    target_ref: str,
    message: str,
    actor: Any,
) -> AssetCommit:
    target_hash = resolve_ref(db, repo, target_ref)
    target_tree = _tree_snapshot(db, target_hash)
    return create_commit(
        db,
        repo,
        branch_name=branch_name,
        message=message or f"rollback {branch_name} to {target_ref}",
        changes=[],
        actor=actor,
        kind="rollback",
        allow_empty=True,
        commit_tree_override=target_tree,
    )


def working_status(db: Session, repo: AssetRepository, branch_name: str = "main") -> dict[str, Any]:
    branch = _get_branch(db, repo, branch_name)
    head = _tree_contents(db, branch.head_hash)
    rows = []
    for asset in manifest_assets():
        try:
            disk = _read_disk_asset(asset["path"])
        except AssetRegistryError:
            disk = None
        committed = head.get(asset["path"])
        if disk is None and committed is None:
            continue
        if disk == committed:
            continue
        rows.append(
            {
                "path": asset["path"],
                "category": asset["category"],
                "status": "added" if committed is None else "deleted" if disk is None else "modified",
                "disk_size": len(disk.encode("utf-8")) if disk is not None else 0,
                "committed_size": len(committed.encode("utf-8")) if committed is not None else 0,
            }
        )
    return {
        "branch": branch_name,
        "head": branch.head_hash,
        "dirty": bool(rows),
        "changes": rows,
    }


def import_working_copy(
    db: Session, repo: AssetRepository, *, branch_name: str, message: str, actor: Any
) -> AssetCommit:
    changes = []
    for asset in manifest_assets():
        try:
            changes.append({"path": asset["path"], "content": _read_disk_asset(asset["path"])})
        except AssetRegistryError:
            changes.append({"path": asset["path"], "deleted": True})
    return create_commit(
        db,
        repo,
        branch_name=branch_name,
        message=message,
        changes=changes,
        actor=actor,
    )


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp.write_text(content, encoding="utf-8")
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink(missing_ok=True)


def publish_commit(
    db: Session,
    repo: AssetRepository,
    *,
    commit_hash: str,
    branch_name: str | None,
    actor: Any,
) -> dict[str, Any]:
    commit = (
        db.query(AssetCommit)
        .filter(AssetCommit.repo_id == repo.id, AssetCommit.hash == commit_hash)
        .first()
    )
    if not commit:
        raise AssetRegistryError("要发布的提交不存在", 404)
    contents = _tree_contents(db, commit_hash)
    manifest_map = {item["path"]: item for item in manifest_assets()}
    written: list[str] = []
    for path, content in contents.items():
        if path not in manifest_map:
            raise AssetRegistryError(f"提交中包含未纳管资产，拒绝发布: {path}", 403)
        _, target = _normalize_path(path)
        _atomic_write(target, content)
        written.append(path)

    reload_runtime_config()
    reload_manifest()
    try:
        from app.services.prompts import reload_runtime_prompts

        reload_runtime_prompts()
    except Exception:  # noqa: BLE001
        logger.warning("提示词模块热加载失败；发布已落盘，重启 backend 后生效", exc_info=True)

    publication = AssetPublication(
        repo_id=repo.id,
        commit_hash=commit_hash,
        branch=branch_name,
        status="published",
        files_count=len(written),
        actor_id=getattr(actor, "id", None),
        detail={"files": written, "hot_reload": True},
    )
    db.add(publication)
    _audit(
        db,
        repo,
        "publish",
        actor,
        {"commit": commit_hash, "branch": branch_name, "files": written},
    )
    db.commit()
    return {
        "status": "published",
        "commit": commit_hash,
        "branch": branch_name,
        "files": written,
        "publication_id": publication.id,
        "note": "检索/向量/LLM/治理参数已热刷新；连接池与部分 worker 缓存需重启后生效",
    }


def audit_events(db: Session, repo: AssetRepository, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        db.query(AssetAuditEvent)
        .filter(AssetAuditEvent.repo_id == repo.id)
        .order_by(desc(AssetAuditEvent.created_at))
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [
        {
            "id": row.id,
            "action": row.action,
            "actor": row.actor_name,
            "detail": row.detail,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]

