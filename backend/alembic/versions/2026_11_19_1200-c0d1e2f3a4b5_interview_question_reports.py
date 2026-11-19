"""interview question reports

题库是静态 JSON，题目错误需要单独留档。新表保存用户、题目快照、
错误类型、补充说明和处理状态，不改动题库本身。

使用 IF NOT EXISTS 是因为容器入口会先跑 `ensure_runtime_schema()`，
新环境里表可能已经由 metadata.create_all 建好；迁移仍需可重复执行。

Revision ID: c0d1e2f3a4b5
Revises: b5c6d7e8f9a0
Create Date: 2026-11-19 12:00:00+08:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, None] = "b5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS interview_question_reports (
            id VARCHAR NOT NULL,
            user_id INTEGER NOT NULL,
            question_id VARCHAR NOT NULL,
            question_title VARCHAR NOT NULL DEFAULT '',
            reason VARCHAR NOT NULL,
            detail TEXT,
            status VARCHAR NOT NULL DEFAULT 'open',
            created_at TIMESTAMP,
            resolved_at TIMESTAMP,
            PRIMARY KEY (id),
            CONSTRAINT fk_interview_question_reports_user
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_question_reports_user_id "
        "ON interview_question_reports (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_question_reports_question_id "
        "ON interview_question_reports (question_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_question_reports_reason "
        "ON interview_question_reports (reason)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_question_reports_status "
        "ON interview_question_reports (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_question_reports_created_at "
        "ON interview_question_reports (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_reports_user_created "
        "ON interview_question_reports (user_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_interview_reports_question_status "
        "ON interview_question_reports (question_id, status)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS interview_question_reports")
