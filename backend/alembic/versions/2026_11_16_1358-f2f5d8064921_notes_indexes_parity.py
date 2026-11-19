"""notes indexes parity

补上 notes 表上「model 声明了 index=True、但线上库没有」的两个索引。

## 为什么需要这个迁移

`models.Note.scope` 和 `Note.user_id` 都写了 `index=True`，所以全新部署
（create_all / baseline）会有这两个索引。但**已有的库没有**：

`Base.metadata.create_all()` 只建「缺少的表」，表已存在就整张跳过 ——
包括这张表上新增的索引。于是同一份代码，新库有索引、老库没有，
`ensure_video_note`（按 video_id 查）和 notes 列表（按 scope + user_id 过滤）
在老库上都是全表扫。

这类「模型改了但线上结构没跟上」正是引入 Alembic 要解决的问题。

## 为什么用 IF NOT EXISTS

新库的 baseline 已经建过这两个索引。这个迁移对它们是无操作，
对老库才真正生效。幂等让两种库都能安全跑到 head。

Revision ID: f2f5d8064921
Revises: ed9ec716c9b0
Create Date: 2026-11-16 13:58:22.826945+08:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2f5d8064921"
down_revision: Union[str, None] = "ed9ec716c9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_notes_scope ON notes (scope)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notes_user_id ON notes (user_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_scope")
    op.execute("DROP INDEX IF EXISTS ix_notes_user_id")
