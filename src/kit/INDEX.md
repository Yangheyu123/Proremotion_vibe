# KIT — 技法组件库（复用为默认，直出为例外）

> 规则（AGENTS 铁律 6）：新片视觉 ≥60% 由 kit 组件组装（换配色/参数 = 新身份），自研新技法每片 ≤1 个；
> 验收通过的新技法**必须提炼回 kit**（质量库滚雪球）。低质量代码永不入库。
> 用法：`import {OrbitSystem} from '../kit/OrbitSystem'`——全部组件颜色/尺寸/速度参数化，换肤即新身份。

## 组件目录

| 组件 | 类别 | 用途 | 来源 | 关键 props |
|---|---|---|---|---|
| `OrbitSystem` | 氛围/永续 | 永续轨道系统（点沿轨道永续绕行，无定格） | funes 轨道（用户标杆） | f, cx/cy, rings[{r,dotCount,speed,color}] |
| `FigureCutout` | **人物** | 图片立绘人物动画（呼吸/摇摆/接地影/入场） | 新解法：图像模型立绘+产线动效 | src(透明PNG), f, x/y/height, breathe/sway/entrance |
| `DrawOn` + `ChalkCircle` | 叙事 | 糙线 draw-on 板书线 + 红笔批改圈（p 驱动画出） | funes/swallow/calc | p, x1/y1/x2/y2, seed, variant |
| `PriceTag` | 冲击 | 价签/标签牌拍上（钩子/重音 hero） | calc 价签 | p, x/y, title/value, border/rot |
| `DustLayer` | 质感 | 粉笔灰/尘埃/颗粒环境层（speckle） | calc 板面 | w/h, dustColor, density, opacity |
| `transitions.tsx` | 转场 | 官方 21 转场四档封装 makeT/cycleT | 2026-11-03 | tier, i |
| `effects.ts` | 质感 | 6 个效果配方 glow/leak/star/powerOff/pixels/filmBase | 2026-11-03 | — |

## 人物立绘工作流（图片模型 → 产线）

1. 图像模型生成统一风格**透明底**人物立绘 PNG（正/侧/行走 2-3 姿态更佳）
2. 放入 `assets/figures/`（如 `figures/scholar.png`）
3. 场景内 `<FigureCutout src="figures/scholar.png" f={f} x={300} y={880} height={420} entrance={heroIn(f, 10)} />`
4. 同一角色跨片复用 = 音色复用同级的资产复用（风格调教一次，永久使用）

## 反哺规则

- 新技法在本片验收通过（motion_check 达标 + 目检 + 数据）→ 提炼为参数化组件放本目录 + INDEX 加行 + 标注来源片
- 修改组件 = 破坏性变更：跑 motion_check + 渲染样张确认不回归
