"""配置资产版本库核心链路测试。

不碰生产 PostgreSQL / 工作区文件：用内存 SQLite 建表，只验证
提交图、分支、diff、合并、标签与回滚的语义。
"""

from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import AssetCommit  # noqa: F401  确保 metadata 注册
from app.services import asset_registry as registry


def _session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def _actor(name: str = "tester"):
    return SimpleNamespace(id=1, username=name)


def test_seed_commit_and_diff():
    db = _session()
    repo = registry.ensure_repository(db, _actor())
    commits = registry.list_commits(db, repo)
    assert commits
    assert commits[-1]["kind"] in {"seed"}
    assert repo.default_branch == "main"

    seed_hash = registry.resolve_ref(db, repo, "main")
    content = registry._read_disk_asset("retrieval.yaml")
    updated = content.replace("rrf_k: 60", "rrf_k: 70")
    commit = registry.create_commit(
        db,
        repo,
        branch_name="main",
        message="tune: rrf k 70",
        changes=[{"path": "retrieval.yaml", "content": updated}],
        actor=_actor(),
    )
    assert commit.parent_hash == seed_hash
    assert commit.tree_hash != registry.resolve_ref(db, repo, seed_hash)

    diff = registry.diff_commits(db, repo, seed_hash, commit.hash)
    assert diff["stats"]["files"] == 1
    assert diff["entries"][0]["path"] == "retrieval.yaml"
    assert "rrf_k: 70" in diff["entries"][0]["patch"]


def test_branch_tag_merge_and_rollback():
    db = _session()
    repo = registry.ensure_repository(db, _actor())
    base = registry.resolve_ref(db, repo, "main")
    registry.create_branch(db, repo, "feat/retrieval", "main", _actor())
    registry.create_tag(db, repo, "v7.0.0-base", "main", "baseline", _actor())

    retrieval = registry._read_disk_asset("retrieval.yaml")
    feature_commit = registry.create_commit(
        db,
        repo,
        branch_name="feat/retrieval",
        message="feat: feature branch change",
        changes=[{"path": "retrieval.yaml", "content": retrieval + "\n# feature\n"}],
        actor=_actor(),
    )
    assert feature_commit.parent_hash == base

    registry.create_commit(
        db,
        repo,
        branch_name="main",
        message="fix: main change",
        changes=[{"path": "governance.yaml", "content": registry._read_disk_asset("governance.yaml") + "\n# main\n"}],
        actor=_actor(),
    )

    merged = registry.merge_branches(
        db,
        repo,
        source="feat/retrieval",
        target="main",
        message="merge feature",
        actor=_actor(),
    )
    assert merged["status"] == "merged"
    main_tree = registry.tree_view(db, repo, "main")
    retr = next(item for item in main_tree if item["path"] == "retrieval.yaml")
    base_tree = registry.tree_view(db, repo, base)
    base_retr = next(item for item in base_tree if item["path"] == "retrieval.yaml")
    assert retr["blob"] != base_retr["blob"]

    rollback = registry.rollback_branch(
        db,
        repo,
        branch_name="main",
        target_ref="v7.0.0-base",
        message="rollback to base",
        actor=_actor(),
    )
    assert rollback.kind == "rollback"
    # 回滚后用 base 的树，但历史继续向前，原提交仍可解析
    assert registry.resolve_ref(db, repo, rollback.hash) == rollback.hash
    assert registry.resolve_ref(db, repo, "v7.0.0-base") == base


def test_merge_conflict_is_rejected():
    db = _session()
    repo = registry.ensure_repository(db, _actor())
    registry.create_branch(db, repo, "feat/conflict", "main", _actor())

    registry.create_commit(
        db,
        repo,
        branch_name="feat/conflict",
        message="feat change",
        changes=[{"path": "llm.yaml", "content": registry._read_disk_asset("llm.yaml") + "\n# feat\n"}],
        actor=_actor(),
    )
    registry.create_commit(
        db,
        repo,
        branch_name="main",
        message="main change",
        changes=[{"path": "llm.yaml", "content": registry._read_disk_asset("llm.yaml") + "\n# main\n"}],
        actor=_actor(),
    )
    try:
        registry.merge_branches(
            db,
            repo,
            source="feat/conflict",
            target="main",
            message="should conflict",
            actor=_actor(),
        )
    except registry.AssetRegistryError as exc:
        assert exc.status_code == 409
        assert any("llm.yaml" in item for item in exc.detail["conflicts"])
        return
    raise AssertionError("expected merge conflict")
