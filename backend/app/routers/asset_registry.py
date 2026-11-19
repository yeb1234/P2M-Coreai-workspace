"""配置资产版本库接口（管理员）。

路由统一挂在 /api/asset-registry，由 require_admin 保护；前端设置页
“配置资产版本库”只对管理员显示，避免普通用户改运行时提示词。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.asset_schemas import (
    BranchRequest,
    CommitRequest,
    ImportWorkingRequest,
    MergeRequest,
    PublishRequest,
    RollbackRequest,
    TagRequest,
)
from app.auth import require_admin
from app.database import get_db
from app.models import User
from app.services import asset_registry as registry

router = APIRouter(
    prefix="/api/asset-registry",
    tags=["asset-registry"],
    dependencies=[Depends(require_admin)],
)


def _fail(exc: registry.AssetRegistryError) -> HTTPException:
    detail = {"message": str(exc)}
    if exc.detail:
        detail["context"] = exc.detail
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.get("/repos")
def list_repositories(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    return {"repos": [registry.repo_summary(db, repo)]}


@router.get("/repos/{slug}")
def get_repository(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    if repo.slug != slug:
        raise HTTPException(status_code=404, detail={"message": "版本库不存在"})
    return registry.repo_summary(db, repo)


@router.get("/repos/{slug}/commits")
def get_commits(
    slug: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    return {"commits": registry.list_commits(db, repo, limit)}


@router.get("/repos/{slug}/tree")
def get_tree(
    slug: str,
    ref: str = "main",
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        commit_hash = registry.resolve_ref(db, repo, ref)
        return {"ref": ref, "commit": commit_hash, "entries": registry.tree_view(db, repo, ref)}
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.get("/repos/{slug}/file")
def get_file(
    slug: str,
    path: str,
    ref: str = "main",
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        return registry.file_view(db, repo, path, ref)
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.get("/repos/{slug}/diff")
def get_diff(
    slug: str,
    from_ref: str = Query(..., alias="from"),
    to_ref: str = Query(..., alias="to"),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        return registry.diff_commits(db, repo, from_ref, to_ref)
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.get("/repos/{slug}/working-status")
def get_working_status(
    slug: str,
    branch: str = "main",
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        return registry.working_status(db, repo, branch)
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/commits")
def post_commit(
    slug: str,
    payload: CommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        commit = registry.create_commit(
            db,
            repo,
            branch_name=payload.branch,
            message=payload.message,
            changes=[change.model_dump() for change in payload.changes],
            actor=user,
            base_commit=payload.base_commit,
        )
        return {"commit": registry.commit_dict(commit)}
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/branches")
def post_branch(
    slug: str,
    payload: BranchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        branch = registry.create_branch(db, repo, payload.name, payload.from_ref, user)
        return {"name": branch.name, "head": branch.head_hash}
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/tags")
def post_tag(
    slug: str,
    payload: TagRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        tag = registry.create_tag(db, repo, payload.name, payload.ref, payload.message, user)
        return {"name": tag.name, "commit": tag.commit_hash}
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/merge")
def post_merge(
    slug: str,
    payload: MergeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        return registry.merge_branches(
            db,
            repo,
            source=payload.source,
            target=payload.target,
            message=payload.message,
            actor=user,
        )
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/rollback")
def post_rollback(
    slug: str,
    payload: RollbackRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        commit = registry.rollback_branch(
            db,
            repo,
            branch_name=payload.branch,
            target_ref=payload.target_ref,
            message=payload.message,
            actor=user,
        )
        return {"commit": registry.commit_dict(commit)}
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/publish")
def post_publish(
    slug: str,
    payload: PublishRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        return registry.publish_commit(
            db,
            repo,
            commit_hash=payload.commit_hash,
            branch_name=payload.branch,
            actor=user,
        )
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.post("/repos/{slug}/import-working")
def post_import_working(
    slug: str,
    payload: ImportWorkingRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    try:
        commit = registry.import_working_copy(
            db,
            repo,
            branch_name=payload.branch,
            message=payload.message,
            actor=user,
        )
        return {"commit": registry.commit_dict(commit)}
    except registry.AssetRegistryError as exc:
        raise _fail(exc) from exc


@router.get("/repos/{slug}/audit")
def get_audit(
    slug: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    repo = registry.ensure_repository(db, user)
    return {"events": registry.audit_events(db, repo, limit)}

