"""config asset registry (db-native git)

7.0 的配置资产版本库：内容快照、提交图、分支、标签、发布与审计。
只存 configs/ 白名单内的文本资产，不存密钥。

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-11-21 01:00:00+08:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_repositories (
            id SERIAL PRIMARY KEY,
            slug VARCHAR(80) NOT NULL UNIQUE,
            name VARCHAR(160) NOT NULL,
            description TEXT,
            default_branch VARCHAR(80) NOT NULL DEFAULT 'main',
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_repositories_slug ON asset_repositories (slug)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_branches (
            id SERIAL PRIMARY KEY,
            repo_id INTEGER NOT NULL REFERENCES asset_repositories(id) ON DELETE CASCADE,
            name VARCHAR(80) NOT NULL,
            head_hash VARCHAR(64),
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            protected BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP,
            updated_at TIMESTAMP,
            CONSTRAINT uix_asset_branch_repo_name UNIQUE (repo_id, name)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_branches_repo_id ON asset_branches (repo_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_commits (
            hash VARCHAR(64) PRIMARY KEY,
            repo_id INTEGER NOT NULL REFERENCES asset_repositories(id) ON DELETE CASCADE,
            parent_hash VARCHAR(64),
            parent2_hash VARCHAR(64),
            tree_hash VARCHAR(64) NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            author_id INTEGER,
            author_name VARCHAR(120) NOT NULL DEFAULT 'system',
            kind VARCHAR(20) NOT NULL DEFAULT 'commit',
            created_at TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_commits_repo_id ON asset_commits (repo_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_commits_tree_hash ON asset_commits (tree_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_commits_created_at ON asset_commits (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_commits_repo_created "
        "ON asset_commits (repo_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_commits_parent "
        "ON asset_commits (repo_id, parent_hash)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_blobs (
            hash VARCHAR(64) PRIMARY KEY,
            size INTEGER NOT NULL DEFAULT 0,
            content TEXT NOT NULL,
            created_at TIMESTAMP
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_entries (
            id SERIAL PRIMARY KEY,
            commit_hash VARCHAR(64) NOT NULL REFERENCES asset_commits(hash) ON DELETE CASCADE,
            path VARCHAR(400) NOT NULL,
            blob_hash VARCHAR(64) NOT NULL REFERENCES asset_blobs(hash) ON DELETE RESTRICT,
            mode VARCHAR(20) NOT NULL DEFAULT '100644',
            size INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT uix_asset_entry_commit_path UNIQUE (commit_hash, path)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_entries_commit_hash ON asset_entries (commit_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_entries_path ON asset_entries (path)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_tags (
            id SERIAL PRIMARY KEY,
            repo_id INTEGER NOT NULL REFERENCES asset_repositories(id) ON DELETE CASCADE,
            name VARCHAR(80) NOT NULL,
            commit_hash VARCHAR(64) NOT NULL REFERENCES asset_commits(hash) ON DELETE CASCADE,
            message TEXT,
            created_by INTEGER,
            created_at TIMESTAMP,
            CONSTRAINT uix_asset_tag_repo_name UNIQUE (repo_id, name)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_tags_repo_id ON asset_tags (repo_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_audit_events (
            id SERIAL PRIMARY KEY,
            repo_id INTEGER NOT NULL REFERENCES asset_repositories(id) ON DELETE CASCADE,
            action VARCHAR(40) NOT NULL,
            actor_id INTEGER,
            actor_name VARCHAR(120) NOT NULL DEFAULT 'system',
            detail JSONB,
            created_at TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_audit_events_repo_id ON asset_audit_events (repo_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_audit_events_action ON asset_audit_events (action)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_audit_events_created_at ON asset_audit_events (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_audit_repo_created "
        "ON asset_audit_events (repo_id, created_at)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_publications (
            id SERIAL PRIMARY KEY,
            repo_id INTEGER NOT NULL REFERENCES asset_repositories(id) ON DELETE CASCADE,
            commit_hash VARCHAR(64) NOT NULL REFERENCES asset_commits(hash) ON DELETE CASCADE,
            branch VARCHAR(80),
            status VARCHAR(20) NOT NULL DEFAULT 'published',
            files_count INTEGER NOT NULL DEFAULT 0,
            actor_id INTEGER,
            detail JSONB,
            created_at TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_publications_repo_id ON asset_publications (repo_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_publications_created_at ON asset_publications (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_publications_repo_created "
        "ON asset_publications (repo_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS asset_publications")
    op.execute("DROP TABLE IF EXISTS asset_audit_events")
    op.execute("DROP TABLE IF EXISTS asset_tags")
    op.execute("DROP TABLE IF EXISTS asset_entries")
    op.execute("DROP TABLE IF EXISTS asset_blobs")
    op.execute("DROP TABLE IF EXISTS asset_commits")
    op.execute("DROP TABLE IF EXISTS asset_branches")
    op.execute("DROP TABLE IF EXISTS asset_repositories")
