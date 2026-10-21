# assets/ — 你的素材自备目录

产线不附带任何版权素材。把你的文件按下面的名字放进来，脚本就能找到：

| 文件 | 用途 | 说明 |
|---|---|---|
| `bgm.flac` | BGM 标准链路的默认曲目（混音 + PULSE_ENV 烘焙） | 你拥有版权/授权的音乐；flac/mp3 均可（脚本按你传的路径为准） |
| `bgm/<name>.mp3` | 音乐库（bgm_add.cjs 入库登记） | 可选 |

全部路径可用环境变量覆盖（`ASSET_HOME` / `BGM_HOME`），见 `scripts/lib/paths.cjs`。

⚠️ 本目录整体被 .gitignore 排除——素材永不入库。
