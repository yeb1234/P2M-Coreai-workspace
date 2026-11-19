"""agent actions audit

助手写个人数据（笔记/日历/Todo）后的执行记录与撤回依据。
AgentRun 记录「模型调了什么工具」，这张表记录「用户数据真正发生了什么」，
两者分开，撤回时只动目标对象，不碰对话历史。

Revision ID: d7e8f9a0b1c2
Revises: c0d1e2f3a4b5
Create Date: 2026-11-20 01:00:00+08:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "c0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_actions (
            id VARCHAR NOT NULL,
            run_id VARCHAR,
            session_id VARCHAR,
            user_id INTEGER NOT NULL,
            action_type VARCHAR NOT NULL,
            status VARCHAR NOT NULL DEFAULT 'applied',
            title VARCHAR NOT NULL DEFAULT '',
            summary TEXT,
            payload JSONB,
            target_id VARCHAR,
            result TEXT,
            created_at TIMESTAMP,
            undone_at TIMESTAMP,
            PRIMARY KEY (id),
            CONSTRAINT fk_agent_actions_user
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_user_id "
        "ON agent_actions (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_action_type "
        "ON agent_actions (action_type)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_status "
        "ON agent_actions (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_created_at "
        "ON agent_actions (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_user_created "
        "ON agent_actions (user_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_actions_run "
        "ON agent_actions (run_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_actions")
