"""cleanup redundant indexes

P0 数据库审计的安全项：删除和主键重复的 `*_id` 索引，以及从未被扫描、
且和 `ix_videos_is_favorite` 重叠的 `ix_videos_favorite`。

## 为什么只删这三个

- `ix_subtitle_segments_id` / `ix_videos_id`：和主键索引完全重复，只增加
  插入、更新时的写放大；
- `ix_videos_favorite`：`pg_stat_user_indexes` 显示 idx_scan=0，实际在用的
  是单列 `ix_videos_is_favorite`；
- **不删** `ix_subtitle_segments_text_trgm`：`/segments/search` 在 hybrid
  search 失败后仍用 `SubtitleSegment.text.contains` 兜底，删掉会让 321 万行
  字幕在降级时顺序扫描；
- **不删** `ix_subtitle_segments_video_id`：idx_scan 533 万次，是热索引，
  复合索引前缀覆盖不代表单列索引没有价值。

## 注意

`migrations.py` 启动时会重建 `ix_videos_favorite`，本次同时移除了那条
`CREATE INDEX IF NOT EXISTS`，否则重启后索引会重新长回来。

Revision ID: a1b2c3d4e5f6
Revises: f2f5d8064921
Create Date: 2026-11-17 19:50:00+08:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f2f5d8064921"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_subtitle_segments_id")
    op.execute("DROP INDEX IF EXISTS ix_videos_id")
    op.execute("DROP INDEX IF EXISTS ix_videos_favorite")


def downgrade() -> None:
    # 回滚时恢复冗余索引，方便与旧版本逐项对照。
    op.execute("CREATE INDEX IF NOT EXISTS ix_subtitle_segments_id ON subtitle_segments (id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_videos_id ON videos (id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_videos_favorite "
        "ON videos (is_favorite, favorited_at DESC)"
    )
