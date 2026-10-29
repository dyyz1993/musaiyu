# ASSET_CREDITS — 木塞鱼项目素材来源与许可

调研渠道：ChatGPT 联网调研（2026-10-28，报告见 `../chatgpt-report.md`），全部链接已逐一实测下载核验。

## 1. 扑克牌面（主牌面，已采用）
- **letele/playing-cards** — React SVG 扑克组件库
  - 许可：**CC0-1.0**（无强制署名）；上游设计 Adrian Kennard《Playing Cards》亦为 CC0（https://www.me.uk/cards/）
  - 内容：52 张标准牌 + 2 张鬼牌（J-1/J-2）+ 2 种牌背（B-1/B-2），共 56 个独立 SVG
  - 文件命名：`S-A.svg`（黑桃A）、`H-K.svg`（红桃K）、`D-5.svg`、`C-10.svg`…
  - 来源：https://github.com/letele/playing-cards
  - 位置：`cards/`

## 2. 筹码
- **Playing Card Assets (52-cards deck + Chips) 之筹码分包** — 作者 mehrasaur
  - 许可：**CC0**（无强制署名）
  - 内容：11 色筹码（俯视/平放/倾斜三种视角）+ Dealer/BB/SB 按钮 + spritesheet
  - 注意：该包牌面**无 Joker**（故牌面用 letele），只取其筹码
  - 来源：https://opengameart.org/content/playing-card-assets-52-cards-deck-chips
  - 位置：`chips/`

## 3. 绿色绒布桌面
- **Felt Backgrounds** — 作者 jbp4444
  - 许可：**CC0 / public domain**（无强制署名）
  - 内容：2048×2048 实物毛毡扫描（绿/棕/灰/粉），本项目取 `felt_green.jpg`（已缩至 1600px）
  - 注意：非无缝纹理，网页用 `cover` 居中、不要 repeat 平铺
  - 来源：https://opengameart.org/content/felt-backgrounds
  - 位置：`felt/`

## 4. 音效
- **Kenney Casino Audio** — 作者 Kenney
  - 许可：**CC0**（无强制署名）
  - 内容：54 个 OGG（23 纸牌音 + 19 筹码音 + 12 骰子音）
  - 常用：`card-slide-*.ogg`（发牌）、`card-place-*.ogg`（摊牌）、`chip-lay-*.ogg`（下注）、`chips-stack-*.ogg`（叠筹码）
  - 来源：https://kenney.nl/assets/casino-audio
  - 位置：`audio/Audio/`

## 5. 桌面小组件（庄家标识/骰子/棋子等）
- **Kenney Boardgame Pack v2**
  - 许可：**CC0**（无强制署名）
  - 内容：PNG 牌/筹码/骰子 + SVG 矢量 + Bonus 音效
  - 来源：https://kenney.nl/assets/boardgame-pack
  - 位置：`boardgame/`

## 6. 规则参考源码（研究用，非素材）
- **lahmmiley/MusaiProbability**（C#，2017，无 LICENSE —— 只研究思路，不可复制分发）
  - `Poker.cs` 55 张牌组生成 / `Card.cs` 计点 / `CardLevelJudgement.cs` 牌型与倍率 / `Judger.cs` 胜负比较
  - 已知缺陷：木虱克双鬼只写了单向比较，移植时必须双向处理
  - 来源：https://github.com/lahmmiley/MusaiProbability
  - 位置：`rules-reference/`

## 7. AI 生成素材（2026-10-28 本机生成，gpt-image-2）
| 文件 | 规格 | 用途 |
|---|---|---|
| `ai-generated/joker-big.png` | 1024×1536 PNG | 大王牌面（红金小丑，替代 letele J-1） |
| `ai-generated/joker-small.png` | 1024×1536 PNG | 小王牌面（黑银，与大王成对） |
| `ai-generated/table-bg.png` | 1672×941 PNG | 牌桌全景背景（替代纯毛毡 felt_green） |
| `ai-generated/card-back.png` | 1024×1536 PNG | 牌背（红金菱格纹，替代 letele B-1） |

- web 压缩版在 `ai-generated/web/`（牌面/牌背 690px PNG，桌布 1600px JPG 171KB）；原始 PNG 每张约 2MB 留作放大
- 注意：牌面/牌背细线在小尺寸（<260px）下会糊，游戏渲染建议 ≥690px
- 许可说明：AI 生成图，非第三方版权素材；52 张标准牌仍用 letele CC0 版（AI 重画整副容易花脸不一致）

## 备选素材（报告已核验、未采用）
| 素材 | 许可 | 链接 |
|---|---|---|
| hayeah/playing-cards-assets（传统人物牌 SVG+PNG） | MIT | https://github.com/hayeah/playing-cards-assets |
| htdebeer/SVG-cards（法式人物牌） | LGPL-2.1 | https://github.com/htdebeer/SVG-cards |
| Kenney Playing Cards Pack（像素风 PNG） | CC0 | https://opengameart.org/sites/default/files/playing-cards-pack_0.zip |
| Jfred Pixel Cards（50×75 像素牌） | CC0 | https://jfredd.itch.io/pixel-cards |
