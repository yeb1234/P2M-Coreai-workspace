"""user-scoped video favorites

把收藏从共享库字段 `videos.is_favorite` 拆成用户级关联表。

## 为什么必须拆

`videos` 是共享视频库。`is_favorite` 在表上只存一份，A 点收藏，B 打开
同一个视频也会看到已收藏；A 取消，B 的收藏也消失。这不是“默认值”问题，
是所有权放错了层级。

新表 `user_video_favorites` 用 (user_id, video_id) 做复合主键，天然幂等：
同一用户重复收藏不会产生多行。`videos.is_favorite` / `favorited_at` 保留
但废弃，避免旧客户端或回滚时列不存在。

## 迁移

本迁移只建新表，不迁移旧字段的值：审计时全库 `videos.is_favorite` 为 0 条，
没有历史收藏需要搬运。之后应用层所有序列化/播放列表/推荐都读新表。

Revision ID: b5c6d7e8f9a0
Revises: a1b2c3d4e5f6
Create Date: 2026-11-17 21:00:00+08:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c6d7e8f9a0"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_video_favorites",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("video_id", sa.Integer(), nullable=False),
        sa.Column("favorited_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["video_id"], ["videos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "video_id"),
    )
    op.create_index(
        "ix_user_video_favorites_video",
        "user_video_favorites",
        ["video_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_video_favorites_video", table_name="user_video_favorites")
    op.drop_table("user_video_favorites")
