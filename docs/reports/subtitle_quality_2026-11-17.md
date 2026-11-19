# 字幕质量扫描报告

- 扫描视频：14327
- 有问题记录：4732（严重 629 / 警告 4103）
- 问题记录覆盖字幕字符：35,138,696

## 问题分布

| 问题代码 | 数量 |
|---|---:|
| `filler_high` | 4397 |
| `repeat_loop` | 531 |
| `invalid_timestamps` | 223 |
| `garbled_segments` | 124 |
| `coverage_low` | 3 |
| `timestamps_overlap` | 3 |

## 严重问题样例

| video_id | 标题 | 段数 | 字符 | 问题 | 样例 |
|---:|---|---:|---:|---|---|
| 36151 | 1 | 2640 | 17332 | `invalid_timestamps|repeat_loop` | seg=1378 density_high: 就是这个Transformer了 |
| 36152 | 1 | 1311 | 5892 | `repeat_loop` |  |
| 36153 | 1 | 1616 | 12061 | `invalid_timestamps|repeat_loop` | Sigma |
| 36155 | 1 | 111 | 5075 | `garbled_segments|repeat_loop` | seg=41 degenerate,repeat_char: CNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN |
| 36156 | 1 | 2527 | 17388 | `repeat_loop` | seg=41 density_high: 周六吧 |
| 36159 | 1 | 1239 | 10101 | `filler_high|repeat_loop` | 请不吝点赞 订阅 转发 打赏支持明镜与点栏目 |
| 36160 | 1 | 1935 | 13623 | `filler_high|repeat_loop` | seg=633 density_high: 我们的Editor |
| 36161 | 1 | 2412 | 8027 | `invalid_timestamps|repeat_loop` | seg=311 density_high: 添加一个usermessager |
| 36162 | 1 | 444 | 11033 | `filler_high|garbled_segments|repeat_loop` | seg=38 garbled,degenerate,repeat_char: 扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩扩 |
| 36163 | 1 | 588 | 3739 | `invalid_timestamps|repeat_loop` | seg=71 density_high: 我的 |
| 36164 | 1 | 179 | 6372 | `filler_high|garbled_segments|repeat_loop` | seg=121 garbled,degenerate,repeat_char: 瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎瞎 |
| 36165 | 1 | 2110 | 14362 | `repeat_loop` | seg=106 density_high: 购物贵 |
| 36166 | 1 | 1482 | 10840 | `invalid_timestamps|repeat_loop` | seg=589 density_high: savemodel |
| 36168 | 1 | 468 | 15231 | `filler_high|repeat_loop` | seg=388 degenerate: 医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院医院 |
| 36170 | 1 | 1471 | 9131 | `repeat_loop` | seg=373 density_high: 内存 |
| 36171 | 1 | 321 | 15430 | `repeat_loop` | seg=72 density_high: 匹配预测 |
| 36172 | 1 | 2491 | 18047 | `repeat_loop` | seg=186 density_high: 是不是get |
| 36187 | 1-1 串讲-大模型必备Python语言 2025-10-21 | 5124 | 35562 | `garbled_segments|repeat_loop` | seg=373 density_high: Pessing呢 |
| 36198 | 1-2 串讲-大模型必备Python语言 2025-10-23 | 4543 | 37397 | `garbled_segments|repeat_loop` | seg=118 density_high: number是吧 |
| 36209 | 01-04-input输入 | 134 | 2267 | `repeat_loop` | seg=2 density_high: So we're going to use our control |

## 处理建议

- `garbled_segments` / `repeat_loop` / `invalid_timestamps`：优先人工确认后重转写，不要只靠清洗修补。
- `coverage_low` / `segments_missing`：先核对源视频是否截断、音频是否缺轨、转写是否提前结束。
- `filler_high`：可直接走轻量清洗，删除独立语气词与重复片段，保留术语、数字、否定词和逻辑连接词。
- 本报告只读，不改数据库、不重嵌、不重转写。
